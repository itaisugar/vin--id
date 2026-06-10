import { getTranslations } from "next-intl/server";
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
  const ti = await getTranslations("install");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
        <CardContent className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("account.email")}
          </p>
          <p className="text-sm font-medium">{user?.email ?? "—"}</p>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{ti("settingsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <InstallInstructions />
        </CardContent>
      </Card>

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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("session.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <LogoutButton />
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        {tc("appName")} · {tc("version")}
      </p>
    </div>
  );
}
