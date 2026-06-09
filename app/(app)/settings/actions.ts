"use server";

import { headers } from "next/headers";
import * as z from "zod";
import { trackEvent } from "@/lib/analytics/track";
import { createClient } from "@/lib/supabase/server";

/**
 * Beta feedback submission. Stored in `beta_feedback` (insert-only RLS). No
 * email sending and no external tools. Values are translation keys on failure.
 */
export type FeedbackState = { error?: string; success?: boolean };

const emptyToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

const feedbackSchema = z.object({
  type: z.enum(["bug", "idea", "confusing", "other"]).default("other"),
  message: z
    .string({ error: "messageRequired" })
    .trim()
    .min(3, { error: "messageRequired" })
    .max(4000, { error: "tooLong" }),
  email: z.preprocess(
    emptyToUndefined,
    z.email({ error: "invalidEmail" }).optional(),
  ),
  page_url: z.preprocess(
    emptyToUndefined,
    z.string().max(2048).optional(),
  ),
});

export async function submitFeedbackAction(
  values: unknown,
): Promise<FeedbackState> {
  const parsed = feedbackSchema.safeParse(values);
  if (!parsed.success) {
    const first = z.flattenError(parsed.error).fieldErrors;
    const key =
      first.message?.[0] ?? first.email?.[0] ?? "submitFailed";
    return { error: key };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "submitFailed" };

  const userAgent = (await headers()).get("user-agent")?.slice(0, 500) ?? null;

  const { error } = await supabase.from("beta_feedback").insert({
    user_id: user.id,
    email: parsed.data.email ?? user.email ?? null,
    type: parsed.data.type,
    message: parsed.data.message,
    page_url: parsed.data.page_url ?? null,
    user_agent: userAgent,
  });
  if (error) return { error: "submitFailed" };

  // Non-sensitive: only the feedback type enum, never the message/email.
  await trackEvent({
    eventName: "beta_feedback_submitted",
    entityType: "feedback",
    metadata: { type: parsed.data.type },
  });

  return { success: true };
}

/**
 * Record an account-deletion *request* (no automated deletion in beta). Stored
 * as a `beta_feedback` row with type='deletion_request'. We never delete account
 * data, auth.users, or storage files here — the team follows up manually.
 */
export type DeletionRequestState = { error?: string; success?: boolean };

export async function requestAccountDeletionAction(
  pageUrl?: string,
): Promise<DeletionRequestState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "submitFailed" };

  const { error } = await supabase.from("beta_feedback").insert({
    user_id: user.id,
    email: user.email ?? null,
    type: "deletion_request",
    message: "Account deletion requested from Settings → Data & privacy.",
    page_url: typeof pageUrl === "string" ? pageUrl.slice(0, 2048) : null,
  });
  if (error) return { error: "submitFailed" };

  return { success: true };
}
