import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Terms — Vin.ID",
};

// TODO(legal): beta-stage terms summary — review before public launch.
export default function TermsPage() {
  return <LegalPage ns="terms" />;
}
