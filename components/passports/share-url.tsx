"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Read-only share URL with a copy button. Shown once at creation. */
export function ShareUrl({ url }: { url: string }) {
  const t = useTranslations("passports");
  const [copied, setCopied] = React.useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not available — the input is selectable as a fallback.
    }
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="min-w-0 flex-1"
      />
      <Button
        type="button"
        variant="outline"
        onClick={copy}
        className="w-full sm:w-auto"
      >
        {copied ? t("share.copied") : t("share.copy")}
      </Button>
    </div>
  );
}
