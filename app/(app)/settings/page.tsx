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

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("account.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("account.fullName")}
            </p>
            <p className="text-sm font-medium">{fullName || "—"}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("account.email")}
            </p>
            <p className="text-sm font-medium">{user?.email ?? "—"}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("account.joinedAt")}
            </p>
            <p className="text-sm font-medium">{joinedAt || "—"}</p>
          </div>
        </CardContent>
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
