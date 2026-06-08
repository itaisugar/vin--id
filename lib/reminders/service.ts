import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  getVehicleById,
  NotAuthenticatedError,
} from "@/lib/vehicles/service";
import {
  REMINDER_COLUMNS,
  reminderInputToRow,
  type Reminder,
  type ReminderInput,
} from "./types";

/**
 * Server-only data access for reminders. Relies on Supabase RLS (owner-scoped)
 * AND additionally verifies ownership of the vehicle and the reminder.
 *
 * TODO(notifications): email/push delivery is out of scope for this phase.
 * Urgency is derived and shown in the UI only; no background jobs run.
 */

export class VehicleNotFoundError extends Error {
  constructor() {
    super("Vehicle not found");
    this.name = "VehicleNotFoundError";
  }
}

export class ReminderNotFoundError extends Error {
  constructor() {
    super("Reminder not found");
    this.name = "ReminderNotFoundError";
  }
}

/** A reminder plus the minimal vehicle info needed by the dashboard. */
export interface ReminderWithVehicle {
  reminder: Reminder;
  vehicle: {
    id: string;
    make: string | null;
    model: string | null;
    current_mileage: number | null;
  };
}

async function getUserId(supabase: SupabaseClient): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new NotAuthenticatedError();
  return user.id;
}

/** All non-deleted reminders for a vehicle (any status). */
export async function listReminders(vehicleId: string): Promise<Reminder[]> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);

  const { data, error } = await supabase
    .from("reminders")
    .select(REMINDER_COLUMNS)
    .eq("vehicle_id", vehicleId)
    .eq("owner_user_id", userId)
    .is("deleted_at", null)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as Reminder[];
}

/** A single non-deleted reminder for a vehicle owned by the user, or null. */
export async function getReminder(
  vehicleId: string,
  reminderId: string,
): Promise<Reminder | null> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);

  const { data, error } = await supabase
    .from("reminders")
    .select(REMINDER_COLUMNS)
    .eq("id", reminderId)
    .eq("vehicle_id", vehicleId)
    .eq("owner_user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  return (data as Reminder | null) ?? null;
}

export async function createReminder(
  vehicleId: string,
  input: ReminderInput,
): Promise<string> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);

  const vehicle = await getVehicleById(vehicleId);
  if (!vehicle) throw new VehicleNotFoundError();

  const completedAt =
    input.status === "completed" ? new Date().toISOString() : null;

  const { data, error } = await supabase
    .from("reminders")
    .insert({
      ...reminderInputToRow(input),
      completed_at: completedAt,
      vehicle_id: vehicleId,
      owner_user_id: userId,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

export async function updateReminder(
  vehicleId: string,
  reminderId: string,
  input: ReminderInput,
): Promise<void> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);

  const existing = await getReminder(vehicleId, reminderId);
  if (!existing) throw new ReminderNotFoundError();

  const completedAt =
    input.status === "completed"
      ? (existing.completed_at ?? new Date().toISOString())
      : null;

  const { error } = await supabase
    .from("reminders")
    .update({ ...reminderInputToRow(input), completed_at: completedAt })
    .eq("id", reminderId)
    .eq("vehicle_id", vehicleId)
    .eq("owner_user_id", userId)
    .is("deleted_at", null);

  if (error) throw error;
}

/** Quick action: set a terminal status (completed/dismissed). */
export async function setReminderStatus(
  vehicleId: string,
  reminderId: string,
  status: "completed" | "dismissed",
): Promise<void> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);

  const existing = await getReminder(vehicleId, reminderId);
  if (!existing) throw new ReminderNotFoundError();

  const { error } = await supabase
    .from("reminders")
    .update({
      status,
      completed_at:
        status === "completed"
          ? (existing.completed_at ?? new Date().toISOString())
          : null,
    })
    .eq("id", reminderId)
    .eq("vehicle_id", vehicleId)
    .eq("owner_user_id", userId)
    .is("deleted_at", null);

  if (error) throw error;
}

/** Soft delete: set deleted_at. Never hard-deletes. */
export async function softDeleteReminder(
  vehicleId: string,
  reminderId: string,
): Promise<void> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);

  const { error } = await supabase
    .from("reminders")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", reminderId)
    .eq("vehicle_id", vehicleId)
    .eq("owner_user_id", userId)
    .is("deleted_at", null);

  if (error) throw error;
}

/**
 * Active reminders across all of the user's active vehicles, for the dashboard.
 * Sorting/urgency is computed by the caller (needs each vehicle's mileage).
 */
export async function listActiveRemindersForUser(): Promise<
  ReminderWithVehicle[]
> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);

  const { data, error } = await supabase
    .from("reminders")
    .select(
      `${REMINDER_COLUMNS}, vehicles!inner(id, make, model, current_mileage, status, deleted_at)`,
    )
    .eq("owner_user_id", userId)
    .eq("status", "pending")
    .is("deleted_at", null)
    .eq("vehicles.status", "active")
    .is("vehicles.deleted_at", null);

  if (error) throw error;

  type Row = Reminder & {
    vehicles: {
      id: string;
      make: string | null;
      model: string | null;
      current_mileage: number | null;
    };
  };

  return ((data ?? []) as unknown as Row[]).map((row) => {
    const { vehicles, ...reminder } = row;
    return { reminder: reminder as Reminder, vehicle: vehicles };
  });
}
