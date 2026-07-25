import "server-only";

import { requireOrganization } from "@/lib/organizations/service";
import { createClient } from "@/lib/supabase/server";
import { VEHICLE_COLUMNS, type Vehicle } from "@/lib/vehicles/types";
import {
  classifyDeadline,
  deadlineSortKey,
  worstDeadline,
  type DeadlineState,
} from "./dates";
import {
  compareActions,
  getServiceStatus,
  isHighPriorityIssue,
  operationalGroup,
  OPEN_ISSUE_STATUSES,
  REPEATED_ISSUE_THRESHOLD,
  urgencyLevel,
  type DocumentStatus,
  type FleetAction,
  type ServiceStatus,
} from "./alerts";
import {
  monthStartIso,
  nextMonthStartIso,
  summarizeMonthlyCosts,
  type FleetCostSummary,
  type MaintenanceCostRow,
} from "./costs";
import {
  compareOperationalStatus,
  needsAttention,
  type FleetFilter,
  type FleetSort,
  type OperationalStatus,
} from "./types";

/**
 * Server-only fleet aggregates for the Fleet Dashboard and the vehicles list.
 *
 * PERFORMANCE: the whole dashboard is built from FIVE org-scoped queries, with
 * all joining, counting and cost roll-up done in memory. At the target scale
 * (10–80 vehicles) that is strictly cheaper than per-vehicle round trips, and it
 * structurally rules out N+1: nothing here runs a query inside a loop, and no
 * signed URL is minted per row. Only the columns needed are selected — no full
 * maintenance/issue/document rows are fetched just to derive a count or a date.
 *
 * SCOPING: `requireOrganization()` resolves the org from the session (via
 * `organization_members`); every query then filters on it explicitly, on top of
 * RLS. Search and filtering happen after that scoping, so no query string can
 * reach another organization's rows.
 *
 * HONESTY: every number returned here is computed from real rows. Where the data
 * cannot support a figure, the result says so (`unknown`, `undatedCount`,
 * `mixedCurrency`) rather than presenting a confident wrong number.
 */

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------
export interface FleetSummary {
  totalVehicles: number;

  // Operational grouping (from the STORED operational_status).
  operational: number;
  attention: number;
  unavailable: number;

  /** Vehicles with at least one open action. The "what needs me today" number. */
  requiresAttention: number;

  // Service — overdue and upcoming are deliberately separate counts.
  servicesOverdue: number;
  servicesDueSoon: number;
  /** Vehicles with neither a service date nor a mileage target. */
  serviceUnknown: number;

  /**
   * DOCUMENT counts, counting documents — not vehicles. One document is one
   * expiring item: a vehicle's statutory test date, its insurance date, or an
   * uploaded `vehicle_documents` row that carries an expiry.
   */
  documentsExpired: number;
  documentsExpiringSoon: number;
  /** Vehicles a human explicitly flagged as missing paperwork. */
  vehiclesFlaggedDocumentsMissing: number;

  // Issues — counting issue records.
  openIssues: number;
  highPriorityIssues: number;
  vehiclesWithOpenIssues: number;

  // Costs for the current month.
  monthCost: number;
  costCurrency: string;
  costMixedCurrency: boolean;
}

export type DeadlineKind =
  | "next_service"
  | "test_expiry"
  | "insurance_expiry"
  | "document_expiry"
  | "reminder";

export interface FleetDeadline {
  vehicleId: string;
  vehicleLabel: string;
  licensePlate: string | null;
  kind: DeadlineKind;
  date: string | null;
  dueKm?: number;
  state: DeadlineState;
  label?: string | null;
}

/** A simple, deterministic observation about the fleet. Never LLM-generated. */
export type FleetInsight =
  | { kind: "most_expensive_vehicle"; vehicleId: string; vehicleLabel: string; licensePlate: string | null; amount: number; currency: string }
  | { kind: "repeated_issues"; vehicleId: string; vehicleLabel: string; licensePlate: string | null; count: number }
  | { kind: "service_data_missing"; count: number };

export interface FleetOverview {
  summary: FleetSummary;
  actions: FleetAction[];
  insights: FleetInsight[];
  deadlines: FleetDeadline[];
  vehicles: Vehicle[];
  costs: FleetCostSummary;
}

