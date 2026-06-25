import { getLocale, getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LogoutButton } from "@/components/logout-button";
import { DataPrivacySection } from "@/components/settings/data-privacy";
import { FeedbackForm } from "@/components/settings/feedback-form";
import { InstallInstructions } from "@/components/pwa/install-instructions";
import { createClient } from "@/lib/supabase/server";

export default async function SettingsPage() {
  const t = await getTranslations("settings");
  const tc = await getTranslations("common");
  const locale = await getLocale();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Reuse the signup/Google metadata fields used for the dashboard greeting.
  const meta = (user?.user_metadata ?? {}) as {
    full_name?: string;
    name?: string;
    first_name?: string;
    last_name?: string;
  };
  const fullName =
    meta.full_name?.trim() ||
    meta.name?.trim() ||
    [meta.first_name, meta.last_name]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(" ") ||
    "";

  const joinedAt = user?.created_at
    ? new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(
        new Date(user.created_at),
      )
    : "";

  // Avatar initial: first letter of the name, else of the email, else "?".
  const initialSource = fullName || user?.email || "";
  const initial = initialSource.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-ink-2">{t("subtitle")}</p>
      </div>

      {/* Profile card — gradient avatar + identity (COCKPIT "More" hero) */}
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <div
            aria-hidden
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-deep text-lg font-extrabold text-on-accent glow-accent"
          >
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold">{fullName || t("account.title")}</p>
            <p className="num truncate text-sm text-ink-2">
              {user?.email ?? "—"}
            </p>
          </div>
        </div>
        {joinedAt ? (
          <p className="mt-3 border-t border-line pt-3 text-xs text-ink-2">
            {t("account.joinedAt")} · <span className="num">{joinedAt}</span>
          </p>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("language.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">{t("language.help")}</p>
          <LanguageSwitcher />
        </CardContent>
      </Card>

      <InstallInstructions />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("dataPrivacy.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataPrivacySection />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-base">{t("feedback.title")}</CardTitle>
          <p className="text-sm font-medium">{t("feedback.betaPrompt")}</p>
          <p className="text-sm text-muted-foreground">{t("feedback.help")}</p>
          <p className="text-xs text-muted-foreground">
            {t("feedback.betaGuideNote")}
          </p>
        </CardHeader>
        <CardContent>
          <FeedbackForm defaultEmail={user?.email ?? ""} />
        </CardContent>
      </Card>

      <LogoutButton />

      <p className="text-center text-xs text-muted-foreground">
        {tc("appName")} · {tc("version")}
      </p>
    </div>
  );
}
