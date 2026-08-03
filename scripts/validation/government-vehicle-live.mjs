#!/usr/bin/env node
/**
 * OPT-IN live check against the real data.gov.il provider. NOT part of CI.
 *
 * Runs one real lookup end-to-end through the production adapter and prints a
 * SANITIZED result (registration + VIN masked). It writes nothing to any
 * database. Use only with a registration number you are approved to test.
 *
 * Usage:
 *   GOV_VEHICLE_LIVE_TEST=1 npm run validate:government-vehicle-live -- <registration>
 */

import { lookupVehicle } from "../../lib/vehicle-lookup/service.ts";

if (process.env.GOV_VEHICLE_LIVE_TEST !== "1") {
  console.error("Refusing to call the live API. Set GOV_VEHICLE_LIVE_TEST=1 to opt in.");
  process.exit(2);
}

const reg = process.argv[2];
if (!reg) {
  console.error("Usage: GOV_VEHICLE_LIVE_TEST=1 npm run validate:government-vehicle-live -- <registration>");
  process.exit(2);
}

function mask(result) {
  const c = JSON.parse(JSON.stringify(result));
  if (c.vehicle) {
    if (c.vehicle.registration_number)
      c.vehicle.registration_number = String(c.vehicle.registration_number).replace(/.(?=.{2})/g, "*");
    if (c.vehicle.vin) c.vehicle.vin = "***MASKED***";
  }
  return c;
}

const started = Date.now();
const result = await lookupVehicle(reg);
console.log(`status: ${result.status}  (${Date.now() - started}ms)`);
console.log(JSON.stringify(mask(result), null, 2));
process.exit(0);
