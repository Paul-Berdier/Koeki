import { redirect } from "next/navigation";
import { EmptyState, MoneyDisplay, PageHeader, PointDisplay, SectionHeader } from "@koeki/ui";
import { getStatistics } from "@/lib/data";
import { formatPercentBps } from "@/lib/format";
import { hasPermission, requireSession } from "@/lib/session";

export default async function StatisticsPage() {
  const session = await requireSession();
  if (!hasPermission(session, "payments:write") && !hasPermission(session, "audit:read")) redirect("/access-denied");
  const data = await getStatistics();
  const rate = formatPercentBps(data.rateBps);
  const ringPercent = Math.round(data.rateBps / 100);
  return <div className="page-wrap">
    <PageHeader eyebrow="Analyse multi-dimensionnelle" title="Statistiques" description="Finances, stocks et activité des agents — chaque graphique possède une synthèse textuelle." actions={<span className="button button-ghost" aria-label={`Période : année RP ${data.rpYear}`}>Année RP {data.rpYear}</span>} />
    <section className="stats-hero"><div><span>Taux de recouvrement</span><strong>{rate}</strong><p>{data.previousDeltaBps === null ? "Première année suivie" : data.previousDeltaBps >= 0 ? `+${formatPercentBps(data.previousDeltaBps)} depuis l’année RP ${data.rpYear - 1}` : `−${formatPercentBps(-data.previousDeltaBps)} depuis l’année RP ${data.rpYear - 1}`}</p></div><div className="collection-ring" role="img" aria-label={`${rate} recouvrés`} style={{ background: `conic-gradient(var(--gold-400) ${ringPercent}%, var(--ink-750) 0)` }}><span>{ringPercent}%</span></div><dl><div><dt>Attendu</dt><dd><MoneyDisplay amount={data.expected} /></dd></div><div><dt>Encaissé</dt><dd><MoneyDisplay amount={data.collected} /></dd></div><div><dt>Restant</dt><dd className="negative"><MoneyDisplay amount={data.remaining} /></dd></div></dl></section>
    <div className="dashboard-grid stats-grid">
      <section className="panel"><SectionHeader title="Dette par grade" description="Montant ouvert, toutes années RP confondues" />{data.debtByGrade.length ? <><div className="horizontal-chart" role="img" aria-label={`Dette par grade : ${data.debtByGrade.map((entry) => `${entry.grade} ${new Intl.NumberFormat("fr-FR").format(Number(entry.amount))} Ryō`).join(", ")}`}>{data.debtByGrade.map((entry) => <div key={entry.grade}><span>{entry.grade}</span><i><b style={{ width: `${Math.max(2, entry.percent)}%` }} /></i><strong><MoneyDisplay amount={entry.amount} /></strong></div>)}</div><p className="chart-summary">Le grade le plus exposé est {data.debtByGrade[0]?.grade}. Le suivi doit toutefois tenir compte de l’ancienneté et non du seul montant.</p></> : <EmptyState title="Aucune dette" description="Aucune dette ouverte : le village est à jour." />}</section>
      <section className="panel"><SectionHeader title="Activité des agents" description="Score composite : volume et montants, jamais l’argent seul" />{data.agents.length ? <><div className="agent-scores">{data.agents.map((agent) => <article key={agent.name}><span className="agent-avatar">{agent.initials}</span><div><strong>{agent.name}</strong><small>{agent.payments} paiement{agent.payments > 1 ? "s" : ""} · {agent.transactions} don{agent.transactions > 1 ? "s" : ""}/rachats · <MoneyDisplay amount={agent.collected} compact /></small><i><b style={{ width: `${Math.max(2, agent.score)}%` }} /></i></div><em>{agent.score}</em></article>)}</div><p className="chart-summary">Le score combine volume d’opérations (60 %) et montants traités (40 %) ; aucune comparaison n’est fondée uniquement sur les encaissements.</p></> : <EmptyState title="Aucune activité" description="Les opérations enregistrées ce cycle alimenteront ces scores." />}</section>
    </div>
    <div className="dashboard-grid stats-grid">
      <section className="panel"><SectionHeader title="Ressources les plus traitées" description="Dons et rachats validés ce cycle" />{data.topResources.length ? <div className="mini-list">{data.topResources.map((resource) => <div key={`${resource.name}-${resource.typeLabel}`}><span><strong>{resource.name}</strong><small>{resource.typeLabel}</small></span><strong>{resource.quantity.toLocaleString("fr-FR")} {resource.unit}</strong></div>)}</div> : <EmptyState title="Aucune transaction" description="Les dons et rachats validés apparaîtront ici." />}</section>
      <section className="panel"><SectionHeader title="Points distribués" description="Cycle en cours, écritures positives" /><div style={{ padding: "24px 20px", textAlign: "center" }}><PointDisplay points={data.pointsDistributed} /><p className="chart-summary" style={{ padding: "12px 0 0" }}>Chaque solde reste explicable ligne à ligne depuis le registre des points.</p></div></section>
    </div>
  </div>;
}
