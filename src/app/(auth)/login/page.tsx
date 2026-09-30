import { AuthCard } from "../ui";
import { LoginForm } from "./login-form";

const notices: Record<string, string> = {
  reset: "Password diperbarui. Silakan masuk kembali.",
};

const errors: Record<string, string> = {
  link: "Tautan tidak valid atau sudah kedaluwarsa.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const notice = params.reset ? notices.reset : undefined;
  const linkError = typeof params.error === "string" ? errors[params.error] : undefined;

  return (
    <AuthCard title="Masuk">
      {linkError ? (
        <p role="alert" className="mb-4 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">
          {linkError}
        </p>
      ) : null}
      <LoginForm notice={notice} />
    </AuthCard>
  );
}
