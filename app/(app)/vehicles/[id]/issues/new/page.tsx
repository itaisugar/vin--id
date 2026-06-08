import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createIssueAction } from "../actions";
import { IssueForm } from "@/components/issues/issue-form";
import { getVehicleById } from "@/lib/vehicles/service";

export default async function NewIssuePage({
  params,
}: PageProps<"/vehicles/[id]/issues/new">) {
  const { id } = await params;
  const t = await getTranslations("issues");

  const vehicle = await getVehicleById(id);
  if (!vehicle) notFound();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t("new.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("new.subtitle")}</p>
      </div>
      <IssueForm
        mode="create"
        action={createIssueAction.bind(null, id)}
        cancelHref={`/vehicles/${id}/issues`}
      />
    </div>
  );
}
