import "server-only";

import { requireOrganization } from "@/lib/organizations/service";
import { createClient } from "@/lib/supabase/server";
import { VEHICLE_COLUMNS, type Vehicle } from "@/lib/vehicles/types";
import {
  classifyDeadline,
  classifyKmDeadline,
  deadlineSortKey,
  worstDeadline,
  type DeadlineState,
} from "./dates";
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
 * PERFORMANCE: the whole dashboard is built from FOUR org-scoped queries, with
 * all joining/counting done in memory. At the target scale (10–80 vehicles)
 * that is strictly cheaper than per-vehicle round trips, and it structurally
 * rules out N+1: nothing here runs a query inside a loop. Only the columns
 * needed are selected — no full maintenance/issue/document rows are fetched
 * just to derive a count or a nearest date.
 *
 * SCOPING: `requireOrganization()` resolves the org from the session; every
 * query then filters on it explicitly, on top of RLS.
 */

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------
export interface FleetSummary {
  totalVehicles: number;
  active: number;
  needsService: number;
  issueOpen: number;
  outOfService: number;
  inGarage: number;
  documentsMissing: number;
  /** Vehicles with at least one document/test/insurance deadline due or past. */
  documentsAttention: number;
  /** Vehicles with a service due soon or overdue (by date or by KM). */
  upcomingMaintenance: number;
  /** Reminders + deadlines already past their date. */
  overdueItems: number;
  openIssues: number;
}

export type AttentionReason =
  | { kind: "status"; status: OperationalStatus }
  | { kind: "open_issues"; count: number }
  | { kind: "service_due"; state: DeadlineState; date: string | null }
  | { kind: "service_due_km"; state: DeadlineState; dueKm: number }
  | { kind: "test_expiry"; state: DeadlineState; date: string }
  | { kind: "insurance_expiry"; state: DeadlineState; date: string };

export interface VehicleAttention {
  vehicle: Vehicle;
  openIssueCount: number;
  reasons: AttentionReason[];
  /** Worst deadline across this vehicle, for sorting. */
  worst: DeadlineState | null;
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
  /** ISO date, or null for a KM-only service target. */
  date: string | null;
  /** Present only for the KM-based service deadline. */
  dueKm?: number;
  state: DeadlineState;
  /** Free label for document/reminder rows (document type, reminder title). */
  label?: string | null;
}

export interface FleetOverview {
  summary: FleetSummary;
  attention: VehicleAttention[];
  deadlines: FleetDeadline[];
  vehicles: Vehicle[];
  openIssueCountByVehicle: Map<string, number>;
}

/** Issue statuses that count as "open" (i.e. not yet resolved). */
const OPEN_ISSUE_STATUSES = ["open", "monitoring"] as const;

/** Max rows rendered in the dashboard's two lists. */
const ATTENTION_LIMIT = 12;
const DEADLINE_LIMIT = 12;

function vehicleLabel(v: Vehicle): string {
  return [v.make, v.model].filter(Boolean).join(" ").trim();
}

