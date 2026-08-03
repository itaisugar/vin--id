"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { createOrganizationAction } from "@/app/(app)/organization/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Create a separate Business organization from a Personal workspace.
 *
 * A focused, single-field form: the only thing the UI owns is the name — the
 * owner, the membership and the active-workspace switch are all derived and
 * performed server-side by `create_business_organization()`. On success the
 * server action redirects to the Business Team & Access screen, so this
 * component never has to render a "created" state.
 *
 * The form is revealed by the primary button rather than shown inline, so the
 * Personal Team & Access screen stays a calm activation prompt until the user
 * actually chooses to create an organization.
 */
export function CreateOrganizationForm() {
  const t = useTranslations("organization.activation");
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      // A successful create redirects inside the action, so control only returns
      // here on failure.
      const state = await createOrganizationAction({ name });
      if (state?.error) setError(t(`errors.${state.error}`));
    });
  }

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        {t("createCta")}
      </Button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="org-name">{t("form.nameLabel")}</Label>
        <Input
          id="org-name"
          type="text"
          required
          autoFocus
          maxLength={120}
          autoComplete="organization"
          placeholder={t("form.namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isPending}
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isPending || name.trim() === ""}>
          {isPending ? t("form.creating") : t("form.submit")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          {t("form.cancel")}
        </Button>
      </div>
    </form>
  );
}
