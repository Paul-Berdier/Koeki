import Link from "next/link";
import { getAuthErrorMessage } from "@/lib/auth-error-message";

export default async function AccessDeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const params = await searchParams;
  // Auth.js supplies one error code. Treat ambiguous/unknown input as a
  // technical error, never as evidence of a revoked account.
  const error = typeof params.error === "string"
    ? params.error
    : params.error ? "Default" : undefined;
  const message = getAuthErrorMessage(error);

  return (
    <main className="invite-page">
      <section className="auth-error-card panel" aria-labelledby="auth-error-title">
        <span className="eyebrow">Kōeki · Connexion Discord</span>
        <h1 id="auth-error-title">{message.title}</h1>
        <p>{message.description}</p>
        <p className="field-help">{message.help}</p>
        <Link className="button button-primary" href="/connexion">
          Revenir à la connexion
        </Link>
      </section>
    </main>
  );
}
