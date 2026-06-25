import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getVehicleById, NotAuthenticatedError } from "@/lib/vehicles/service";
import {
  insuranceInputToRow,
  registrationInputToRow,
  inspectionInputToRow,
  type InsuranceInput,
  type RegistrationInput,
  type InspectionInput,
} from "./types";

/**
 * Server-only create flows for the owner-scoped insurance / registration /
 * inspection records. Every call verifies vehicle ownership (via the owner-
 * scoped getVehicleById) BEFORE inserting, and stamps owner_user_id + the
 * record source — never trusting a vehicleId on its own. Supabase RLS
 * (owner_user_id = auth.uid()) is the second line of defense.
 */

export class VehicleNotFoundError extends Error {
  constructor() {
    super("Vehicle not found");
    this.name = "VehicleNotFoundError";
  }
}

async function getUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new NotAuthenticatedError();
  return user.id;
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
  const userId = await getUserId();

  // Ownership of the vehicle is enforced here (getVehicleById is owner-scoped).
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
