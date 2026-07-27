/**
 * Reproducible local Fleet dataset.
 *
 * Builds ONE organization with 50+ vehicles in real application tables
 * (`vehicles`, `issue_logs`, `vehicle_documents`, `maintenance_logs`) so the
 * Fleet Manager surfaces can be exercised against data of the shape and size a
 * real customer has. Nothing here is a frontend mock array, and none of it ships
 * in the product — there is no "demo mode".
 *
 * DETERMINISTIC: every vehicle is generated from its index, so the same call
 * produces the same fleet and a failing assertion can be reproduced exactly.
 * Dates are relative to "today" so the scenarios stay meaningful whenever it is
 * run.
 *
 * The generated scenarios, by index (i = 0..count-1):
 *
 *   i % 10 === 0   service overdue by DATE (45 days ago)
 *   i % 10 === 1   service due soon by DATE (10 days out)
 *   i % 10 === 2   service overdue by MILEAGE (target below the odometer)
 *   i % 10 === 3   test certificate EXPIRED (20 days ago)
 *   i % 10 === 4   insurance EXPIRING soon (12 days out)
 *   i % 10 === 5   uploaded document EXPIRED (5 days ago)
 *   i % 10 === 6   one open issue, severity 'mechanic_recommended'
 *   i % 10 === 7   two open issues, one 'urgent'  (repeated + high priority)
 *   i % 10 === 8   incomplete: no service date, no mileage target, no driver
 *   i % 10 === 9   clean vehicle: nothing due, nothing open
 *
 * Costs (current month, ILS):
 *   i % 10 === 7   HIGH cost (12,000) — the intended cost anomaly
 *   i % 3  === 0   low cost (250)
 *   i % 3  === 1   mid cost (900)
 *   i % 3  === 2   NULL cost (recorded service, amount unknown)
 *
 * Drivers: assigned on even indices, unassigned on odd (except i%10===8, which
 * is deliberately incomplete).
 */

const DAY = 86_400_000;

/** "yyyy-mm-dd", `days` from today (negative = past). */
function isoDay(days) {
  return new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
}

/** A date inside the current month, so monthly cost attribution is exercised. */
function isoThisMonth(dayOfMonth = 5) {
  const now = new Date();
  const day = String(Math.max(1, Math.min(dayOfMonth, 28))).padStart(2, "0");
  return `${now.toISOString().slice(0, 7)}-${day}`;
}

const MAKES = ["Toyota", "Ford", "Renault", "Hyundai", "Peugeot", "Mercedes"];
const MODELS = ["Transit", "Master", "Hiace", "Sprinter", "Partner", "Vito"];
const TYPES = ["van", "truck", "pickup", "car"];
const DRIVERS = ["Dana Cohen", "Yossi Levi", "Maya Bar", "Avi Mizrahi", "Noa Katz"];

/**
 * Create the fleet. `admin` must be a service-role client (fixtures only) and
 * `ownerId` the user whose organization receives the vehicles.
 *
 * Returns a description of what was generated so a harness can assert against
 * expected counts rather than hard-coded magic numbers.
 */
