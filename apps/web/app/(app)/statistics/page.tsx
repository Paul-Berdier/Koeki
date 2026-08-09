import { redirect } from "next/navigation";
import Link from "next/link";
import { EmptyState, MoneyDisplay, PageHeader, PointDisplay, SectionHeader, ZoneTitle } from "@koeki/ui";
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
    <section className="stats-hero"><div><span>Taux de recouvrement</span><strong>{rate}</strong><p>{data.previousDeltaBps === null ? "Première année suivie" : data.previousDeltaBps >= 0 ? `+${formatPercentBps(data.previousDeltaBps)} depuis l’année RP ${data.rpYear - 1}` : `−${formatPercentBps(-data.previousDeltaBps)} depuis l’année RP ${data.rpYear - 1}`} — Ryō encaissés et taxes couvertes par les dons</p></div><div className="collection-ring" role="img" aria-label={`${rate} réglés`} style={{ background: `conic-gradient(var(--gold-400) ${ringPercent}%, var(--ink-750) 0)` }}><span>{ringPercent}%</span></div><dl><div><dt>Attendu</dt><dd><MoneyDisplay amount={data.expected} /></dd></div><div><dt>Encaissé (Ryō)</dt><dd><MoneyDisplay amount={data.collected} /></dd></div><div><dt>Couvert par dons</dt><dd><MoneyDisplay amount={data.exempted} /></dd></div><div><dt>Restant</dt><dd className="negative"><MoneyDisplay amount={data.remaining} /></dd></div></dl></section>
    <ZoneTitle title="Économie du village" detail="Dettes ouvertes et discipline de la semaine" />
    <div className="dashboard-grid stats-grid">
      <section className="panel"><SectionHeader title="Dette par grade" description="Montant ouvert, toutes années RP confondues" />{data.debtByGrade.length ? <><div className="horizontal-chart" role="img" aria-label={`Dette par grade : ${data.debtByGrade.map((entry) => `${entry.grade} ${new Intl.NumberFormat("fr-FR").format(Number(entry.amount))} Ryō`).join(", ")}`}>{data.debtByGrade.map((entry) => <div key={entry.grade}><span>{entry.grade}</span><i><b style={{ width: `${Math.max(2, entry.percent)}%` }} /></i><strong><MoneyDisplay amount={entry.amount} /></strong></div>)}</div><p className="chart-summary">Le grade le plus exposé est {data.debtByGrade[0]?.grade}. Le suivi doit toutefois tenir compte de l’ancienneté et non du seul montant.</p></> : <EmptyState title="Aucune dette" description="Aucune dette ouverte : le village est à jour." />}</section>
      <section className="panel"><SectionHeader title="Semaines de taxe du cycle" description="Lignes fiscales de l’année RP en cours" />{data.weekCompliance.total > 0 ? <><div className="horizontal-chart" role="img" aria-label={`${data.weekCompliance.settled} réglées, ${data.weekCompliance.pending} en attente, ${data.weekCompliance.overdue} en retard sur ${data.weekCompliance.total}`}>
        {[{ label: "Réglées", count: data.weekCompliance.settled }, { label: "En attente", count: data.weekCompliance.pending }, { label: "En retard", count: data.weekCompliance.overdue }].map((row) => <div key={row.label}><span>{row.label}</span><i><b style={{ width: `${Math.max(2, Math.round((row.count * 100) / data.weekCompliance.total))}%` }} /></i><strong>{row.count.toLocaleString("fr-FR")}</strong></div>)}
      </div><p className="chart-summary">{formatPercentBps(data.weekCompliance.settledRateBps)} des taxes du cycle sont réglées ou couvertes par le crédit d’exonération.</p></> : <EmptyState title="Aucune ligne fiscale" description="La facturation du dimanche minuit remplira ce suivi." />}</section>
    </div>
    <ZoneTitle title="Ninjas et dons" detail="Classement du cycle et crédit d’exonération" />
    <div className="dashboard-grid stats-grid">
      <section className="panel"><SectionHeader title="Classement des ninjas" description="Points gagnés sur le cycle en cours" />{data.topNinjas.length ? <><div className="mini-list">{data.topNinjas.map((ninja, index) => <div key={ninja.code}><span>{ninja.id ? <Link className="ninja-record-link" href={`/ninjas/${ninja.id}`}><strong>#{index + 1} · {ninja.name}</strong></Link> : <strong>#{index + 1} · {ninja.name}</strong>}<small>{ninja.code}</small></span><PointDisplay points={ninja.points} /></div>)}</div><p className="chart-summary">Seules les écritures positives comptent ; les corrections n’effacent jamais l’histoire du registre.</p></> : <EmptyState title="Aucun point ce cycle" description="Les dons et paiements de la semaine alimenteront ce classement." />}</section>
      <section className="panel"><SectionHeader title="Économie des dons" description="Points distribués et crédit d’exonération" /><div style={{ padding: "16px 20px 0", textAlign: "center" }}><PointDisplay points={data.pointsDistributed} /></div><div className="mini-list">
        <div><span><strong>Crédit accordé</strong><small>Cycle en cours</small></span><strong><MoneyDisplay amount={data.exemptionFlow.granted} /></strong></div>
        <div><span><strong>Crédit consommé</strong><small>Cycle en cours</small></span><strong><MoneyDisplay amount={data.exemptionFlow.spent} /></strong></div>
        <div><span><strong>Encours total</strong><small>Toutes périodes — dette du village envers les ninjas</small></span><strong><MoneyDisplay amount={data.exemptionFlow.outstanding} /></strong></div>
      </div><p className="chart-summary">Donner des ressources crée un crédit qui couvre les taxes du dimanche : l’encours est la couverture déjà acquise par les ninjas.</p></section>
    </div>
    <ZoneTitle title="Agents et ressources" detail="Travail du service et flux du comptoir" />
    <div className="dashboard-grid stats-grid">
      <section className="panel"><SectionHeader title="Activité des agents" description="Score composite : volume et montants, jamais l’argent seul" />{data.agents.length ? <><div className="agent-scores">{data.agents.map((agent) => <article key={agent.name}><span className="agent-avatar">{agent.initials}</span><div><strong>{agent.name}</strong><small>{agent.payments} paiement{agent.payments > 1 ? "s" : ""} · {agent.donations} don{agent.donations > 1 ? "s" : ""} · {agent.buybacks} rachat{agent.buybacks > 1 ? "s" : ""} · <MoneyDisplay amount={agent.collected} compact /></small><i><b style={{ width: `${Math.max(2, agent.score)}%` }} /></i></div><em>{agent.score}</em></article>)}</div><p className="chart-summary">Le score combine volume d’opérations (60 %) et montants traités (40 %) ; aucune comparaison n’est fondée uniquement sur les encaissements.</p></> : <EmptyState title="Aucune activité" description="Les opérations enregistrées ce cycle alimenteront ces scores." />}</section>
      <section className="panel"><SectionHeader title="Ressources les plus traitées" description="Dons et rachats validés ce cycle" />{data.topResources.length ? <div className="mini-list">{data.topResources.map((resource) => <div key={`${resource.name}-${resource.typeLabel}`}><span><strong>{resource.name}</strong><small>{resource.typeLabel}</small></span><strong>{resource.quantity.toLocaleString("fr-FR")}</strong></div>)}</div> : <EmptyState title="Aucune transaction" description="Les dons et rachats validés apparaîtront ici." />}</section>
    </div>
  </div>;
}
