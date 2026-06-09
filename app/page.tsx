import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Landing } from "@/components/marketing/landing";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Vin.ID — A trusted digital history for your vehicle",
  description:
    "Track maintenance, issues, documents, and reminders, and create a shareable, tamper-evident Vehicle Passport. Beta.",
};

/**
 * Public landing page for signed-out visitors. Signed-in users keep the
 * existing app entry behavior and go straight to the dashboard.
 */
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect("/dashboard");

  // MOCK_AI defaults to on (see AGENTS.md). Only claim "mock/demo" when true.
  const mockAi = (process.env.MOCK_AI ?? "true") !== "false";

  return <Landing mockAi={mockAi} />;
}
