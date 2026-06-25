"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { submitFeedbackAction } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const TYPES = [
  "bug",
  "idea",
  "confusing",
  "trust_privacy",
  "beta_test_result",
  "other",
] as const;

export function FeedbackForm({ defaultEmail }: { defaultEmail: string }) {
  const t = useTranslations("settings.feedback");
  const [type, setType] = React.useState<(typeof TYPES)[number]>("idea");
  const [message, setMessage] = React.useState("");
  const [email, setEmail] = React.useState(defaultEmail);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await submitFeedbackAction({
        type,
        message,
        email,
        page_url: typeof window !== "undefined" ? window.location.href : "",
      });
      if (result?.error) {
        setError(result.error);
        return;
      }
      setDone(true);
      setMessage("");
    });
  };

  if (done) {
    return (
      <p
        role="status"
        className="rounded-md border border-border bg-muted p-3 text-sm"
      >
        {t("thanks")}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="feedback_type">{t("type.label")}</Label>
        <Select
          id="feedback_type"
          value={type}
          onChange={(e) => setType(e.target.value as (typeof TYPES)[number])}
        >
          {TYPES.map((ty) => (
            <option key={ty} value={ty}>
              {t(`type.${ty}`)}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="feedback_message">
          {t("message")}
          <span className="text-danger"> *</span>
        </Label>
        <Textarea
          id="feedback_message"
          rows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t("messagePlaceholder")}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="feedback_email">{t("email")}</Label>
        <Input
          id="feedback_email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {t(`errors.${error}`)}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending}>
        {isPending ? t("sending") : t("send")}
      </Button>
    </form>
  );
}
