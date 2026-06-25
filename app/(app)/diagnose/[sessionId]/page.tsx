import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DiagnosisResultView } from "@/components/diagnosis/diagnosis-result";
import { SaveAsIssueButton } from "@/components/diagnosis/save-as-issue-button";
import {
  extractDiagnosis,
  getSessionWithMessages,
} from "@/lib/diagnosis/service";
import { getVehicleById } from "@/lib/vehicles/service";

function isMockMode(): boolean {
  return (process.env.MOCK_AI ?? "true") !== "false";
}

export default async function DiagnosisSessionPage({
  params,
}: PageProps<"/diagnose/[sessionId]">) {
  const { sessionId } = await params;
  const t = await getTranslations("diagnose");
  const tv = await getTranslations("vehicles");
  const locale = await getLocale();

  const data = await getSessionWithMessages(sessionId);
  if (!data) notFound();

  const { session, messages } = data;
  const userMessage = messages.find((m) => m.role === "user");
  const result = extractDiagnosis(messages);

  const vehicle = session.vehicle_id
    ? await getVehicleById(session.vehicle_id)
    : null;
  const vehicleTitle = vehicle
    ? [vehicle.make, vehicle.model].filter(Boolean).join(" ").trim()
    : null;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="space-y-1">
        <Link
          href="/diagnose"
          className="text-sm text-ink-2 transition-colors hover:text-ink"
        >
          <span aria-hidden className="inline-block rtl:rotate-180">←</span>{" "}
          {t("title")}
        </Link>
        <h1 className="text-2xl font-extrabold tracking-tight">
          {t("result.title")}
        </h1>
      </div>

      {/* Vehicle summary */}
      {vehicle ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-1 p-4 text-sm">
            <span className="font-semibold">
              {vehicleTitle || tv("untitled")}
            </span>
            {vehicle.year != null ? (
              <span className="num text-ink-2">{vehicle.year}</span>
            ) : null}
            {vehicle.current_mileage != null ? (
              <span className="num text-ink-2">
                {vehicle.current_mileage.toLocaleString(locale)}{" "}
                {tv(`units.${vehicle.mileage_unit}`)}
              </span>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* User symptom message */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("result.yourMessage")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm">
            {userMessage?.content ?? session.title ?? "—"}
          </p>
        </CardContent>
      </Card>

      {/* Structured diagnosis */}
      {result ? (
        <DiagnosisResultView result={result} isMock={isMockMode()} />
      ) : (
        <Card>
          <CardContent className="p-4 text-sm text-ink-2">
            {t("result.unavailable")}
          </CardContent>
        </Card>
      )}

      {/* Save as issue */}
      {result && session.vehicle_id ? (
        <div className="space-y-2">
          <SaveAsIssueButton sessionId={session.id} />
          <p className="text-xs text-ink-2">{t("saveIssue.hint")}</p>
        </div>
      ) : null}
    </div>
  );
}
