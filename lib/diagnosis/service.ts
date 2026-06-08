import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { runMockDiagnosis } from "@/lib/server/ai/mock-diagnosis";
import {
  getVehicleById,
  NotAuthenticatedError,
} from "@/lib/vehicles/service";
import {
  diagnosisResultSchema,
  DIAGNOSIS_SOURCE_TYPE,
  type DiagnosisInput,
  type DiagnosisMessage,
  type DiagnosisResult,
  type DiagnosisSession,
} from "./types";

/**
 * Server-only data access for diagnosis. Relies on Supabase RLS (owner-scoped)
 * AND verifies vehicle/session ownership. The mock provider runs server-side;
 * the browser never calls AI.
 */

export class VehicleNotFoundError extends Error {
  constructor() {
    super("Vehicle not found");
    this.name = "VehicleNotFoundError";
  }
}
export class SessionNotFoundError extends Error {
  constructor() {
    super("Diagnosis session not found");
    this.name = "SessionNotFoundError";
  }
}

const SESSION_COLUMNS =
  "id, owner_user_id, vehicle_id, title, status, mode, summary, created_at, updated_at";
const MESSAGE_COLUMNS =
  "id, session_id, role, content, metadata, created_at";

export interface DiagnosisSessionListItem extends DiagnosisSession {
  vehicle: { make: string | null; model: string | null } | null;
}

async function getUserId(supabase: SupabaseClient): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new NotAuthenticatedError();
  return user.id;
}

/** Recent diagnosis sessions for the current user (with vehicle name). */
export async function listSessions(): Promise<DiagnosisSessionListItem[]> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);

  const { data, error } = await supabase
    .from("diagnosis_sessions")
    .select(`${SESSION_COLUMNS}, vehicles(make, model)`)
    .eq("owner_user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw error;

  type Row = DiagnosisSession & {
    vehicles: { make: string | null; model: string | null } | null;
  };
  return ((data ?? []) as unknown as Row[]).map(({ vehicles, ...session }) => ({
    ...session,
    vehicle: vehicles,
  }));
}

/** A session plus its messages, owner-scoped. */
export async function getSessionWithMessages(
  sessionId: string,
): Promise<{ session: DiagnosisSession; messages: DiagnosisMessage[] } | null> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);

  const { data: session, error: sErr } = await supabase
    .from("diagnosis_sessions")
    .select(SESSION_COLUMNS)
    .eq("id", sessionId)
    .eq("owner_user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (sErr) throw sErr;
  if (!session) return null;

  const { data: messages, error: mErr } = await supabase
    .from("diagnosis_messages")
    .select(MESSAGE_COLUMNS)
    .eq("session_id", sessionId)
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: true });
  if (mErr) throw mErr;

  return {
    session: session as DiagnosisSession,
    messages: (messages ?? []) as DiagnosisMessage[],
  };
}

/**
 * Start a diagnosis: verify the vehicle, run the mock provider server-side,
 * and persist the session + user message + assistant (structured) message.
 */
export async function createDiagnosis(
  input: DiagnosisInput,
  locale: string,
): Promise<string> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);

  const vehicle = await getVehicleById(input.vehicleId);
  if (!vehicle) throw new VehicleNotFoundError();

  const mileage = input.mileage ?? null;
  const result = runMockDiagnosis({
    symptoms: input.symptoms,
    mileage,
    locale,
  });

  const title = input.symptoms.slice(0, 80);

  const { data: session, error: sErr } = await supabase
    .from("diagnosis_sessions")
    .insert({
      owner_user_id: userId,
      vehicle_id: input.vehicleId,
      title,
      status: "active",
      mode: "mock",
      summary: result.symptom_summary,
    })
    .select("id")
    .single();
  if (sErr) throw sErr;
  const sessionId = session.id as string;

  const { error: umErr } = await supabase.from("diagnosis_messages").insert({
    owner_user_id: userId,
    session_id: sessionId,
    role: "user",
    content: input.symptoms,
    metadata: { mileage },
  });
  if (umErr) throw umErr;

  const { error: amErr } = await supabase.from("diagnosis_messages").insert({
    owner_user_id: userId,
    session_id: sessionId,
    role: "assistant",
    content: result.symptom_summary,
    metadata: { diagnosis: result, mileage },
  });
  if (amErr) throw amErr;

  return sessionId;
}

/** Extract the structured diagnosis from a session's assistant message. */
export function extractDiagnosis(
  messages: DiagnosisMessage[],
): DiagnosisResult | null {
  const assistant = messages.find((m) => m.role === "assistant");
  if (!assistant) return null;
  const parsed = diagnosisResultSchema.safeParse(
    (assistant.metadata as { diagnosis?: unknown })?.diagnosis,
  );
  return parsed.success ? parsed.data : null;
}

/**
 * Create an issue_logs row from a diagnosis session (idempotent per session).
 * Returns the vehicle id to redirect to. Raises vehicle mileage upward only.
 */
export async function saveSessionAsIssue(sessionId: string): Promise<string> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);

  const data = await getSessionWithMessages(sessionId);
  if (!data) throw new SessionNotFoundError();
  const { session, messages } = data;
  if (!session.vehicle_id) throw new VehicleNotFoundError();

  const vehicle = await getVehicleById(session.vehicle_id);
  if (!vehicle) throw new VehicleNotFoundError();

  // Idempotent: if an issue already exists for this session, reuse it.
  const { data: existing } = await supabase
    .from("issue_logs")
    .select("id")
    .eq("diagnosis_session_id", sessionId)
    .eq("owner_user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing) return session.vehicle_id;

  const userMessage = messages.find((m) => m.role === "user");
  const symptoms = userMessage?.content ?? session.title ?? "—";
  const diagnosis = extractDiagnosis(messages);
  const severity = diagnosis?.safety_level ?? "monitor";

  const assistant = messages.find((m) => m.role === "assistant");
  const mileage =
    ((assistant?.metadata as { mileage?: number | null })?.mileage ??
      (userMessage?.metadata as { mileage?: number | null })?.mileage) ||
    null;

  const today = new Date().toISOString().slice(0, 10);

  const { error: insErr } = await supabase.from("issue_logs").insert({
    owner_user_id: userId,
    vehicle_id: session.vehicle_id,
    reported_at: today,
    mileage,
    title: symptoms.slice(0, 2000),
    status: "open",
    severity,
    trust_label: "user_entered",
    source_type: DIAGNOSIS_SOURCE_TYPE,
    diagnosis_session_id: sessionId,
  });
  if (insErr) throw insErr;

  // Raise vehicle mileage upward only.
  if (
    mileage != null &&
    (vehicle.current_mileage == null || mileage > vehicle.current_mileage)
  ) {
    await supabase
      .from("vehicles")
      .update({ current_mileage: mileage })
      .eq("id", session.vehicle_id)
      .eq("owner_user_id", userId);
  }

  return session.vehicle_id;
}
