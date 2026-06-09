import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Privacy — Vin.ID",
};

// TODO(legal): beta-stage privacy summary — review before public launch.
export default function PrivacyPage() {
  return <LegalPage ns="privacy" />;
}
