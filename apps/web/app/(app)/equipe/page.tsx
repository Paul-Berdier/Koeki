import Link from "next/link";
import { ArrowRight, CircleCheck, ClipboardList } from "lucide-react";
import { MetricCard, MoneyDisplay, PageHeader, SectionHeader } from "@koeki/ui";
import { ActivityChart } from "@/components/team-charts";
import { TaskWorkload } from "@/components/task-workload";
import { TeamAgentTable } from "@/components/team-agent-table";
import { TeamPeriod } from "@/components/team-period";
import { getTeamAnalytics, resolveTeamPeriod } from "@/lib/team-analytics";
import { requirePermission } from "@/lib/session";

export default async function TeamPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requirePermission("team:read"), query = await searchParams;
  let period, periodError;
  try { period = resolveTeamPeriod({ from: query.du, to: query.au }); }
  catch { period = resolveTeamPeriod(); periodError = "Cette période est invalide. Les 30 derniers jours sont affichés ; choisissez de 1 à 366 jours."; }
  const data = await getTeamAnalytics(session, period);
  const view = query.vue === "agents" || query.vue === "attributions" ? "agents" : "synthese";
  const params = new URLSearchParams({ du: data.from, au: data.to });
  const attention = data.attention.filter((item) => item.kind !== "unassigned-dossiers");
  return <div className="page-wrap management-page">
    <PageHeader eyebrow="Espace responsable" title="Pilotage de l’équipe" description="Activité réelle du service : chaque agent peut intervenir sur tous les ninjas, sans agent référent."
      actions={<><Link href={`/equipe/taxes?${params}`} className="button button-primary">Taxes par agent</Link><Link href="/taches?nouvelle=1" className="button button-ghost"><ClipboardList size={17} aria-hidden="true" />Créer une tâche</Link></>} />
    {periodError && <p className="notice error" role="alert">{periodError}</p>}
    {query.erreur && <p className="notice error" role="alert">{query.erreur}</p>}
    {query.vue === "attributions" && <p className="notice">Le registre est partagé : aucun dossier n’est attribué à un agent. Consultez les interventions effectivement enregistrées.</p>}
    <TeamPeriod from={data.from} to={data.to} action="/equipe" view={view} />
    <nav className="view-tabs" aria-label="Vues de l’équipe"><Link href={`/equipe?${params}`} aria-current={view === "synthese" ? "page" : undefined}>Vue d’ensemble</Link><Link href={`/equipe?${params}&vue=agents`} aria-current={view === "agents" ? "page" : undefined}>Agents <span>{data.totals.agents}</span></Link><Link href={`/equipe/taxes?${params}`}>Taxes par agent</Link></nav>
    {view === "synthese" ? <>
      <section className="metric-grid" aria-label="Synthèse de l’équipe">
        <MetricCard label="Agents dans le service" value={data.totals.activeAgents} detail={`${data.totals.absentAgents} en absence déclarée · ${data.totals.agents} dans le registre`} />
        <MetricCard label="Opérations validées" value={data.totals.total} detail={`${data.totals.payments} paiements · ${data.totals.donations} dons · ${data.totals.buybacks} rachats`} />
        <Link className="metric-link" href={`/equipe/taxes?${params}`}><MetricCard label="Encaissements fiscaux" value={<MoneyDisplay amount={BigInt(data.totals.collected)} compact />} detail="Voir le détail par agent et les reçus" tone="good" /></Link>
        <MetricCard label="Tâches terminées" value={data.totals.tasksDone} detail={`${data.totals.tasksOpen} tâches actuellement ouvertes`} />
      </section>
      <div className="management-grid"><section className="panel"><SectionHeader title="Rythme de l’activité" description="Paiements, dons et rachats validés au fil des jours" /><ActivityChart days={data.daily} /></section><section className="panel attention-panel"><SectionHeader title="À traiter" description="La situation du service aujourd’hui" /><div className="attention-list">{attention.length ? attention.map((item) => <Link key={item.kind} href={item.href}><span className={`attention-count ${item.kind === "blocked" ? "danger" : ""}`}>{item.count}</span><span>{item.label}</span><ArrowRight size={16} aria-hidden="true" /></Link>) : <div className="quiet-state"><CircleCheck size={28} aria-hidden="true" /><strong>Aucune action en attente</strong><p>Aucun blocage, retard ou rapport à examiner enregistré.</p></div>}</div></section></div>
      <section className="panel"><SectionHeader title="Les agents en un regard" description="Interventions et encaissements de la période, y compris sans opération" action={<Link href={`/equipe?${params}&vue=agents`} className="text-link">Tous les agents <ArrowRight size={16} aria-hidden="true" /></Link>} /><TeamAgentTable agents={data.agents} from={data.from} to={data.to} compact /></section>
    </> : <>
      <div className="management-grid"><section className="panel"><SectionHeader title="Tâches de suivi" description="Actions ouvertes, indépendantes du libre accès aux dossiers ninjas" /><TaskWorkload rows={data.workload} /></section><section className="panel participation-overview"><SectionHeader title="Présence dans le service" description="Participation déclarée, sans mesure de connexion" /><dl><div><dt>Participation ouverte</dt><dd>{data.totals.activeAgents}</dd></div><div><dt>Absence déclarée aujourd’hui</dt><dd>{data.totals.absentAgents}</dd></div><div><dt>Accès désactivé</dt><dd>{data.totals.disabledAgents}</dd></div><div><dt>Sans opération sur la période</dt><dd>{data.totals.noActivityAgents}</dd></div></dl><p>Aucune opération enregistrée ne signifie pas une absence de travail.</p></section></div>
      <section className="panel"><SectionHeader title="Registre des agents" description="Recherchez un agent, consultez ses taxes encaissées et ouvrez sa fiche." /><TeamAgentTable agents={data.agents} from={data.from} to={data.to} /></section>
    </>}
    <details className="methodology"><summary>Comprendre les indicateurs et leur couverture</summary><div className="methodology-grid">{data.definitions.filter((definition) => definition.key !== "workload").map((definition) => <div key={definition.key}><h3>{definition.label}</h3><p>{definition.description}</p></div>)}</div><p>Les ninjas n’ont pas d’agent référent. L’auteur d’une intervention est conservé même si un autre agent intervient ensuite sur le même ninja.</p><p>{data.dataQuality.excludedPayments + data.dataQuality.excludedTransactions} opérations datées exclues · {data.dataQuality.unknownValidationDates} validations sans date connue parmi les créations de la période.</p></details>
  </div>;
}
