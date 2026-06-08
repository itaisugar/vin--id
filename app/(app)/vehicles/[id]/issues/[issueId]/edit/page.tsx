import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { updateIssueAction } from "../../actions";
import { IssueForm } from "@/components/issues/issue-form";
import { getIssue } from "@/lib/issues/service";
import { issueToFormValues } from "@/lib/issues/types";
import { getVehicleById } from "@/lib/vehicles/service";

export default async function EditIssuePage({
  params,
}: PageProps<"/vehicles/[id]/issues/[issueId]/edit">) {
  const { id, issueId } = await params;
  const t = await getTranslations("issues");

  const vehicle = await getVehicleById(id);
  if (!vehicle) notFound();

  const issue = await getIssue(id, issueId);
  if (!issue) notFound();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-bold">{t("edit.title")}</h1>
      <IssueForm
        mode="edit"
        defaultValues={issueToFormValues(issue)}
        action={updateIssueAction.bind(null, id, issueId)}
        cancelHref={`/vehicles/${id}/issues`}
      />
    </div>
  );
}
