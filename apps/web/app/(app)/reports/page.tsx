import Link from "next/link";
import { Filter, Pencil, Plus } from "lucide-react";
import {
  EmptyState,
  MoneyDisplay,
  PageHeader,
  SectionHeader,
  StatusBadge,
} from "@koeki/ui";
import { ActionForm } from "@/components/action-form";
import { getReports, reportStatusOptions } from "@/lib/data";
import { demoMode, hasPermission, requirePermission } from "@/lib/session";
import { getReportExpectations } from "@/lib/report-service";
import { configureReportExpectation } from "./actions";

type ReportFilters = {
  auteur?: string | undefined;
  statut?: string | undefined;
  du?: string | undefined;
  au?: string | undefined;
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requirePermission("reports:read");
  const query = await searchParams;
  let error = typeof query.erreur === "string" ? query.erreur : null;
  const page = typeof query.page === "string" ? Number(query.page) || 1 : 1;
  let filters: ReportFilters = {
    auteur:
      typeof query.auteur === "string" && query.auteur
        ? query.auteur
        : undefined,
    statut:
      typeof query.statut === "string" && query.statut
        ? query.statut
        : undefined,
    du: typeof query.du === "string" && query.du ? query.du : undefined,
    au: typeof query.au === "string" && query.au ? query.au : undefined,
  };
  const canReview = !demoMode && hasPermission(session, "reports:review");
  const canWrite = !demoMode && hasPermission(session, "reports:write");
  const canReadAll = hasPermission(session, "reports:read-all");
  const expectations = await getReportExpectations(session);
  let data;
  try {
    data = await getReports(session, page, filters);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Filtres invalides";
    filters = { ...filters, du: undefined, au: undefined };
    data = await getReports(session, 1, filters);
  }
  const activeFilters = Boolean(
    filters.auteur || filters.statut || filters.du || filters.au,
  );
  const pageQuery = (target: number) =>
    `?${new URLSearchParams({ ...(filters.auteur ? { auteur: filters.auteur } : {}), ...(filters.statut ? { statut: filters.statut } : {}), ...(filters.du ? { du: filters.du } : {}), ...(filters.au ? { au: filters.au } : {}), page: String(target) })}`;
  const pendingPeriods = expectations.periods.filter(
    (period) => period.state !== "Reçu",
  );

  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="Suivi"
        title={canReadAll ? "Historique des rapports" : "Mes rapports"}
        description={
          canReview
            ? "Examinez les périodes soumises et retrouvez les décisions précédentes."
            : "Vos périodes d’activité et leur état de validation."
        }
        actions={
          canWrite ? (
            <Link className="button button-primary" href="/reports/new">
              <Plus size={17} aria-hidden="true" /> Nouveau rapport
            </Link>
          ) : undefined
        }
        metrics={[
          { label: "Rapports affichables", value: data.total },
          {
            label: canReview ? "À examiner" : "Soumis",
            value: data.metrics.toReview,
          },
          { label: "Approuvés", value: data.metrics.approved },
        ]}
      />
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="workspace-split">
        <div>
          <section className="panel">
            <form
              method="get"
              className="filter-bar report-filter-bar"
              aria-label="Filtrer les rapports"
            >
              {canReadAll && (
                <label>
                  Auteur
                  <select name="auteur" defaultValue={filters.auteur ?? ""}>
                    <option value="">Tous les auteurs</option>
                    {data.authors.map((author) => (
                      <option key={author.id} value={author.id}>
                        {author.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Statut
                <select name="statut" defaultValue={filters.statut ?? ""}>
                  <option value="">Tous les statuts</option>
                  {reportStatusOptions.map((status) => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Du
                <input type="date" name="du" defaultValue={filters.du ?? ""} />
              </label>
              <label>
                Au
                <input type="date" name="au" defaultValue={filters.au ?? ""} />
              </label>
              <button className="button button-ghost" type="submit">
                <Filter size={16} aria-hidden="true" /> Filtrer
              </button>
              {activeFilters && (
                <Link className="button button-ghost" href="/reports">
                  Tout effacer
                </Link>
              )}
            </form>
          </section>
          {data.reports.length ? (
            <div className="report-list">
              {data.reports.map((report) => (
                <article className="report-card report-row" key={report.id}>
                  <header className="report-card-header">
                    <div>
                      <span>{report.period}</span>
                      <h2>
                        <Link href={`/reports/${report.id}`}>
                          {report.agent}
                        </Link>
                      </h2>
                    </div>
                    <StatusBadge status={report.badge}>
                      {report.statusLabel}
                    </StatusBadge>
                  </header>
                  <div className="report-preview">
                    <p>{report.summary}</p>
                  </div>
                  <div className="report-row-meta">
                    <span>
                      {report.payments} paiements · {report.donationBuybacks}{" "}
                      dons / rachats
                    </span>
                    <MoneyDisplay amount={report.processed} />
                    <small>Créé le {report.createdAt}</small>
                  </div>
                  <details className="report-details">
                    <summary>Incidents, stocks et suivi</summary>
                    <div className="report-content">
                      <section>
                        <h3>Incidents</h3>
                        <p>{report.incidents ?? "Aucun incident signalé."}</p>
                      </section>
                      <section>
                        <h3>Stocks</h3>
                        <p>
                          {report.stockIssues ??
                            "Aucun problème de stock signalé."}
                        </p>
                      </section>
                      <section>
                        <h3>Suivi</h3>
                        <p>
                          {report.followUps ??
                            "Aucune action de suivi demandée."}
                        </p>
                      </section>
                    </div>
                  </details>
                  <footer className="report-actions">
                    <Link
                      className={`button ${report.canReview ? "button-primary" : "button-ghost"}`}
                      href={`/reports/${report.id}`}
                    >
                      {report.canReview
                        ? "Examiner"
                        : "Ouvrir le rapport et ses avis"}
                    </Link>
                    {report.canEdit && (
                      <Link
                        className="button button-ghost"
                        href={`/reports/${report.id}/modifier`}
                      >
                        <Pencil size={15} aria-hidden="true" /> Modifier
                      </Link>
                    )}
                  </footer>
                </article>
              ))}
            </div>
          ) : (
            <section className="panel">
              <EmptyState
                title="Aucun rapport"
                description={
                  activeFilters
                    ? "Aucun rapport ne correspond à ces filtres."
                    : canWrite
                      ? "Créez votre premier rapport de période."
                      : "Aucun rapport disponible pour le moment."
                }
              />
            </section>
          )}
          <footer className="table-footer">
            <span>
              {data.total} rapport(s) · page {data.page} sur {data.pageCount}
            </span>
            <div className="form-actions">
              {data.page > 1 && (
                <Link
                  className="button button-ghost"
                  href={pageQuery(data.page - 1)}
                >
                  Précédent
                </Link>
              )}
              {data.page < data.pageCount && (
                <Link
                  className="button button-ghost"
                  href={pageQuery(data.page + 1)}
                >
                  Suivant
                </Link>
              )}
            </div>
          </footer>
        </div>
        <aside className="workspace-aside">
          <section className="panel">
            <SectionHeader
              title="Mes échéances"
              description={
                expectations.configured
                  ? "Rapports attendus sur vos périodes de participation."
                  : "Attente non configurée"
              }
            />
            {pendingPeriods.length ? (
              <div className="work-list">
                {pendingPeriods.map((period) => (
                  <div className="work-row" key={period.start}>
                    <div className="work-row-main">
                      <strong>{period.state}</strong>
                      <span>
                        {period.start} au {period.end}
                      </span>
                      <small>
                        Échéance{" "}
                        {period.dueAt.toLocaleDateString("fr-FR", {
                          timeZone: "Europe/Paris",
                        })}
                      </small>
                      {period.reportId ? (
                        <Link
                          className="text-link"
                          href={`/reports/${period.reportId}`}
                        >
                          Ouvrir le rapport
                        </Link>
                      ) : (
                        canWrite && (
                          <Link className="text-link" href="/reports/new">
                            Rédiger le rapport
                          </Link>
                        )
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              expectations.configured && (
                <p className="empty-inline">Aucune période en attente.</p>
              )
            )}
          </section>
          {canReview && (
            <details className="panel settings-disclosure">
              <summary>Cadence des rapports</summary>
              <ActionForm
                action={configureReportExpectation}
                className="form-grid"
              >
                <p>La nouvelle règle s’applique aux semaines à venir.</p>
                <label>
                  Date d’effet future
                  <input type="date" name="effectiveFrom" required />
                </label>
                <label>
                  Population
                  <select name="population">
                    <option value="ECONOMIC_AGENT">
                      Agents économiques participants
                    </option>
                    <option value="PARTICIPANTS">
                      Tous les participants déclarés
                    </option>
                  </select>
                </label>
                <label>
                  Délai après la fin de semaine (jours)
                  <input
                    name="dueAfterDays"
                    type="number"
                    min={0}
                    max={30}
                    defaultValue={2}
                    required
                  />
                </label>
                <label className="checkbox-label">
                  <input type="checkbox" name="reminders" defaultChecked />{" "}
                  Rappels internes
                </label>
                <button className="button button-primary">
                  Configurer la cadence hebdomadaire
                </button>
              </ActionForm>
            </details>
          )}
        </aside>
      </div>
    </div>
  );
}
