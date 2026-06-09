"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/** Triggers the browser print / Save-as-PDF dialog. Hidden in the printout. */
export function PrintButton() {
  const t = useTranslations("passports.print");
  return (
    <Button type="button" onClick={() => window.print()}>
      {t("printButton")}
    </Button>
  );
}