/** Max rows rendered in the dashboard lists. */
const ACTION_LIMIT = 15;
const DEADLINE_LIMIT = 12;

function vehicleLabel(v: Vehicle): string {
  return [v.make, v.model].filter(Boolean).join(" ").trim();
}

// -----------------------------------------------------------------------------
// Shared per-vehicle computation
// -----------------------------------------------------------------------------
interface IssueRow {
  id: string;
  vehicle_id: string;
  status: string;
  severity: string | null;
  title: string | null;
}
interface DocRow {
  id: string;
  vehicle_id: string;
  doc_type: string | null;
  expiry_date: string | null;
}

export interface FleetVehicleRow {
  vehicle: Vehicle;
  openIssueCount: number;
  highPriorityIssueCount: number;
  service: ServiceStatus;
  documents: DocumentStatus;
  /** Current-month cost, or null when this vehicle recorded none. */
  monthCost: number | null;
  actions: FleetAction[];
  /** Legacy field kept so existing row UI keeps compiling. */
  serviceState: DeadlineState | null;
  testState: DeadlineState | null;
  insuranceState: DeadlineState | null;
}

/**
 * Build every per-vehicle fact and action from already-fetched rows.
 * Pure and query-free: the caller does the (few) queries, this does the maths.
 */
function buildRows(
  vehicles: Vehicle[],
  issues: IssueRow[],
  docs: DocRow[],
  costs: FleetCostSummary,
): FleetVehicleRow[] {
  const byId = new Map(vehicles.map((v) => [v.id, v]));

  const openIssues = new Map<string, IssueRow[]>();
  for (const row of issues) {
    if (!byId.has(row.vehicle_id)) continue; // issue on an archived/sold vehicle
    const list = openIssues.get(row.vehicle_id);
    if (list) list.push(row);
    else openIssues.set(row.vehicle_id, [row]);
  }

  const docsByVehicle = new Map<string, DocRow[]>();
  for (const row of docs) {
    if (!byId.has(row.vehicle_id)) continue;
    const list = docsByVehicle.get(row.vehicle_id);
    if (list) list.push(row);
    else docsByVehicle.set(row.vehicle_id, [row]);
  }

  const costByVehicle = new Map(costs.byVehicle.map((c) => [c.vehicleId, c.total]));
  const anomalySet = new Set(costs.anomalies);

  return vehicles.map((v) => {
    const label = vehicleLabel(v);
    const vehicleIssues = openIssues.get(v.id) ?? [];
    const highPriority = vehicleIssues.filter((i) => isHighPriorityIssue(i.severity));
    const service = getServiceStatus(v);

    // ---- documents: statutory dates + uploaded documents ----
    const testState = classifyDeadline(v.test_expiry_date);
    const insuranceState = classifyDeadline(v.insurance_expiry_date);

    let expiredCount = 0;
    let expiringCount = 0;
    const expiryDates: string[] = [];

    const tally = (state: DeadlineState | null, date: string | null) => {
      if (!date) return;
      expiryDates.push(date);
      if (state === "overdue") expiredCount += 1;
      else if (state === "due_soon") expiringCount += 1;
    };
    tally(testState, v.test_expiry_date);
    tally(insuranceState, v.insurance_expiry_date);
    for (const d of docsByVehicle.get(v.id) ?? []) {
      tally(classifyDeadline(d.expiry_date), d.expiry_date);
    }

    const uploadedWorst = (docsByVehicle.get(v.id) ?? []).map((d) =>
      classifyDeadline(d.expiry_date),
    );
    const documents: DocumentStatus = {
      testState,
      insuranceState,
      worst: worstDeadline(testState, insuranceState, ...uploadedWorst),
      nearestExpiry:
        expiryDates.length > 0
          ? expiryDates.slice().sort((a, b) => a.localeCompare(b))[0]
          : null,
      expiredCount,
      expiringCount,
      flaggedMissing: v.operational_status === "documents_missing",
    };

    const monthCost = costByVehicle.get(v.id) ?? null;

    // ---- actions ----
    const actions: FleetAction[] = [];
    const push = (a: Omit<FleetAction, "vehicleId" | "vehicleLabel" | "licensePlate" | "urgency">) =>
      actions.push({
        ...a,
        vehicleId: v.id,
        vehicleLabel: label,
        licensePlate: v.license_plate,
        urgency: urgencyLevel(a.type),
      });

    if (service.state === "overdue") {
      push({
        id: `${v.id}:service_overdue`,
        type: "service_overdue",
        date: service.byDate === "overdue" ? service.date : null,
        detail:
          service.byMileage === "overdue" && service.kmRemaining != null
            ? String(Math.abs(service.kmRemaining))
            : null,
        href: `/vehicles/${v.id}`,
      });
    } else if (service.state === "due_soon") {
      push({
        id: `${v.id}:service_due_soon`,
        type: "service_due_soon",
        date: service.byDate === "due_soon" ? service.date : null,
        detail:
          service.byMileage === "due_soon" && service.kmRemaining != null
            ? String(service.kmRemaining)
            : null,
        href: `/vehicles/${v.id}`,
      });
    } else if (service.unknown) {
      push({
        id: `${v.id}:missing_service_data`,
        type: "missing_service_data",
        date: null,
        href: `/vehicles/${v.id}/edit`,
      });
    }

    // One action per document state, not one per document, so a vehicle with
    // five expired papers does not bury the rest of the fleet.
    if (documents.expiredCount > 0) {
      push({
        id: `${v.id}:document_expired`,
        type: "document_expired",
        date: documents.nearestExpiry,
        count: documents.expiredCount,
        href: `/vehicles/${v.id}/documents`,
      });
    } else if (documents.expiringCount > 0) {
      push({
        id: `${v.id}:document_expiring`,
        type: "document_expiring",
        date: documents.nearestExpiry,
        count: documents.expiringCount,
        href: `/vehicles/${v.id}/documents`,
      });
    }

    if (highPriority.length > 0) {
      push({
        id: `${v.id}:issue_high_priority`,
        type: "issue_high_priority",
        date: null,
        count: highPriority.length,
        detail: highPriority[0]?.title ?? null,
        href: `/vehicles/${v.id}/issues`,
      });
    } else if (vehicleIssues.length > 0) {
      push({
        id: `${v.id}:issue_open`,
        type: "issue_open",
        date: null,
        count: vehicleIssues.length,
        detail: vehicleIssues[0]?.title ?? null,
        href: `/vehicles/${v.id}/issues`,
      });
    }

    // A stored "cannot work" status is an action in its own right; a derived
    // signal never overwrites it, and it never duplicates the alerts above.
    if (operationalGroup(v.operational_status) === "unavailable") {
      push({
        id: `${v.id}:status_unavailable`,
        type: "status_unavailable",
        date: null,
        detail: v.operational_status,
        href: `/vehicles/${v.id}`,
      });
    }

    if (anomalySet.has(v.id) && monthCost != null) {
      push({
        id: `${v.id}:cost_anomaly`,
        type: "cost_anomaly",
        date: null,
        detail: String(Math.round(monthCost)),
        href: `/vehicles/${v.id}`,
      });
    }

    return {
      vehicle: v,
      openIssueCount: vehicleIssues.length,
      highPriorityIssueCount: highPriority.length,
      service,
      documents,
      monthCost,
      actions,
      serviceState: service.state,
      testState,
      insuranceState,
    };
  });
}

