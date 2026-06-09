import "server-only";

import { createClient } from "@/lib/supabase/server";
import { sha256Hex } from "@/lib/passports/snapshot";

/**
 * Privacy-safe, first-party product event tracking (Phase 6E-lite).
 *
 * Events are written to the `app_events` table in Supabase — NO third-party
 * analytics, NO external SDK. Tracking is best-effort and MUST never break the
 * user flow: every function here swallows its own errors.
 *
 * Privacy rules enforced here:
 *  - Only authenticated events go through `trackEvent` (RLS: user_id = auth.uid()).
 *  - Metadata is sanitized: forbidden / sensitive-looking keys are dropped,
 *    nested objects are discarded, and strings are truncated. Keep payloads to
 *    counts, booleans, enums, and short source labels.
 *  - We never store document text, symptoms, diagnosis text, VIN, license plate,
 *    storage paths, raw tokens, token hashes, email, phone, address, etc.
 */

type MetaPrimitive = string | number | boolean | null;

export interface TrackEventInput {
  eventName: string;
  entityType?: string | null;
  entityId?: string | null;
  vehicleId?: string | null;
  passportId?: string | null;
  metadata?: Record<string, unknown>;
}

/** Exact keys that must never appear in metadata. */
const FORBIDDEN_KEYS = new Set([
  "symptoms",
  "diagnosis",
  "result",
  "vin",
  "license_plate",
  "plate",
  "storage_path",
  "token",
  "raw_token",
  "token_hash",
  "email",
  "phone",
  "address",
  "payment",
  "message",
  "vendor",
  "title",
  "description",
  "file_name",
  "filename",
  "name",
]);

/** Any key containing one of these substrings is also dropped (defense in depth). */
const FORBIDDEN_SUBSTRING =
  /(symptom|diagnos|vin|plate|token|storage|email|phone|address|payment|filename|file_name|message|vendor|secret|password|content|text|note)/;

const MAX_STRING_LEN = 64;
const MAX_KEYS = 12;

/**
 * Keep only small, non-sensitive primitives. Objects/arrays are discarded so a
 * caller can never accidentally nest sensitive content. Strings are truncated.
 */
function sanitizeMetadata(meta?: Record<string, unknown>): Record<string, MetaPrimitive> {
  const out: Record<string, MetaPrimitive> = {};
  if (!meta) return out;

  let count = 0;
  for (const [key, value] of Object.entries(meta)) {
    if (count >= MAX_KEYS) break;
    const lower = key.toLowerCase();
    if (FORBIDDEN_KEYS.has(lower) || FORBIDDEN_SUBSTRING.test(lower)) continue;

    if (value === null || value === undefined) {
      out[key] = null;
    } else if (typeof value === "boolean" || typeof value === "number") {
      out[key] = value;
    } else if (typeof value === "string") {
      out[key] = value.slice(0, MAX_STRING_LEN);
    } else {
      // Skip objects, arrays, functions, etc. — keep payloads small and safe.
      continue;
    }
    count += 1;
  }
  return out;
}

/**
 * Log an authenticated product event. No-op (silently) for signed-out callers —
 * anonymous public-preview events use `trackPublicPreviewOpened` instead.
 */
export async function trackEvent(input: TrackEventInput): Promise<void> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from("app_events").insert({
      user_id: user.id,
      event_name: input.eventName,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      vehicle_id: input.vehicleId ?? null,
      passport_id: input.passportId ?? null,
      metadata: sanitizeMetadata(input.metadata),
    });
  } catch {
    // Tracking must never surface an error to the user.
  }
}

/**
 * Log `passport_public_preview_opened` for the /p/[token] page. Works for
 * anonymous visitors via the SECURITY DEFINER `log_passport_preview` function,
 * which validates the token server-side and stores ONLY the passport id. The
 * raw token is hashed here and never stored; the hash is passed as a lookup
 * argument and is not persisted by the function.
 */
export async function trackPublicPreviewOpened(rawToken: string): Promise<void> {
  try {
    const token = (rawToken ?? "").trim();
    if (!token) return;
    const supabase = await createClient();
    await supabase.rpc("log_passport_preview", {
      p_token_hash: sha256Hex(token),
    });
  } catch {
    // Tracking must never break the public preview.
  }
}
