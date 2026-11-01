import Link from "next/link";
import { MetricCard, PageHeader } from "@koeki/ui";
import { AgentOperationHistory } from "@/components/agent-operation-history";
import { getAgentOperationHistory } from "@/lib/agent-operation-history";

export default async function AgentOperationHistoryPage({ params, searchParams }: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { userId } = await params, query = await searchParams;
  const du = typeof query.du === "string" ? query.du : undefined;
  const au = typeof query.au === "string" ? query.au : undefined;
  const page = typeof query.page === "string" ? Number(query.page) : 1;
  let data, periodError;
  try {
    data = await getAgentOperationHistory(userId, { du, au, page });
  } catch (error) {
    // Only invalid user-entered calendar ranges fall back; auth/notFound and DB
    // errors must retain their normal handling and must never become empty data.
    if (!(error instanceof Error) || !["Date invalide", "La date de début doit précéder la date de fin"].includes(error.message)) throw error;
    periodError = "Période invalide : l’historique complet est affiché.";
    data = await getAgentOperationHistory(userId);
  }
  return <div className="page-wrap ranking-page">
    <PageHeader eyebrow="Pilotage · Journal des opérations" title={data.own ? "Mon historique" : `Historique de ${data.name}`} description={`${data.name} · Tous les paiements, dons et rachats conservés, indépendamment des publications du classement.`} />
    <div className="page-actions">
      <Link className="button button-ghost" href="/classement">← Classement hebdomadaire</Link>
      {data.manager && <Link className="button button-ghost" href={`/equipe/${data.userId}`}>Fiche de l’agent</Link>}
    </div>
    {periodError && <p className="notice notice-error" role="alert">{periodError}</p>}
    <p className="notice">Les opérations anciennes, importées ou hors période de participation restent consultables ici. Elles ne sont pas nécessairement éligibles au classement officiel. Un agent associé à une ancienne opération ne suffit pas à en établir l’auteur.</p>
    <section className="metric-grid ranking-summary" aria-label="Opérations dans la période">
      <MetricCard label="Opérations conservées" value={data.total} detail="Tous états et toutes origines" />
      <MetricCard label="Paiements fiscaux" value={data.payments} detail="Références distinctes" />
      <MetricCard label="Dons" value={data.donations} detail="Références distinctes" />
      <MetricCard label="Rachats" value={data.buybacks} detail="Références distinctes" />
    </section>
    <AgentOperationHistory history={data} preservedParams={{ ...(!periodError && du ? { du } : {}), ...(!periodError && au ? { au } : {}) }} />
  </div>;
}