/** The five org-scoped queries every fleet surface shares. */
async function fetchFleetData(organizationId: string) {
  const supabase = await createClient();
  const from = monthStartIso();
  const to = nextMonthStartIso();

  const [vehiclesRes, issuesRes, docsRes, remindersRes, costsRes] =
    await Promise.all([
      // The operating fleet = lifecycle-active vehicles. Archived/sold vehicles
      // are history, not fleet, so they are excluded from every count.
      supabase
        .from("vehicles")
        .select(VEHICLE_COLUMNS)
        .eq("organization_id", organizationId)
        .eq("status", "active")
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),

      supabase
        .from("issue_logs")
        .select("id, vehicle_id, status, severity, title")
        .eq("organization_id", organizationId)
        .in("status", OPEN_ISSUE_STATUSES)
        .is("deleted_at", null),

      supabase
        .from("vehicle_documents")
        .select("id, vehicle_id, doc_type, expiry_date")
        .eq("organization_id", organizationId)
        .not("expiry_date", "is", null)
        .is("deleted_at", null),

      supabase
        .from("reminders")
        .select("id, vehicle_id, title, due_date, status")
        .eq("organization_id", organizationId)
        .eq("status", "pending")
        .not("due_date", "is", null)
        .is("deleted_at", null),

      // Only the current month is fetched — the cost roll-up never scans the
      // organization's whole service history.
      supabase
        .from("maintenance_logs")
        .select("vehicle_id, cost, currency, performed_at")
        .eq("organization_id", organizationId)
        .gte("performed_at", from)
        .lt("performed_at", to)
        .is("deleted_at", null),
    ]);

  if (vehiclesRes.error) throw vehiclesRes.error;
  if (issuesRes.error) throw issuesRes.error;
  if (docsRes.error) throw docsRes.error;
  if (remindersRes.error) throw remindersRes.error;
  if (costsRes.error) throw costsRes.error;

  return {
    vehicles: (vehiclesRes.data ?? []) as Vehicle[],
    issues: (issuesRes.data ?? []) as unknown as IssueRow[],
    docs: (docsRes.data ?? []) as unknown as DocRow[],
    reminders: (remindersRes.data ?? []) as unknown as {
      vehicle_id: string;
      title: string | null;
      due_date: string | null;
    }[],
    costs: summarizeMonthlyCosts(
      (costsRes.data ?? []) as unknown as MaintenanceCostRow[],
    ),
  };
}

