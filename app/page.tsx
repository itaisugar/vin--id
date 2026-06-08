import { redirect } from "next/navigation";

// Entry point: send users to the dashboard. The proxy redirects
// unauthenticated visitors to /login, and the app layout re-checks auth.
export default function Home() {
  redirect("/dashboard");
}
