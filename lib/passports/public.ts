import "server-only";

import { createClient } from "@/lib/supabase/server";
import { sha256Hex } from "./snapshot";
import type {
  PassportSnapshot,
  PassportSummary,
  PassportStatus,
} from "./types";

/**
 * Curated, safe public view of a passport. Built from the SECURITY DEFINER RPC
 * result — never includes owner_user_id, public_id, server_signature, storage
 * paths, or the token hash.
 */
export interface PublicPassportView {
  status: PassportStatus;
  issued_at: string | null;
  expires_at: string | null;
  snapshot_hash: string | null;
  record_confidence_score: number | null;
  snapshot: PassportSnapshot;
  ai_summary: PassportSummary | Record<string, never>;
}

export type PublicPassportState =
  | "ok"
  | "not_found"
  | "expired"
  | "token_revoked"
  | "passport_revoked"
  | "accepted"
  | "invalid";

export type PublicPassportResult =
  | { state: "ok"; view: PublicPassportView }
  | { state: Exclude<PublicPassportState, "ok"> };

interface RpcEnvelope {
  state: PublicPassportState;
  passport?: PublicPassportView;
}

/**
 * Validate a raw share token and return curated passport data (read-only).
 * Hashing matches passport creation (sha256 hex). All DB access goes through
 * the SECURITY DEFINER RPC — the browser never queries the raw tables, and
 * viewing never mutates token/passport state.
 */
export async function getPublicPassport(
  rawToken: string,
): Promise<PublicPassportResult> {
  const token = (rawToken ?? "").trim();
  if (!token) return { state: "not_found" };

  const tokenHash = sha256Hex(token);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_public_passport", {
    p_token_hash: tokenHash,
  });

  if (error || !data) return { state: "invalid" };

  const envelope = data as RpcEnvelope;
  if (envelope.state === "ok" && envelope.passport) {
    return { state: "ok", view: envelope.passport };
  }
  if (envelope.state === "ok") {
    // Defensive: "ok" with no payload is treated as invalid.
    return { state: "invalid" };
  }
  return { state: envelope.state };
}

/**
 * Whether the currently logged-in user is the OWNER of the passport behind this
 * token. Uses the caller's own session: transfer_tokens RLS is owner-scoped, so
 * the row is only visible to the owner. Returns false for anonymous users and
 * non-owners — without ever exposing the owner's id.
 */
export async function isTokenOwner(rawToken: string): Promise<boolean> {
  const token = (rawToken ?? "").trim();
  if (!token) return false;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data } = await supabase
    .from("transfer_tokens")
    .select("id")
    .eq("token_hash", sha256Hex(token))
    .maybeSingle();

  return Boolean(data);
}