// -----------------------------------------------------------------------------
// Overview (dashboard)
// -----------------------------------------------------------------------------
export async function getFleetOverview(): Promise<FleetOverview> {
  const { organizationId } = await requireOrganization();
  const { vehicles, issues, docs, reminders, costs } =
    await fetchFleetData(organizationId);

  const rows = buildRows(vehicles, issues, docs, costs);
  const byId = new Map(vehicles.map((v) => [v.id, v]));

  // --- summary ---------------------------------------------------------------
  const groupCount = (g: ReturnType<typeof operationalGroup>) =>
    vehicles.filter((v) => operationalGroup(v.operational_status) === g).length;

  const summary: FleetSummary = {
    totalVehicles: vehicles.length,
    operational: groupCount("operational"),
    attention: groupCount("attention"),
    unavailable: groupCount("unavailable"),
    requiresAttention: rows.filter((r) => r.actions.length > 0).length,

    servicesOverdue: rows.filter((r) => r.service.state === "overdue").length,
    servicesDueSoon: rows.filter((r) => r.service.state === "due_soon").length,
    serviceUnknown: rows.filter((r) => r.service.unknown).length,

    documentsExpired: rows.reduce((n, r) => n + r.documents.expiredCount, 0),
    documentsExpiringSoon: rows.reduce((n, r) => n + r.documents.expiringCount, 0),
    vehiclesFlaggedDocumentsMissing: rows.filter((r) => r.documents.flaggedMissing)
      .length,

    openIssues: rows.reduce((n, r) => n + r.openIssueCount, 0),
    highPriorityIssues: rows.reduce((n, r) => n + r.highPriorityIssueCount, 0),
    vehiclesWithOpenIssues: rows.filter((r) => r.openIssueCount > 0).length,

    monthCost: costs.monthTotal,
    costCurrency: costs.currency,
    costMixedCurrency: costs.mixedCurrency,
  };

  // --- action list -----------------------------------------------------------
  const actions = rows.flatMap((r) => r.actions).sort(compareActions);

  // --- insights (deterministic, no generated prose) ---------------------------
  const insights: FleetInsight[] = [];

  const topCost = costs.byVehicle[0];
  if (topCost && topCost.total > 0) {
    const v = byId.get(topCost.vehicleId);
    if (v) {
      insights.push({
        kind: "most_expensive_vehicle",
        vehicleId: v.id,
        vehicleLabel: vehicleLabel(v),
        licensePlate: v.license_plate,
        amount: topCost.total,
        currency: costs.currency,
      });
    }
  }

  const repeated = rows
    .filter((r) => r.openIssueCount >= REPEATED_ISSUE_THRESHOLD)
    .sort((a, b) => b.openIssueCount - a.openIssueCount)[0];
  if (repeated) {
    insights.push({
      kind: "repeated_issues",
      vehicleId: repeated.vehicle.id,
      vehicleLabel: vehicleLabel(repeated.vehicle),
      licensePlate: repeated.vehicle.license_plate,
      count: repeated.openIssueCount,
    });
  }

  if (summary.serviceUnknown > 0) {
    insights.push({ kind: "service_data_missing", count: summary.serviceUnknown });
  }

  // --- upcoming deadlines ----------------------------------------------------
  const deadlines: FleetDeadline[] = [];
  const pushDeadline = (
    v: Vehicle,
    kind: DeadlineKind,
    date: string | null,
    extra?: { dueKm?: number; label?: string | null },
  ) => {
    const state = classifyDeadline(date);
    if (state !== "overdue" && state !== "due_soon") return;
    deadlines.push({
      vehicleId: v.id,
      vehicleLabel: vehicleLabel(v),
      licensePlate: v.license_plate,
      kind,
      date,
      state,
      ...extra,
    });
  };

  for (const v of vehicles) {
    pushDeadline(v, "next_service", v.next_service_date);
    pushDeadline(v, "test_expiry", v.test_expiry_date);
    pushDeadline(v, "insurance_expiry", v.insurance_expiry_date);
  }
  for (const d of docs) {
    const v = byId.get(d.vehicle_id);
    if (v) pushDeadline(v, "document_expiry", d.expiry_date, { label: d.doc_type });
  }
  for (const r of reminders) {
    const v = byId.get(r.vehicle_id);
    if (v) pushDeadline(v, "reminder", r.due_date, { label: r.title });
  }
  deadlines.sort((a, b) => deadlineSortKey(a.date) - deadlineSortKey(b.date));

  return {
    summary,
    actions: actions.slice(0, ACTION_LIMIT),
    insights,
    deadlines: deadlines.slice(0, DEADLINE_LIMIT),
    vehicles,
    costs,
  };
}

