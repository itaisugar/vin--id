import { login } from "../actions";
import { AuthForm } from "../auth-form";

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const { redirectTo } = await searchParams;
  const target = typeof redirectTo === "string" ? redirectTo : undefined;

  return <AuthForm mode="login" action={login} redirectTo={target} />;
}
