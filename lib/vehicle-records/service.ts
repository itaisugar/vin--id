import "server-only";

import { requireFleetWriter } from "@/lib/organizations/service";
import { createClient } from "@/lib/supabase/server";
import { getVehicleById } from "@/lib/vehicles/service";
import {
  insuranceInputToRow,
  registrationInputToRow,
  inspectionInputToRow,
  type InsuranceInput,
  type RegistrationInput,
  type InspectionInput,
} from "./types";

/**
 * Server-only create flows for the organization-scoped insurance / registration
 * / inspection records. Every call verifies vehicle membership (via the
 * organization-scoped getVehicleById) BEFORE inserting, and stamps
 * owner_user_id + the record source — never trusting a vehicleId on its own.
 *
 * AUTHORIZATION MIRRORS THE DATABASE. The RLS insert policy on all three tables
 * is `organization_id = current_org_id() AND is_org_writer()`, so the server
 * gate is `requireFleetWriter()`. Previously this module resolved only the
 * authenticated user id and performed no role check at all: a viewer or a driver
 * got as far as issuing the INSERT and was stopped solely by RLS, surfacing an
 * opaque database error instead of a clear refusal. RLS remains the second,
 * independent enforcement layer.
 */

export class VehicleNotFoundError extends Error {
  constructor() {
    super("Vehicle not found");
    this.name = "VehicleNotFoundError";
  }
}

/**
 * Insert a row into a vehicle-scoped record table after an ownership check.
 * `documentId` optionally links the record to a saved vehicle_documents row
 * (e.g. the persisted scan image).
 */
async function createVehicleRecord(
  table: "vehicle_insurance" | "vehicle_registration" | "vehicle_inspection",
  vehicleId: string,
  row: Record<string, unknown>,
  sourceType: string,
  documentId: string | null,
): Promise<string> {
  const supabase = await createClient();
  // Rejects an unauthenticated caller, a user with no membership, and any
  // viewer or driver — before the INSERT is ever issued.
  const { userId } = await requireFleetWriter();

  // Membership of the vehicle is enforced here (getVehicleById is org-scoped).
  const vehicle = await getVehicleById(vehicleId);
  if (!vehicle) throw new VehicleNotFoundError();

  const { data, error } = await supabase
    .from(table)
    .insert({
      ...row,
      vehicle_id: vehicleId,
      owner_user_id: userId,
      source_type: sourceType,
      document_id: documentId,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

export function createInsurance(
  vehicleId: string,
  input: InsuranceInput,
  sourceType: string = "user",
  documentId: string | null = null,
): Promise<string> {
  return createVehicleRecord(
    "vehicle_insurance",
    vehicleId,
    insuranceInputToRow(input),
    sourceType,
    documentId,
  );
}

export function createRegistration(
  vehicleId: string,
  input: RegistrationInput,
  sourceType: string = "user",
  documentId: string | null = null,
): Promise<string> {
  return createVehicleRecord(
    "vehicle_registration",
    vehicleId,
    registrationInputToRow(input),
    sourceType,
    documentId,
  );
}

export function createInspection(
  vehicleId: string,
  input: InspectionInput,
  sourceType: string = "user",
  documentId: string | null = null,
): Promise<string> {
  return createVehicleRecord(
    "vehicle_inspection",
    vehicleId,
    inspectionInputToRow(input),
    sourceType,
    documentId,
  );
}
