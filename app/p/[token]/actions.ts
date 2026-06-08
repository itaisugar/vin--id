"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { sha256Hex } from "@/lib/passports/snapshot";

/**
 * Accept failure state. `error` is a translation key (under
 * `passports.accept.errors`). On success the action redirects to the buyer's
 * new vehicle, so it never returns.
 */
export type AcceptActionState = { error?: string };

/**
 * Accept a passport into the logged-in buyer's account. All copying + state
 * changes happen atomically inside the SECURITY DEFINER `accept_passport` RPC
 * (single transaction). The buyer is derived from the session inside the
 * function — never trusted from the client. Token hashing matches creation.
 */
export async function acceptPassportAction(
  rawToken: string,
): Promise<AcceptActionState> {
  const token = (rawToken ?? "").trim();
  if (!token) return { error: "generic" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "not_authenticated" };

  const { data, error } = await supabase.rpc("accept_passport", {
    p_token_hash: sha256Hex(token),
  });
  if (error || !data) return { error: "generic" };

  const envelope = data as { state: string; new_vehicle_id?: string };
  if (envelope.state === "ok" && envelope.new_vehicle_id) {
    revalidatePath("/vehicles");
    redirect(`/vehicles/${envelope.new_vehicle_id}?accepted=1`);
  }

  // Map known non-ok states to a message key; default to generic.
  const known = new Set([
    "not_authenticated",
    "not_found",
    "expired",
    "token_revoked",
    "passport_revoked",
    "accepted",
    "own_passport",
  ]);
  return { error: known.has(envelope.state) ? envelope.state : "generic" };
}
