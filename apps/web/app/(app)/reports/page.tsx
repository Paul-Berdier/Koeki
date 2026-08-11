import Link from "next/link";
import { CheckCircle2, Filter, Pencil, Undo2 } from "lucide-react";
import { EmptyState, MoneyDisplay, StatusBadge } from "@koeki/ui";
import { ModulePage } from "@/components/module-page";
import { getReports, reportStatusOptions } from "@/lib/data";
import { demoMode, hasPermission, requirePermission } from "@/lib/session";
import { reviewReport } from "./actions";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePermission("reports:read");
  const query = await searchParams;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const page = typeof query.page === "string" ? Number(query.page) || 1 : 1;
  const filters = {
    auteur: typeof query.auteur === "string" && query.auteur ? query.auteur : undefined,
    statut: typeof query.statut === "string" && query.statut ? query.statut : undefined
  };
  const canReview = !demoMode && hasPermission(session, "reports:review");
  const canWrite = !demoMode && hasPermission(session, "reports:write");
  const data = await getReports(session, page, filters);
  const pageQuery = (target: number) => `?${new URLSearchParams({ ...(filters.auteur ? { auteur: filters.auteur } : {}), ...(filters.statut ? { statut: filters.statut } : {}), page: String(target) })}`;

  return <ModulePage eyebrow="Suivi des agents" title="Rapports" description="Consultez le contenu des rapports et les chiffres d’activité calculés depuis les écritures réelles."
    actionLabel={canWrite ? "Nouveau rapport" : undefined} actionHref="/reports/new" registerDescription={`${data.total.toLocaleString("fr-FR")} rapport${data.total > 1 ? "s" : ""} dans le périmètre affiché`} metrics={[
    { label: canReview ? "À examiner" : "Soumis", value: String(data.metrics.toReview), detail: canReview ? (data.metrics.toReview ? "En attente de votre décision" : "Rien en attente") : "En attente d’examen", tone: data.metrics.toReview ? "warn" : "good" },
    { label: "Approuvés", value: String(data.metrics.approved), detail: "Validés par un responsable", tone: "good" },
    { label: "Opérations couvertes", value: String(data.metrics.covered), detail: "Paiements, dons et rachats" },
    { label: "Montant traité", value: <MoneyDisplay amount={data.metrics.processed} />, detail: `${data.metrics.corrections} correction${data.metrics.corrections > 1 ? "s" : ""}` }
  ]}>
    {error && <p className="notice error" role="alert" style={{ margin: "12px 20px 0" }}>{error}</p>}
    <form method="get" className="filter-bar report-filter-bar" aria-label="Filtrer les rapports">
      <label className="sr-only" htmlFor="report-author">Auteur</label>
      <select id="report-author" name="auteur" className="button button-ghost" defaultValue={filters.auteur ?? ""}>
        <option value="">Tous les auteurs</option>
        {data.authors.map((author) => <option key={author.id} value={author.id}>{author.name}</option>)}
      </select>
      <label className="sr-only" htmlFor="report-status">Statut</label>
      <select id="report-status" name="statut" className="button button-ghost" defaultValue={filters.statut ?? ""}>
        <option value="">Tous les statuts</option>
        {reportStatusOptions.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
      </select>
      <button className="button button-ghost" type="submit"><Filter size={17} /> Filtrer</button>
      {(filters.auteur || filters.statut) && <Link className="button button-ghost" href="/reports">Réinitialiser</Link>}
    </form>

    {data.reports.length ? <div className="report-list">{data.reports.map((report) => <article className="report-card" key={report.id}>
      <header className="report-card-header">
        <div><span>{report.period}</span><h2>{report.agent}</h2><small>Créé le {report.createdAt}</small></div>
        <StatusBadge status={report.badge}>{report.statusLabel}</StatusBadge>
      </header>
      <div className="report-activity" aria-label="Activité couverte par le rapport">
        <span><small>Paiements</small><strong>{report.payments}</strong></span>
        <span><small>Dons / rachats</small><strong>{report.donationBuybacks}</strong></span>
        <span><small>Montant traité</small><strong><MoneyDisplay amount={report.processed} /></strong></span>
      </div>
      <section className="report-preview"><h3>Résumé</h3><p>{report.summary}</p></section>
      <details className="report-details" open={data.reports.length === 1}>
        <summary>Lire le rapport complet</summary>
        <div className="report-content">
          <section className="report-summary"><h3>Résumé complet</h3><p>{report.summary}</p></section>
          <section><h3>Incidents</h3><p className={report.incidents ? undefined : "muted"}>{report.incidents ?? "Aucun incident signalé."}</p></section>
          <section><h3>Stocks</h3><p className={report.stockIssues ? undefined : "muted"}>{report.stockIssues ?? "Aucun problème de stock signalé."}</p></section>
          <section><h3>Suivi</h3><p className={report.followUps ? undefined : "muted"}>{report.followUps ?? "Aucune action de suivi demandée."}</p></section>
        </div>
      </details>
      {(report.canEdit || report.canReview) && <footer className="report-actions">
        {report.canEdit && <Link className="button button-ghost" href={`/reports/${report.id}/modifier`}><Pencil size={15} /> Modifier</Link>}
        {report.canReview && <><form action={reviewReport}><input type="hidden" name="reportId" value={report.id} /><input type="hidden" name="intent" value="approve" /><button className="button button-primary" type="submit"><CheckCircle2 size={15} /> Approuver</button></form>
        <form action={reviewReport}><input type="hidden" name="reportId" value={report.id} /><input type="hidden" name="intent" value="return" /><button className="button button-ghost" type="submit"><Undo2 size={15} /> Renvoyer</button></form></>}
      </footer>}
    </article>)}</div>
      : <EmptyState title="Aucun rapport" description={filters.auteur || filters.statut ? "Aucun rapport ne correspond à ces filtres." : "Créez un rapport de période : les totaux se rempliront automatiquement."} />}

    <footer className="table-footer"><span>Page {data.page} sur {data.pageCount}</span><div>{data.page > 1 ? <Link className="button button-ghost" href={pageQuery(data.page - 1)}>Précédent</Link> : <button className="button button-ghost" disabled>Précédent</button>}{data.page < data.pageCount ? <Link className="button button-ghost" href={pageQuery(data.page + 1)}>Suivant</Link> : <button className="button button-ghost" disabled>Suivant</button>}</div></footer>
  </ModulePage>;
}
