"use server";

import { redirect } from "next/navigation";
import * as z from "zod";
import { trackEvent } from "@/lib/analytics/track";
import { createClient } from "@/lib/supabase/server";

/**
 * Auth form state. Error fields contain *translation keys* (under
 * `auth.errors`), not literal text — the client component resolves them with
 * `useTranslations`, keeping all visible copy in the message catalogs.
 */
export type AuthFormState = {
  error?: string;
  fieldErrors?: {
    email?: string;
    password?: string;
  };
  success?: boolean;
};

const credentialsSchema = z.object({
  email: z.email({ error: "invalidEmail" }),
  password: z.string().min(8, { error: "passwordTooShort" }),
});

function safeRedirectPath(value: FormDataEntryValue | null): string {
  // Only allow internal, absolute paths to avoid open-redirects.
  if (typeof value === "string" && value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }
  return "/dashboard";
}

function parseCredentials(formData: FormData) {
  return credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
}

function toFieldErrors(
  error: z.ZodError<{ email: string; password: string }>,
): AuthFormState {
  const flattened = z.flattenError(error);
  return {
    fieldErrors: {
      email: flattened.fieldErrors.email?.[0],
      password: flattened.fieldErrors.password?.[0],
    },
  };
}

export async function login(
  _prevState: AuthFormState | undefined,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = parseCredentials(formData);
  if (!parsed.success) {
    return toFieldErrors(parsed.error);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: "invalidCredentials" };
  }

  redirect(safeRedirectPath(formData.get("redirectTo")));
}

export async function signup(
  _prevState: AuthFormState | undefined,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = parseCredentials(formData);
  if (!parsed.success) {
    return toFieldErrors(parsed.error);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp(parsed.data);

  if (error) {
    return { error: "generic" };
  }

  // If email confirmation is required, no session is returned yet.
  if (!data.session) {
    // TODO(signup-confirm): no session = no auth.uid() yet, so user_signed_up
    // can't be logged under insert-own RLS. Revisit if confirmation is enabled.
    return { success: true };
  }

  // Session present (confirmation disabled): auth.uid() now resolves to the new
  // user, so the insert-own RLS policy is satisfied.
  await trackEvent({ eventName: "user_signed_up", entityType: "user" });

  redirect("/dashboard");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