export async function seedFleet(admin, { ownerId, organizationId, count = 50 }) {
  const vehicles = [];

  for (let i = 0; i < count; i += 1) {
    const scenario = i % 10;
    const mileage = 40_000 + i * 1_300;

    const row = {
      owner_user_id: ownerId,
      organization_id: organizationId,
      make: MAKES[i % MAKES.length],
      model: MODELS[i % MODELS.length],
      year: 2016 + (i % 8),
      license_plate: `FL-${String(1000 + i)}`,
      vin: `FLEETVIN${String(i).padStart(8, "0")}`,
      vehicle_type: TYPES[i % TYPES.length],
      current_mileage: mileage,
      mileage_unit: "km",
      status: "active",
      operational_status: "active",
      assigned_driver_name:
        scenario === 8 ? null : i % 2 === 0 ? DRIVERS[i % DRIVERS.length] : null,
      next_service_date: isoDay(200),
      next_service_km: mileage + 8_000,
      test_expiry_date: isoDay(300),
      insurance_expiry_date: isoDay(280),
    };

    switch (scenario) {
      case 0:
        row.next_service_date = isoDay(-45);
        break;
      case 1:
        row.next_service_date = isoDay(10);
        break;
      case 2:
        // Target BELOW the odometer: overdue, not invalid data.
        row.next_service_km = mileage - 1_500;
        break;
      case 3:
        row.test_expiry_date = isoDay(-20);
        break;
      case 4:
        row.insurance_expiry_date = isoDay(12);
        break;
      case 8:
        row.next_service_date = null;
        row.next_service_km = null;
        row.test_expiry_date = null;
        row.insurance_expiry_date = null;
        row.current_mileage = null;
        break;
      default:
        break;
    }

    vehicles.push(row);
  }

  const { data: inserted, error } = await admin
    .from("vehicles")
    .insert(vehicles)
    .select("id, license_plate");
  if (error) throw new Error(`seedFleet vehicles: ${error.message}`);

  // Insert order is not guaranteed; index by plate, which encodes the scenario.
  const byIndex = new Map(
    inserted.map((v) => [Number(v.license_plate.split("-")[1]) - 1000, v.id]),
  );

  const issues = [];
  const documents = [];
  const maintenance = [];

  for (let i = 0; i < count; i += 1) {
    const vehicleId = byIndex.get(i);
    if (!vehicleId) continue;
    const scenario = i % 10;
    const base = {
      owner_user_id: ownerId,
      organization_id: organizationId,
      vehicle_id: vehicleId,
    };

    if (scenario === 5) {
      documents.push({
        ...base,
        doc_type: "insurance",
        file_name: `policy-${i}.pdf`,
        mime_type: "application/pdf",
        expiry_date: isoDay(-5),
      });
    }

    if (scenario === 6) {
      issues.push({
        ...base,
        title: `Warning light ${i}`,
        status: "open",
        severity: "mechanic_recommended",
        reported_at: isoDay(-12),
      });
    }

    if (scenario === 7) {
      issues.push(
        {
          ...base,
          title: `Brake noise ${i}`,
          status: "open",
          severity: "urgent",
          reported_at: isoDay(-4),
        },
        {
          ...base,
          title: `Door seal ${i}`,
          status: "monitoring",
          severity: "monitor",
          reported_at: isoDay(-30),
        },
      );
    }

    // A resolved issue on every vehicle: proves "open" counts exclude it.
    issues.push({
      ...base,
      title: `Resolved item ${i}`,
      status: "resolved",
      severity: "info",
      reported_at: isoDay(-90),
    });

    // Current-month cost. The high-cost vehicles are the intended anomalies.
    const cost =
      scenario === 7 ? 12_000 : i % 3 === 0 ? 250 : i % 3 === 1 ? 900 : null;
    maintenance.push({
      ...base,
      service_type: "general",
      performed_at: isoThisMonth(5 + (i % 20)),
      cost,
      currency: "ILS",
      mileage: 40_000 + i * 1_300,
    });

    // A cost in a PREVIOUS month, which must never land in this month's total.
    maintenance.push({
      ...base,
      service_type: "previous-month",
      performed_at: isoDay(-75),
      cost: 5_000,
      currency: "ILS",
    });
  }

  for (const [table, rows] of [
    ["issue_logs", issues],
    ["vehicle_documents", documents],
    ["maintenance_logs", maintenance],
  ]) {
    if (rows.length === 0) continue;
    const { error: insertError } = await admin.from(table).insert(rows);
    if (insertError) throw new Error(`seedFleet ${table}: ${insertError.message}`);
  }

  const per = (predicate) =>
    Array.from({ length: count }, (_, i) => i).filter(predicate).length;

  return {
    organizationId,
    vehicleCount: count,
    vehicleIdsByIndex: byIndex,
    expected: {
      total: count,
      serviceOverdue: per((i) => i % 10 === 0 || i % 10 === 2),
      serviceDueSoon: per((i) => i % 10 === 1),
      serviceUnknown: per((i) => i % 10 === 8),
      documentsExpired: per((i) => i % 10 === 3) + per((i) => i % 10 === 5),
      documentsExpiringSoon: per((i) => i % 10 === 4),
      openIssues: per((i) => i % 10 === 6) + per((i) => i % 10 === 7) * 2,
      highPriorityIssues: per((i) => i % 10 === 7),
      vehiclesWithOpenIssues: per((i) => i % 10 === 6 || i % 10 === 7),
      driverUnassigned: per((i) => i % 10 === 8 || i % 2 !== 0),
      monthCost:
        per((i) => i % 10 === 7) * 12_000 +
        per((i) => i % 3 === 0 && i % 10 !== 7) * 250 +
        per((i) => i % 3 === 1 && i % 10 !== 7) * 900,
      unknownCostCount: per((i) => i % 3 === 2 && i % 10 !== 7),
    },
  };
}
