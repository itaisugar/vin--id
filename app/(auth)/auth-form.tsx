"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AuthFormState } from "./actions";

type Mode = "login" | "signup";

interface AuthFormProps {
  mode: Mode;
  action: (
    state: AuthFormState | undefined,
    formData: FormData,
  ) => Promise<AuthFormState>;
  redirectTo?: string;
}

export function AuthForm({ mode, action, redirectTo }: AuthFormProps) {
  const t = useTranslations("auth");
  const [state, formAction, isPending] = useActionState(action, undefined);

  const isLogin = mode === "login";

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