// -----------------------------------------------------------------------------
// Overview
// -----------------------------------------------------------------------------
export async function getFleetOverview(): Promise<FleetOverview> {
  const supabase = await createClient();
  const { organizationId } = await requireOrganization();

  // The operating fleet = lifecycle-active vehicles. Archived/sold vehicles are
  // history, not fleet, so they are excluded from every count below.
  const [vehiclesRes, issuesRes, docsRes, remindersRes] = await Promise.all([
    supabase
      .from("vehicles")
      .select(VEHICLE_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),

    // Only the join key is selected — counting happens in memory.
    supabase
      .from("issue_logs")
      .select("id, vehicle_id, status")
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
  ]);

  if (vehiclesRes.error) throw vehiclesRes.error;
  if (issuesRes.error) throw issuesRes.error;
  if (docsRes.error) throw docsRes.error;
  if (remindersRes.error) throw remindersRes.error;

  const vehicles = (vehiclesRes.data ?? []) as Vehicle[];
  const byId = new Map(vehicles.map((v) => [v.id, v]));

  // --- open issue counts -----------------------------------------------------
  const openIssueCountByVehicle = new Map<string, number>();
  for (const row of issuesRes.data ?? []) {
    const vid = (row as { vehicle_id: string }).vehicle_id;
    if (!byId.has(vid)) continue; // issue on an archived/sold vehicle
    openIssueCountByVehicle.set(vid, (openIssueCountByVehicle.get(vid) ?? 0) + 1);
  }

  // --- per-vehicle attention -------------------------------------------------
  const attention: VehicleAttention[] = [];
  let documentsAttention = 0;
  let upcomingMaintenance = 0;
  let overdueItems = 0;

  for (const v of vehicles) {
    const reasons: AttentionReason[] = [];

    if (needsAttention(v.operational_status)) {
      reasons.push({ kind: "status", status: v.operational_status });
    }

    const openCount = openIssueCountByVehicle.get(v.id) ?? 0;
    if (openCount > 0) reasons.push({ kind: "open_issues", count: openCount });

    const serviceDate = classifyDeadline(v.next_service_date);
    if (serviceDate === "overdue" || serviceDate === "due_soon") {
      reasons.push({
        kind: "service_due",
        state: serviceDate,
        date: v.next_service_date,
      });
    }

    const serviceKm = classifyKmDeadline(v.next_service_km, v.current_mileage);
    if (serviceKm === "overdue" || serviceKm === "due_soon") {
      reasons.push({
        kind: "service_due_km",
        state: serviceKm,
        dueKm: v.next_service_km as number,
      });
    }

    const test = classifyDeadline(v.test_expiry_date);
    if ((test === "overdue" || test === "due_soon") && v.test_expiry_date) {
      reasons.push({
        kind: "test_expiry",
        state: test,
        date: v.test_expiry_date,
      });
    }

    const insurance = classifyDeadline(v.insurance_expiry_date);
    if (
      (insurance === "overdue" || insurance === "due_soon") &&
      v.insurance_expiry_date
    ) {
      reasons.push({
        kind: "insurance_expiry",
        state: insurance,
        date: v.insurance_expiry_date,
      });
    }

    if (serviceDate === "overdue" || serviceDate === "due_soon" ||
        serviceKm === "overdue" || serviceKm === "due_soon") {
      upcomingMaintenance += 1;
    }

    if (
      test === "overdue" || test === "due_soon" ||
      insurance === "overdue" || insurance === "due_soon" ||
      v.operational_status === "documents_missing"
    ) {
      documentsAttention += 1;
    }

    if (serviceDate === "overdue" || serviceKm === "overdue" ||
        test === "overdue" || insurance === "overdue") {
      overdueItems += 1;
    }

    if (reasons.length > 0) {
      attention.push({
        vehicle: v,
        openIssueCount: openCount,
        reasons,
        worst: worstDeadline(serviceDate, serviceKm, test, insurance),
      });
    }
  }

  // Worst operational status first, then worst deadline, then plate.
  const DEADLINE_RANK: Record<DeadlineState, number> = {
    overdue: 0,
    due_soon: 1,
    upcoming: 2,
  };
  attention.sort((a, b) => {
    const byStatus = compareOperationalStatus(
      a.vehicle.operational_status,
      b.vehicle.operational_status,
    );
    if (byStatus !== 0) return byStatus;

    const aRank = a.worst ? DEADLINE_RANK[a.worst] : 3;
    const bRank = b.worst ? DEADLINE_RANK[b.worst] : 3;
    if (aRank !== bRank) return aRank - bRank;

    return (a.vehicle.license_plate ?? "").localeCompare(
      b.vehicle.license_plate ?? "",
    );
  });

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

  for (const row of docsRes.data ?? []) {
    const d = row as {
      vehicle_id: string;
      doc_type: string | null;
      expiry_date: string | null;
    };
    const v = byId.get(d.vehicle_id);
    if (!v) continue;
    pushDeadline(v, "document_expiry", d.expiry_date, { label: d.doc_type });
  }

  for (const row of remindersRes.data ?? []) {
    const r = row as {
      vehicle_id: string;
      title: string | null;
      due_date: string | null;
    };
    const v = byId.get(r.vehicle_id);
    if (!v) continue;
    pushDeadline(v, "reminder", r.due_date, { label: r.title });
  }

  // Closest deadline first.
  deadlines.sort((a, b) => deadlineSortKey(a.date) - deadlineSortKey(b.date));

  // --- summary ---------------------------------------------------------------
  const countStatus = (s: OperationalStatus) =>
    vehicles.filter((v) => v.operational_status === s).length;

  const summary: FleetSummary = {
    totalVehicles: vehicles.length,
    active: countStatus("active"),
    needsService: countStatus("needs_service"),
    issueOpen: countStatus("issue_open"),
    outOfService: countStatus("out_of_service"),
    inGarage: countStatus("in_garage"),
    documentsMissing: countStatus("documents_missing"),
    documentsAttention,
    upcomingMaintenance,
    overdueItems,
    openIssues: [...openIssueCountByVehicle.values()].reduce((a, b) => a + b, 0),
  };

  return {
    summary,
    attention: attention.slice(0, ATTENTION_LIMIT),
    deadlines: deadlines.slice(0, DEADLINE_LIMIT),
    vehicles,
    openIssueCountByVehicle,
  };
}

