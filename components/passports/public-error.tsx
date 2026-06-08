import { getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { PublicPassportState } from "@/lib/passports/public";

const MESSAGE_KEY: Record<Exclude<PublicPassportState, "ok">, string> = {
  not_found: "notFound",
  expired: "expired",
  token_revoked: "revoked",
  passport_revoked: "revoked",
  accepted: "accepted",
  invalid: "generic",
};

/** Friendly, safe message for any non-viewable token/passport state. */
export async function PublicError({
  state,
}: {
  state: Exclude<PublicPassportState, "ok">;
}) {
  const t = await getTranslations("passports.public");
  const key = MESSAGE_KEY[state] ?? "generic";

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm">{t(`errors.${key}`)}</p>
        <p className="text-xs text-muted-foreground">{t("errors.hint")}</p>
      </CardContent>
    </Card>
  );
}
