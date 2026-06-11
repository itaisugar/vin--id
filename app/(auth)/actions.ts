"use server";

import { headers } from "next/headers";
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
    firstName?: string;
    lastName?: string;
  };
  success?: boolean;
};

const credentialsSchema = z.object({
  email: z.email({ error: "invalidEmail" }),
  password: z.string().min(8, { error: "passwordTooShort" }),
});

const signupSchema = credentialsSchema.extend({
  firstName: z
    .string({ error: "firstNameRequired" })
    .trim()
    .min(1, { error: "firstNameRequired" })
    .max(60, { error: "nameTooLong" }),
  lastName: z
    .string({ error: "lastNameRequired" })
    .trim()
    .min(1, { error: "lastNameRequired" })
    .max(60, { error: "nameTooLong" }),
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

function toFieldErrors(error: z.ZodError): AuthFormState {
  const fieldErrors = z.flattenError(error).fieldErrors as Record<
    string,
    string[] | undefined
  >;
  return {
    fieldErrors: {
      email: fieldErrors.email?.[0],
      password: fieldErrors.password?.[0],
      firstName: fieldErrors.firstName?.[0],
      lastName: fieldErrors.lastName?.[0],
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
  const parsed = signupSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
  });
  if (!parsed.success) {
    return toFieldErrors(parsed.error);
  }

  const { email, password, firstName, lastName } = parsed.data;
  const fullName = `${firstName} ${lastName}`.trim();

  const supabase = await createClient();
  // Store the name on the auth user (user_metadata) so it's available for the
  // greeting regardless of email-confirmation state and for Google parity.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { first_name: firstName, last_name: lastName, full_name: fullName },
    },
  });

  if (error) {
    return { error: "generic" };
  }

  // If email confirmation is required, no session is returned yet.
  if (!data.session) {
    // TODO(signup-confirm): no session = no auth.uid() yet, so user_signed_up
    // can't be logged and the profile can't be updated under own-row RLS.
    // Revisit if confirmation is enabled (the name still lives in user_metadata).
    return { success: true };
  }

  // Session present (confirmation disabled): auth.uid() now resolves to the new
  // user, so the own-row RLS policies are satisfied. Mirror the name onto the
  // profile (best-effort — the greeting reads user_metadata either way).
  if (data.user) {
    await supabase
      .from("profiles")
      .update({ full_name: fullName })
      .eq("id", data.user.id);
  }

  await trackEvent({ eventName: "user_signed_up", entityType: "user" });

  redirect("/dashboard");
}

/**
 * Begin the Google OAuth (PKCE) flow. Supabase returns a provider URL we
 * redirect the browser to; Google then sends the user back to
 * `/auth/callback`, which exchanges the code for a session.
 *
 * The callback origin is derived from the request `origin` header so the user
 * is returned to the exact host they started on (localhost, preview, prod).
 */
export async function signInWithGoogle(
  _prevState: AuthFormState | undefined,
  formData: FormData,
): Promise<AuthFormState> {
  const supabase = await createClient();
  const headerStore = await headers();
  const origin = headerStore.get("origin");
  if (!origin) {
    return { error: "generic" };
  }

  const next = safeRedirectPath(formData.get("redirectTo"));
  const callbackUrl = new URL("/auth/callback", origin);
  callbackUrl.searchParams.set("next", next);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callbackUrl.toString() },
  });

  if (error || !data.url) {
    return { error: "generic" };
  }

  redirect(data.url);
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
