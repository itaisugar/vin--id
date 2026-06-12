"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { copyToClipboard } from "@/lib/clipboard";

/** Read-only share URL with a copy button. Shown once at creation. */
export function ShareUrl({ url }: { url: string }) {
  const t = useTranslations("passports.share");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [status, setStatus] = React.useState<"idle" | "copied" | "error">(
    "idle",
  );

  const copy = async () => {
    const ok = await copyToClipboard(url);
    if (ok) {
      setStatus("copied");
      setTimeout(() => setStatus("idle"), 2000);
      return;
    }
    // Copy failed — keep the URL selected so the user can copy it manually.
    inputRef.current?.focus();
    inputRef.current?.select();
    setStatus("error");
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          ref={inputRef}
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
          {status === "copied" ? t("copied") : t("copy")}
        </Button>
      </div>
      {status === "error" ? (
        <p role="alert" className="text-xs text-red-600">
          {t("copyFailed")}
        </p>
      ) : null}
    </div>
  );
}