// -----------------------------------------------------------------------------
// Vehicles list
// -----------------------------------------------------------------------------
export interface FleetVehiclesResult {
  rows: FleetVehicleRow[];
  counts: Record<FleetFilter, number>;
  costs: FleetCostSummary;
  /** Vehicles in the organization before search/filter, for "x of y" copy. */
  totalCount: number;
}

/** Normalize free text for search: trim, collapse whitespace, casefold. */
export function normalizeSearch(term: string): string {
  return term.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function matchesSearch(row: FleetVehicleRow, needle: string): boolean {
  if (!needle) return true;
  const v = row.vehicle;
  const haystack = [
    v.license_plate,
    v.make,
    v.model,
    [v.make, v.model].filter(Boolean).join(" "),
    v.vehicle_type,
    v.assigned_driver_name,
    v.vin,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
  return haystack.includes(needle);
}

function matchesFilter(row: FleetVehicleRow, f: FleetFilter): boolean {
  switch (f) {
    case "all":
      return true;
    case "needs_attention":
      return row.actions.length > 0;
    case "service_overdue":
      return row.service.state === "overdue";
    case "service_due_soon":
      return row.service.state === "due_soon";
    case "document_expiring":
      return row.documents.expiredCount > 0 || row.documents.expiringCount > 0;
    case "open_issues":
      return row.openIssueCount > 0;
    case "driver_assigned":
      return Boolean(row.vehicle.assigned_driver_name?.trim());
    case "driver_unassigned":
      return !row.vehicle.assigned_driver_name?.trim();
    default:
      // The remaining filters are the operational statuses themselves.
      return row.vehicle.operational_status === f;
  }
}

/** Worst urgency rank on a row (lower = more urgent); Infinity when clean. */
function urgencyKey(row: FleetVehicleRow): number {
  if (row.actions.length === 0) return Number.POSITIVE_INFINITY;
  return Math.min(
    ...row.actions.map((a) =>
      a.urgency === "critical" ? 1 : a.urgency === "high" ? 2 : a.urgency === "soon" ? 3 : 4,
    ),
  );
}

export interface ListFleetVehiclesOptions {
  filter?: FleetFilter;
  sort?: FleetSort;
  search?: string;
}

/**
 * The organization's vehicles for the fleet list.
 *
 * Five queries total regardless of fleet size — filtering, searching and sorting
 * all happen in memory over the already-scoped rows, so the filter chips can
 * show accurate counts for every option without one COUNT query per chip, and
 * there is no per-row query anywhere.
 */
export async function listFleetVehicles(
  options: ListFleetVehiclesOptions = {},
): Promise<FleetVehiclesResult> {
  const { filter = "all", sort = "urgency", search = "" } = options;
  const { organizationId } = await requireOrganization();
  const { vehicles, issues, docs, costs } = await fetchFleetData(organizationId);

  const allRows = buildRows(vehicles, issues, docs, costs);
  const needle = normalizeSearch(search);

  // Search narrows first, so the filter counts describe what the user is
  // actually looking at.
  const searched = allRows.filter((r) => matchesSearch(r, needle));

  const counts = {
    all: searched.length,
    needs_attention: searched.filter((r) => matchesFilter(r, "needs_attention")).length,
    service_overdue: searched.filter((r) => matchesFilter(r, "service_overdue")).length,
    service_due_soon: searched.filter((r) => matchesFilter(r, "service_due_soon")).length,
    document_expiring: searched.filter((r) => matchesFilter(r, "document_expiring")).length,
    open_issues: searched.filter((r) => matchesFilter(r, "open_issues")).length,
    driver_assigned: searched.filter((r) => matchesFilter(r, "driver_assigned")).length,
    driver_unassigned: searched.filter((r) => matchesFilter(r, "driver_unassigned")).length,
    active: searched.filter((r) => matchesFilter(r, "active")).length,
    needs_service: searched.filter((r) => matchesFilter(r, "needs_service")).length,
    issue_open: searched.filter((r) => matchesFilter(r, "issue_open")).length,
    out_of_service: searched.filter((r) => matchesFilter(r, "out_of_service")).length,
    in_garage: searched.filter((r) => matchesFilter(r, "in_garage")).length,
    documents_missing: searched.filter((r) => matchesFilter(r, "documents_missing")).length,
  } satisfies Record<FleetFilter, number>;

  const rows = searched.filter((r) => matchesFilter(r, filter));

  const plate = (r: FleetVehicleRow) => r.vehicle.license_plate ?? "";
  const name = (r: FleetVehicleRow) => vehicleLabel(r.vehicle);

  rows.sort((a, b) => {
    switch (sort) {
      case "license_plate":
        return plate(a).localeCompare(plate(b));
      case "name":
        return name(a).localeCompare(name(b));
      case "next_service":
        return (
          deadlineSortKey(a.service.date) - deadlineSortKey(b.service.date)
        );
      case "document_expiry":
        return (
          deadlineSortKey(a.documents.nearestExpiry) -
          deadlineSortKey(b.documents.nearestExpiry)
        );
      case "cost":
        return (b.monthCost ?? -1) - (a.monthCost ?? -1) || plate(a).localeCompare(plate(b));
      case "status": {
        const byStatus = compareOperationalStatus(
          a.vehicle.operational_status,
          b.vehicle.operational_status,
        );
        return byStatus !== 0 ? byStatus : plate(a).localeCompare(plate(b));
      }
      case "recently_updated":
        return Date.parse(b.vehicle.updated_at) - Date.parse(a.vehicle.updated_at);
      case "urgency":
      default: {
        const byUrgency = urgencyKey(a) - urgencyKey(b);
        if (byUrgency !== 0) return byUrgency;
        const byCount = b.actions.length - a.actions.length;
        if (byCount !== 0) return byCount;
        return plate(a).localeCompare(plate(b));
      }
    }
  });

  return { rows, counts, costs, totalCount: allRows.length };
}

/**
 * Operational fleet detail for a single vehicle, reusing the same rules as the
 * dashboard so a status can never differ between the two screens.
 */
export async function getFleetVehicleDetail(
  vehicleId: string,
): Promise<{ row: FleetVehicleRow; currency: string } | null> {
  const { organizationId } = await requireOrganization();
  const { vehicles, issues, docs, costs } = await fetchFleetData(organizationId);
  // The vehicle must be in the caller's organization: a forged id simply is not
  // in this org-scoped set, so it resolves to null rather than leaking.
  const rows = buildRows(vehicles, issues, docs, costs);
  const row = rows.find((r) => r.vehicle.id === vehicleId);
  return row ? { row, currency: costs.currency } : null;
}

export { needsAttention };
export type { OperationalStatus, FleetAction, FleetCostSummary };
