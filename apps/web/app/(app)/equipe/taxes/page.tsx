import Link from "next/link";
import { EmptyState, MetricCard, MoneyDisplay, PageHeader, SectionHeader } from "@koeki/ui";
import { requirePermission } from "@/lib/session";
import { getAgentTaxLedger } from "@/lib/agent-tax-ledger";
import { resolveTeamPeriod } from "@/lib/team-analytics";
import { shiftReportDate } from "@/lib/report-period";

export default async function AgentTaxesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePermission("team:read");
  const query = await searchParams;
  const text = (key: string) => typeof query[key] === "string" ? query[key] as string : undefined;
  let period, periodError = false;
  try { period = resolveTeamPeriod({ from: text("du"), to: text("au") }); }
  catch { period = resolveTeamPeriod(); periodError = true; }
  const data = await getAgentTaxLedger(session, { from: period.from, to: period.to, agentId: text("agent"), q: text("q"), page: text("page") });
  const params = new URLSearchParams({ du: data.from, au: data.to });
  const href = (agent: string, page = 1) => `/equipe/taxes?${new URLSearchParams({ du: data.from, au: data.to, agent, page: String(page), q: data.q })}#recus`;
  const date = (value: Date) => value.toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" });
  const states: Record<string, string> = { VALIDATED: "Validé", PENDING: "En attente", CANCELLED: "Annulé", REVERSED: "Inversé" };
  return <div className="page-wrap">
    <PageHeader eyebrow="Pilotage du service" title="Taxes par agent" description="Chaque agent intervient librement sur tous les ninjas. Les paiements sont attribués à leur auteur d’origine, jamais à un référent ni à un approbateur."
      actions={<Link href="/equipe" className="button button-ghost">Retour à l’équipe</Link>} />
    {periodError && <p className="notice error" role="alert">Période invalide : les 30 derniers jours sont affichés.</p>}
    <section className="panel stack-panel">
      <SectionHeader title="Période et agent" description="Dates inclusives, heure de Paris. Les totaux ne dépendent pas de la pagination des reçus." />
      <form className="filter-bar" action="/equipe/taxes">
        <label>Du<input type="date" name="du" required defaultValue={data.from} /></label>
        <label>Au<input type="date" name="au" required defaultValue={data.to} /></label>
        <label>Agent<select name="agent" defaultValue={data.selected?.id ?? ""}><option value="">Tous les agents</option>{data.choices.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
        <button className="button button-primary" type="submit">Afficher les taxes</button>
      </form>
      <div className="panel-body"><Link className="text-link" href={`/equipe/taxes?du=${shiftReportDate(data.to, -6)}&au=${data.to}`}>7 jours</Link>{" · "}<Link className="text-link" href={`/equipe/taxes?du=${shiftReportDate(data.to, -29)}&au=${data.to}`}>30 jours</Link></div>
    </section>
    <section className="metric-grid" aria-label="Encaissements fiscaux">
      <MetricCard label={data.selected ? "Taxes encaissées par cet agent" : "Taxes encaissées par le service"} value={<MoneyDisplay amount={data.selected?.collected ?? data.totalCollected} />} detail="Paiements métier validés en Ryō, hors exonérations" tone="good" />
      <MetricCard label="Paiements comptabilisés" value={data.selected?.payments ?? data.totalPayments} detail="Un reçu compte une fois, même s’il couvre plusieurs années RP" />
      <MetricCard label="Historique attribué à vérifier" value={<MoneyDisplay amount={data.selected?.historical ?? data.totalHistorical} />} detail="Origine ancienne, inconnue ou importée ; non ajoutée au total métier" />
    </section>
    {data.selectedMissing && <p className="notice error" role="alert">Cet agent n’existe pas dans le relevé. Choisissez un membre de la liste.</p>}
    {data.unattributed !== 0n && <p className="notice">Reçus rattachés à un compte technique ou introuvable : <MoneyDisplay amount={data.unattributed} />. Non attribués à un agent.</p>}
    {data.unknownDates > 0 && <p className="notice">{data.unknownDates} paiement(s) créé(s) dans la période sans date de validation : hors totaux datés.</p>}
    <section className="panel stack-panel">
      <SectionHeader title="Recouvrement par agent" description="Agents sans encaissement inclus ; les montants historiques restent associés à leur auteur même si son accès est désactivé." />
      <form action="/equipe/taxes" className="filter-bar"><input type="hidden" name="du" value={data.from} /><input type="hidden" name="au" value={data.to} /><label>Rechercher un agent<input type="search" name="q" defaultValue={data.q} maxLength={120} /></label><button className="button button-ghost" type="submit">Rechercher</button></form>
      {data.agents.length ? <div className="table-scroll" role="region" tabIndex={0} aria-label="Taxes recouvrées par agent"><table><thead><tr><th>Agent</th><th className="num">Taxes encaissées</th><th className="num">Paiements</th><th className="num">Historique à vérifier</th><th>Reçus</th></tr></thead><tbody>{data.agents.map((agent) => <tr key={agent.id}><th scope="row">{agent.name}{agent.disabled && <small className="cell-detail">Accès désactivé · historique conservé</small>}</th><td className="num"><MoneyDisplay amount={agent.collected} /></td><td className="num">{agent.payments}</td><td className="num"><MoneyDisplay amount={agent.historical} /></td><td><Link className="text-link" href={href(agent.id)} aria-label={`Voir les taxes de ${agent.name}`}>Voir les reçus</Link></td></tr>)}</tbody></table></div> : <EmptyState title="Aucun agent dans cette sélection" description="Modifiez la recherche ou la période." />}
    </section>
    {data.selected && <section className="panel" id="recus">
      <SectionHeader title={`Reçus de ${data.selected.name}`} description={`${data.receiptCount} reçu(s) · ${data.from} au ${data.to}`} />
      {data.receipts.length ? <div className="table-scroll" role="region" tabIndex={0} aria-label="Reçus fiscaux de l’agent"><table><thead><tr><th>Date</th><th>Reçu / ninja</th><th className="num">Montant</th><th>État / origine</th><th>Comptabilisation</th></tr></thead><tbody>{data.receipts.map((receipt) => <tr key={receipt.id}><td>{receipt.at ? date(receipt.at) : <>{date(receipt.createdAt)}<small className="cell-detail">Création · validation inconnue</small></>}</td><th scope="row"><Link className="text-link" href={`/ninjas/${receipt.ninjaId}`}>{receipt.receipt}</Link><small className="cell-detail">{receipt.ninja}</small></th><td className="num"><MoneyDisplay amount={receipt.amount} /></td><td>{states[receipt.status] ?? receipt.status}<small className="cell-detail">{receipt.origin} · {receipt.method}</small></td><td>{receipt.bucket === "collected" ? "Inclus dans les taxes encaissées" : receipt.bucket === "history" ? "Historique séparé, à vérifier" : "Hors total des encaissements"}</td></tr>)}</tbody></table></div> : <EmptyState title="Aucun reçu pour cet agent sur la période" description="Élargissez la période pour consulter son historique." />}
      <footer className="table-footer"><span>Page {data.page} sur {data.pageCount}</span><div className="pagination-controls">{data.page > 1 && <Link href={href(data.selected.id, data.page - 1)}>Précédent</Link>}{data.page < data.pageCount && <Link href={href(data.selected.id, data.page + 1)}>Suivant</Link>}</div></footer>
    </section>}
    <p className="methodology">Les dons, achats, crédits d’exonération et opérations annulées ne sont pas des taxes encaissées. Les anciens paiements avec un auteur connu restent consultables, sans fabriquer de date ni de nouvelle attribution. <Link className="text-link" href={`/equipe?${params}`}>Voir l’activité globale</Link></p>
  </div>;
}