// -----------------------------------------------------------------------------
// Vehicles list
// -----------------------------------------------------------------------------
export interface FleetVehicleRow {
  vehicle: Vehicle;
  openIssueCount: number;
  serviceState: DeadlineState | null;
  testState: DeadlineState | null;
  insuranceState: DeadlineState | null;
}

export interface FleetVehiclesResult {
  rows: FleetVehicleRow[];
  /** Count per filter, so the filter chips can show totals. */
  counts: Record<FleetFilter, number>;
}

/**
 * The organization's vehicles for the fleet list, with open-issue counts.
 *
 * Two queries total (vehicles + open issues); filtering and sorting happen in
 * memory so the filter chips can show accurate counts for every option without
 * one COUNT query per chip.
 */
export async function listFleetVehicles(
  filter: FleetFilter = "all",
  sort: FleetSort = "status",
): Promise<FleetVehiclesResult> {
  const supabase = await createClient();
  const { organizationId } = await requireOrganization();

  const [vehiclesRes, issuesRes] = await Promise.all([
    supabase
      .from("vehicles")
      .select(VEHICLE_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .is("deleted_at", null),

    supabase
      .from("issue_logs")
      .select("id, vehicle_id")
      .eq("organization_id", organizationId)
      .in("status", OPEN_ISSUE_STATUSES)
      .is("deleted_at", null),
  ]);

  if (vehiclesRes.error) throw vehiclesRes.error;
  if (issuesRes.error) throw issuesRes.error;

  const vehicles = (vehiclesRes.data ?? []) as Vehicle[];

  const openIssues = new Map<string, number>();
  for (const row of issuesRes.data ?? []) {
    const vid = (row as { vehicle_id: string }).vehicle_id;
    openIssues.set(vid, (openIssues.get(vid) ?? 0) + 1);
  }

  const allRows: FleetVehicleRow[] = vehicles.map((v) => ({
    vehicle: v,
    openIssueCount: openIssues.get(v.id) ?? 0,
    serviceState: worstDeadline(
      classifyDeadline(v.next_service_date),
      classifyKmDeadline(v.next_service_km, v.current_mileage),
    ),
    testState: classifyDeadline(v.test_expiry_date),
    insuranceState: classifyDeadline(v.insurance_expiry_date),
  }));

  const matches = (row: FleetVehicleRow, f: FleetFilter): boolean => {
    if (f === "all") return true;
    if (f === "needs_attention") return needsAttention(row.vehicle.operational_status);
    return row.vehicle.operational_status === f;
  };

  const counts = {
    all: allRows.length,
    needs_attention: allRows.filter((r) => matches(r, "needs_attention")).length,
    active: allRows.filter((r) => matches(r, "active")).length,
    needs_service: allRows.filter((r) => matches(r, "needs_service")).length,
    issue_open: allRows.filter((r) => matches(r, "issue_open")).length,
    out_of_service: allRows.filter((r) => matches(r, "out_of_service")).length,
    in_garage: allRows.filter((r) => matches(r, "in_garage")).length,
    documents_missing: allRows.filter((r) => matches(r, "documents_missing")).length,
  } satisfies Record<FleetFilter, number>;

  const rows = allRows.filter((r) => matches(r, filter));

  const closestDocExpiry = (v: Vehicle) =>
    Math.min(
      deadlineSortKey(v.test_expiry_date),
      deadlineSortKey(v.insurance_expiry_date),
    );

  rows.sort((a, b) => {
    switch (sort) {
      case "license_plate":
        return (a.vehicle.license_plate ?? "").localeCompare(
          b.vehicle.license_plate ?? "",
        );
      case "next_service":
        return (
          deadlineSortKey(a.vehicle.next_service_date) -
          deadlineSortKey(b.vehicle.next_service_date)
        );
      case "document_expiry":
        return closestDocExpiry(a.vehicle) - closestDocExpiry(b.vehicle);
      case "recently_updated":
        return (
          Date.parse(b.vehicle.updated_at) - Date.parse(a.vehicle.updated_at)
        );
      case "status":
      default: {
        const byStatus = compareOperationalStatus(
          a.vehicle.operational_status,
          b.vehicle.operational_status,
        );
        if (byStatus !== 0) return byStatus;
        return (a.vehicle.license_plate ?? "").localeCompare(
          b.vehicle.license_plate ?? "",
        );
      }
    }
  });

  return { rows, counts };
}
