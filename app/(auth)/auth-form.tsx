"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AuthFormState } from "./actions";

type Mode = "login" | "signup";

/** Google "G" mark, inlined so we don't pull in an icon dependency. */
function GoogleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

type AuthAction = (
  state: AuthFormState | undefined,
  formData: FormData,
) => Promise<AuthFormState>;

interface AuthFormProps {
  mode: Mode;
  action: AuthAction;
  googleAction: AuthAction;
  redirectTo?: string;
  /** Set when an OAuth callback bounced the user back with an error. */
  authError?: boolean;
}

export function AuthForm({
  mode,
  action,
  googleAction,
  redirectTo,
  authError,
}: AuthFormProps) {
  const t = useTranslations("auth");
  const [state, formAction, isPending] = useActionState(action, undefined);
  const [googleState, googleFormAction, isGooglePending] = useActionState(
    googleAction,
    undefined,
  );

  const isLogin = mode === "login";

  // A failed OAuth callback or a failed provider hand-off both surface here.
  const oauthError = authError || Boolean(googleState?.error);

  // Field/global errors come back as translation keys.
  const emailError = state?.fieldErrors?.email;
  const passwordError = state?.fieldErrors?.password;

  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-bold">
          {isLogin ? t("loginTitle") : t("signupTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isLogin ? t("loginSubtitle") : t("signupSubtitle")}
        </p>
      </div>

      {state?.success ? (
        <p
          role="status"
          className="rounded-md border border-border bg-muted p-3 text-center text-sm"
        >
          {t("checkEmail")}
        </p>
      ) : (
        <div className="space-y-4">
          <form action={googleFormAction}>
            {redirectTo ? (
              <input type="hidden" name="redirectTo" value={redirectTo} />
            ) : null}
            <Button
              type="submit"
              variant="outline"
              className="w-full"
              disabled={isGooglePending}
            >
              <GoogleIcon />
              {isGooglePending ? t("redirecting") : t("continueWithGoogle")}
            </Button>
          </form>

          {oauthError ? (
            <p role="alert" className="text-sm text-red-600">
              {t("errors.generic")}
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">
              {t("orContinueWith")}
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <form action={formAction} className="space-y-4" noValidate>
          {isLogin && redirectTo ? (
            <input type="hidden" name="redirectTo" value={redirectTo} />
          ) : null}

          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium">
              {t("email")}
            </label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder={t("emailPlaceholder")}
              aria-invalid={Boolean(emailError)}
              aria-describedby={emailError ? "email-error" : undefined}
              required
            />
            {emailError ? (
              <p id="email-error" className="text-sm text-red-600">
                {t(`errors.${emailError}`)}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              {t("password")}
            </label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={isLogin ? "current-password" : "new-password"}
              placeholder={t("passwordPlaceholder")}
              aria-invalid={Boolean(passwordError)}
              aria-describedby={passwordError ? "password-error" : undefined}
              required
            />
            {passwordError ? (
              <p id="password-error" className="text-sm text-red-600">
                {t(`errors.${passwordError}`)}
              </p>
            ) : null}
          </div>

          {state?.error ? (
            <p role="alert" className="text-sm text-red-600">
              {t(`errors.${state.error}`)}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={isPending}>
            {isLogin
              ? isPending
                ? t("signingIn")
                : t("signIn")
              : isPending
                ? t("signingUp")
                : t("signUp")}
          </Button>
          </form>
        </div>
      )}

      <p className="text-center text-sm text-muted-foreground">
        {isLogin ? t("noAccount") : t("haveAccount")}{" "}
        <Link
          href={isLogin ? "/signup" : "/login"}
          className="font-medium text-primary hover:underline"
        >
          {isLogin ? t("createOne") : t("signInInstead")}
        </Link>
      </p>
    </div>
  );
}
