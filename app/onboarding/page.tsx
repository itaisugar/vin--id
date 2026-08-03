import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { ONBOARDED_COOKIE } from "@/lib/onboarding";

/**
 * Onboarding entry — authenticated + cookie-gated.
 *
 * Lives OUTSIDE the (app) group on purpose: it uses the root layout (COCKPIT
 * theme, locale/dir, intl provider) but not the app chrome, so the flow is a
 * focused, distraction-free full screen. Only fresh sign-ups are routed here;
 * anyone who already finished (cookie set) is bounced to the app.
 */
export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const cookieStore = await cookies();
  if (cookieStore.get(ONBOARDED_COOKIE)?.value === "1") redirect("/dashboard");

  return <OnboardingFlow />;
}
