import Link from "next/link";
import { EmptyState, SectionHeader, StatusBadge } from "@koeki/ui";
import type { getAgentOperationHistory } from "@/lib/agent-operation-history";
import {
  ResourceOperationItems,
  ResourceOperationValue,
  ResourceStockEffects,
} from "@/components/resource-operation-details";
import type { ResourceDetails } from "@/lib/team-resource-journal";
import styles from "@/components/resource-journal.module.css";

const date = (value: Date | null) =>
  value?.toLocaleString("fr-FR", {
    timeZone: "Europe/Paris",
    dateStyle: "medium",
    timeStyle: "short",
  }) ?? "Inconnue";
const kinds = {
  PAYMENT: "Paiement fiscal",
  DONATION: "Don",
  BUYBACK: "Rachat",
};
const statuses: Record<string, string> = {
  VALIDATED: "Validée",
  PENDING: "En attente",
  PENDING_APPROVAL: "À approuver",
  DRAFT: "Brouillon",
  REVERSED: "Inversée",
  CANCELLED: "Annulée",
};
const origins: Record<string, string> = {
  BUSINESS: "Opération métier",
  SELF_DECLARED: "Déclaration personnelle",
  IMPORT: "Import historique",
  UNKNOWN: "Origine non établie",
};

export function AgentOperationHistory({
  history,
  basePath,
  preservedParams = {},
  resourceDetails,
  showDateFilter = true,
}: {
  history: Awaited<ReturnType<typeof getAgentOperationHistory>>;
  basePath?: string;
  resourceDetails?: ReadonlyMap<string, ResourceDetails>;
  showDateFilter?: boolean;
  preservedParams?: Record<string, string>;
}) {
  const allHistory = `/classement/agents/${encodeURIComponent(history.userId)}`;
  const base = basePath ?? allHistory;
  const { du, au } = preservedParams;
  const pageHref = (target: number) =>
    `${base}?${new URLSearchParams({ ...preservedParams, page: String(target) })}`;
  const offset = (history.page - 1) * history.pageSize;
  return (
    <section className="panel">
      <SectionHeader
        title="Journal des opérations"
        description={`${history.total} opérations conservées · Tous états et toutes origines · 25 par page, de la plus récente à la plus ancienne`}
      />
      {showDateFilter && (
        <form className="filter-bar" method="get" action={base}>
          {Object.entries(preservedParams)
            .filter(([key]) => !["du", "au", "page"].includes(key))
            .map(([key, value]) => (
              <input key={key} type="hidden" name={key} value={value} />
            ))}
          <label>
            Du
            <input name="du" type="date" defaultValue={du} />
          </label>
          <label>
            Au
            <input name="au" type="date" defaultValue={au} />
          </label>
          <button className="button button-secondary" type="submit">
            Filtrer
          </button>
          {(du || au) && (
            <Link className="button button-ghost" href={allHistory}>
              Tout l’historique
            </Link>
          )}
        </form>
      )}
      <p className="chart-summary">
        Les dates filtrent la première validation prouvée ; à défaut, la date de
        validation enregistrée, puis la date d’enregistrement. Ces dates de
        remplacement ne constituent pas une preuve pour le classement. Sans
        filtre, aucune limite d’ancienneté ne s’applique.
      </p>
      {history.rows.length ? (
        <div
          className={
            resourceDetails ? `table-scroll ${styles.scroll}` : "table-scroll"
          }
          tabIndex={0}
          role="region"
          aria-label="Opérations de cet agent"
        >
          <table
            className={resourceDetails ? styles.table : undefined}
            role="table"
          >
            <thead role="rowgroup">
              <tr role="row">
                <th scope="col">Date retenue</th>
                <th scope="col">Opération</th>
                {resourceDetails && <th scope="col">Objets et quantités</th>}
                <th scope="col" className="num">
                  Valeur ou montant
                </th>
                <th scope="col">État</th>
                <th scope="col">Classement</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {history.rows.map((row) => (
                <tr key={`${row.kind}:${row.id}`} role="row">
                  <td role="cell" data-label="Date retenue">
                    {date(row.activityAt)}
                    <small className="muted">
                      {row.provenValidation
                        ? "Première validation prouvée"
                        : row.validatedAt
                          ? "Validation enregistrée, première date non prouvée"
                          : "Enregistrement, validation inconnue"}
                    </small>
                  </td>
                  <th role="rowheader" scope="row" data-label="Opération">
                    <Link
                      href={`/classement/contributions/${row.kind}/${row.id}`}
                    >
                      {kinds[row.kind]} {row.receiptNumber}
                    </Link>
                    {resourceDetails?.get(row.id) && (
                      <small className="cell-detail">
                        {resourceDetails.get(row.id)!.ninja.firstName}{" "}
                        {resourceDetails.get(row.id)!.ninja.lastName} ·{" "}
                        {resourceDetails.get(row.id)!.ninja.code}
                      </small>
                    )}
                    <small className="muted">
                      {origins[row.operationOrigin] ?? "Origine non établie"}
                    </small>
                    <small className="muted">
                      {row.recordedById
                        ? "Auteur enregistré"
                        : "Agent associé · auteur non établi"}
                    </small>
                  </th>
                  {resourceDetails && (
                    <td role="cell" data-label="Objets et quantités">
                      {row.kind === "PAYMENT" ? (
                        <span>Paiement fiscal en Ryō</span>
                      ) : (
                        <ResourceOperationItems
                          details={resourceDetails.get(row.id)}
                        />
                      )}
                    </td>
                  )}
                  <td
                    role="cell"
                    className="num"
                    data-label="Valeur ou montant"
                  >
                    <ResourceOperationValue
                      type={row.kind}
                      amount={row.amount}
                    />
                  </td>
                  <td role="cell" data-label="État / stock">
                    <StatusBadge
                      status={
                        row.status === "VALIDATED"
                          ? "paid"
                          : row.status === "PENDING" ||
                              row.status === "PENDING_APPROVAL"
                            ? "pending"
                            : "draft"
                      }
                    >
                      {statuses[row.status] ?? row.status}
                    </StatusBadge>
                    {resourceDetails && row.kind !== "PAYMENT" && (
                      <ResourceStockEffects
                        details={resourceDetails.get(row.id)}
                      />
                    )}
                  </td>
                  <td role="cell" data-label="Classement">
                    {row.exclusion ? (
                      <span>{row.exclusion}</span>
                    ) : (
                      <span>Éligible au calcul actuel</span>
                    )}
                    {row.weekKey && (
                      <small>
                        <Link href={`/classement?semaine=${row.weekKey}`}>
                          Semaine {row.weekKey} →
                        </Link>
                      </small>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title={
            history.demo
              ? "Journal indisponible en démonstration"
              : "Aucune opération sur cette période"
          }
          description={
            du || au
              ? "Élargissez les dates ou consultez tout l’historique."
              : "Aucun paiement, don ou rachat n’est rattaché à ce compte dans les données conservées."
          }
        />
      )}
      {history.total > 0 && (
        <footer className="table-footer">
          <span>
            {offset + 1}–{offset + history.rows.length} sur {history.total}{" "}
            opérations · Page {history.page} sur {history.pageCount}
          </span>
          <nav className="page-actions" aria-label="Pagination de l’historique">
            {history.page > 1 && (
              <Link
                className="button button-ghost"
                href={pageHref(history.page - 1)}
              >
                ← Précédent
              </Link>
            )}
            {history.page < history.pageCount && (
              <Link
                className="button button-ghost"
                href={pageHref(history.page + 1)}
              >
                Suivant →
              </Link>
            )}
          </nav>
        </footer>
      )}
    </section>
  );
}
