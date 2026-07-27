import { signInWithGoogle, signup } from "../actions";
import { AuthForm } from "../auth-form";

export default async function SignupPage({
  searchParams,
}: PageProps<"/signup">) {
  // Carried through so a recipient who signs up from an invitation link lands
  // back on that invitation instead of the dashboard. The auth actions run the
  // value through `safeRedirectPath`, which rejects anything that is not an
  // internal absolute path.
  const { redirectTo } = await searchParams;
  const target = typeof redirectTo === "string" ? redirectTo : undefined;

  return (
    <AuthForm
      mode="signup"
      action={signup}
      googleAction={signInWithGoogle}
      redirectTo={target}
    />
  );
}
