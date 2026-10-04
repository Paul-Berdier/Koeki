import Link from "next/link";
import {
  EmptyState,
  MetricCard,
  MoneyDisplay,
  PageHeader,
  SectionHeader,
  StatusBadge,
} from "@koeki/ui";
import { getWeeklyRanking } from "@/lib/ranking-service";
import { formatReportDate } from "@/lib/report-period";
import { closeRanking } from "./actions";
import { RankingSubmitButton } from "./submit-button";

const date = (value: Date | string) =>
  new Date(value).toLocaleString("fr-FR", {
    timeZone: "Europe/Paris",
    dateStyle: "medium",
    timeStyle: "short",
  });
const day = (value: Date) =>
  value.toLocaleDateString("fr-FR", {
    timeZone: "Europe/Paris",
    day: "numeric",
    month: "long",
  });
const number = new Intl.NumberFormat("fr-FR");
const kindLabel = {
  PAYMENT: "Paiement fiscal",
  DONATION: "Don",
  BUYBACK: "Rachat",
};
const comparison = (value: number | null) =>
  value === null
    ? "Non comparable"
    : value === 0
      ? "Position stable"
      : `${value > 0 ? "+" : ""}${value} place${Math.abs(value) === 1 ? "" : "s"}`;

export default async function RankingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const data = await getWeeklyRanking(
    typeof params.semaine === "string" ? params.semaine : undefined,
    typeof params.version === "string" ? Number(params.version) : undefined,
  );
  const query =
    data.manager && typeof params.q === "string"
      ? params.q.trim().toLocaleLowerCase("fr")
      : "";
  const matchingRows = query
    ? data.rows.filter((row) =>
        row.name.toLocaleLowerCase("fr").includes(query),
      )
    : data.rows;
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(matchingRows.length / pageSize));
  const requestedPage =
    typeof params.page === "string" ? Number(params.page) : 1;
  const page = Math.min(
    pageCount,
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1,
  );
  const offset = (page - 1) * pageSize;
  const rows = matchingRows.slice(offset, offset + pageSize);
  const rankingQuery = new URLSearchParams({
    semaine: data.week.key,
    ...(data.version !== null ? { version: String(data.version) } : {}),
    ...(query ? { q: query } : {}),
  });
  const pageHref = (targetPage: number) => {
    const target = new URLSearchParams(rankingQuery);
    target.set("page", String(targetPage));
    return `/classement?${target}`;
  };
  const agentPeriod = new URLSearchParams({
    du: formatReportDate(data.week.startsAt),
    au: formatReportDate(new Date(data.week.endsAt.getTime() - 1)),
  });
  const totals = data.rows.reduce(
    (sum, row) => ({
      operations: sum.operations + row.operations,
      payments: sum.payments + row.payments,
      donations: sum.donations + row.donations,
      buybacks: sum.buybacks + row.buybacks,
    }),
    { operations: 0, payments: 0, donations: 0, buybacks: 0 },
  );

  return (
    <div className="page-wrap ranking-page">
      <PageHeader
        eyebrow="Pilotage"
        title="Classement"
        description="Les contributions validées de chaque agent, semaine après semaine. Un paiement, un don ou un rachat compte pour une opération."
      />

      <div className="period-toolbar">
        <div>
          <strong>{data.week.key}</strong>
          <p>
            Du {day(data.week.startsAt)} au{" "}
            {day(new Date(data.week.endsAt.getTime() - 1))} · heure de Paris
          </p>
        </div>
        <nav className="page-actions" aria-label="Choisir une semaine">
          <Link
            className="button button-ghost"
            href={`/classement?semaine=${data.previousKey}`}
            aria-label="Semaine précédente"
          >
            ← Précédente
          </Link>
          {data.week.key !== data.currentKey && (
            <>
              <Link className="button button-ghost" href="/classement">
                Cette semaine
              </Link>
              <Link
                className="button button-ghost"
                href={`/classement?semaine=${data.nextKey}`}
                aria-label="Semaine suivante"
              >
                Suivante →
              </Link>
            </>
          )}
        </nav>
      </div>
      {typeof params.erreur === "string" && (
        <p className="notice notice-error" role="alert">
          {params.erreur}
        </p>
      )}
      {params.succes && (
        <p className="notice" role="status">
          La semaine a été vérifiée. La version publiée figure ci-dessous.
        </p>
      )}

      <div className="ranking-context">
        <StatusBadge status={data.closed ? "paid" : "pending"}>
          {data.closed
            ? `Publié · version ${data.version}`
            : "Semaine provisoire"}
        </StatusBadge>
        {(data.correctionNeeded || !data.coverageComplete) && (
          <StatusBadge status="warning">
            {data.correctionNeeded
              ? "Correction à publier"
              : "Historique incomplet"}
          </StatusBadge>
        )}
        {!data.coverageComplete && (
          <p>
            Les preuves historiques ne couvrent pas toute la période. Ce
            résultat ne constitue pas un classement officiel complet.
          </p>
        )}
        {data.correctionNeeded && (
          <p role="status">
            Des sources ont changé depuis la clôture. La version publiée reste
            visible jusqu’à sa correction motivée.
          </p>
        )}
        {data.closed && data.version !== data.latestVersion && (
          <p>
            Vous consultez une ancienne version.{" "}
            <Link href={`/classement?semaine=${data.week.key}`}>
              Voir la dernière publication →
            </Link>
          </p>
        )}
      </div>

      <section
        className="metric-grid ranking-summary"
        aria-label="Contributions de la semaine"
      >
        <MetricCard
          label="Agents participants"
          value={number.format(data.rows.length)}
          detail="Y compris sans opération"
        />
        <MetricCard
          label="Opérations validées"
          value={number.format(totals.operations)}
          detail="Références métier distinctes"
        />
        <MetricCard
          label="Paiements fiscaux"
          value={number.format(totals.payments)}
          detail="Une contribution par paiement"
        />
        <MetricCard
          label="Dons et rachats"
          value={number.format(totals.donations + totals.buybacks)}
          detail={`${number.format(totals.donations)} don(s) · ${number.format(totals.buybacks)} rachat(s)`}
        />
      </section>

      <section className="panel">
        <SectionHeader
          title="Contributions par agent"
          description="Ordre établi par nombre d’opérations · les ex æquo partagent leur rang"
        />
        {data.own && (
          <div className="panel-body ranking-own">
            <strong>
              Ma position : {data.own.rank}
              {data.own.rank === 1 ? "er" : "e"}
            </strong>
            <span>
              {number.format(data.own.operations)} opération(s) ·{" "}
              {comparison(data.own.comparison)}
            </span>
          </div>
        )}
        {data.manager && (
          <form className="filter-bar" method="get">
            <input type="hidden" name="semaine" value={data.week.key} />
            {data.version !== null && (
              <input type="hidden" name="version" value={data.version} />
            )}
            <label>
              Rechercher un agent
              <input name="q" defaultValue={query} placeholder="Identité RP" />
            </label>
            <button className="button button-secondary" type="submit">
              Rechercher
            </button>
            {query && (
              <Link
                className="button button-ghost"
                href={`/classement?semaine=${data.week.key}${data.version !== null ? `&version=${data.version}` : ""}`}
              >
                Effacer
              </Link>
            )}
          </form>
        )}
        {rows.length ? (
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Classement des agents"
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Rang</th>
                  <th scope="col">Agent</th>
                  <th scope="col" className="num">
                    Opérations
                  </th>
                  <th scope="col" className="num">
                    Paiements
                  </th>
                  <th scope="col" className="num">
                    Dons
                  </th>
                  <th scope="col" className="num">
                    Rachats
                  </th>
                  <th scope="col">Évolution</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.userId}
                    className={
                      row.userId === data.own?.userId
                        ? "ranking-current-user"
                        : undefined
                    }
                  >
                    <td>{row.rank}</td>
                    <th scope="row">
                      {data.manager ? (
                        <Link href={`/equipe/${row.userId}?${agentPeriod}`}>
                          {row.name}
                        </Link>
                      ) : (
                        row.name
                      )}
                      {row.userId === data.own?.userId && (
                        <small className="ranking-you"> Vous</small>
                      )}
                    </th>
                    <td className="num">
                      <strong>{number.format(row.operations)}</strong>
                    </td>
                    <td className="num">{number.format(row.payments)}</td>
                    <td className="num">{number.format(row.donations)}</td>
                    <td className="num">{number.format(row.buybacks)}</td>
                    <td>{comparison(row.comparison)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={
              query
                ? "Aucun agent ne correspond"
                : data.demo
                  ? "Aucune donnée de classement en démonstration"
                  : "Aucun participant sur cette semaine"
            }
            description={
              query
                ? "Essayez une autre identité ou effacez la recherche."
                : "Les responsables renseignent les périodes de participation dans l’espace Équipe."
            }
          />
        )}
        {matchingRows.length > 0 && (
          <footer className="table-footer">
            <span>
              {number.format(offset + 1)}–{number.format(offset + rows.length)}{" "}
              sur {number.format(matchingRows.length)} agents · Page {page} sur{" "}
              {pageCount}
            </span>
            <nav className="page-actions" aria-label="Pagination du classement">
              {page > 1 && (
                <Link
                  className="button button-ghost"
                  href={pageHref(page - 1)}
                  aria-label="Page précédente du classement"
                >
                  ← Précédent
                </Link>
              )}
              {page < pageCount && (
                <Link
                  className="button button-ghost"
                  href={pageHref(page + 1)}
                  aria-label="Page suivante du classement"
                >
                  Suivant →
                </Link>
              )}
            </nav>
          </footer>
        )}
        <p className="chart-summary">
          Les montants ne pondèrent pas le rang. Zéro opération décrit
          l’activité enregistrée sur la période et ne constitue pas une
          sanction.
        </p>
      </section>

      <section
        className="panel ranking-details"
        aria-label="Sources et règles du classement"
      >
        <details>
          <summary>
            {data.manager
              ? "Vérifier les contributions de l’équipe"
              : "Vérifier mes contributions"}{" "}
            · {number.format(data.sources.length)}
          </summary>
          {data.sources.length ? (
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Contributions vérifiables"
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">Type</th>
                    <th scope="col">Référence</th>
                    <th scope="col">Première validation</th>
                    <th scope="col" className="num">
                      Montant
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.sources.map((source) => (
                    <tr key={`${source.kind}:${source.id}`}>
                      <td>{kindLabel[source.kind]}</td>
                      <td>
                        <Link
                          href={`/classement/contributions/${source.kind}/${source.id}`}
                        >
                          {source.id}
                        </Link>
                      </td>
                      <td>{date(source.validatedAt)}</td>
                      <td className="num">
                        <MoneyDisplay amount={BigInt(source.amount)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>Aucune contribution éligible sur cette période.</p>
          )}
        </details>
        <details>
          <summary>Règles de calcul et qualité des données</summary>
          <p>
            Les paiements, dons et rachats validés comptent une fois par
            référence. Un don et son entrée en stock ne font pas deux
            contributions. La contribution revient à l’auteur d’origine, jamais
            au seul approbateur.
          </p>
          <p>
            Les brouillons, attentes, imports, écritures techniques et
            opérations annulées ou inversées sont exclus. Aucun point ninja ni
            récompense n’est attribué par ce classement.
          </p>
          <p>
            L’évolution exige deux semaines clôturées et couvertes, une
            population identique et une participation complète sans absence
            déclarée. Sinon, la mention « Non comparable » remplace la
            variation.
          </p>
          <p>
            Du {date(data.week.startsAt)} inclus au {date(data.week.endsAt)}{" "}
            exclu. Calcul du {date(data.calculatedAt)} · formule V1.
          </p>
          {data.excludedUnknown > 0 && (
            <p>
              {number.format(data.excludedUnknown)} opération(s) exclue(s) faute
              de preuve historique suffisante.
            </p>
          )}
          {!data.own && (
            <p>
              Aucune participation n’est enregistrée pour votre compte sur cette
              période.
            </p>
          )}
        </details>
        {data.versions.length > 0 && (
          <details>
            <summary>
              Historique des publications · {data.versions.length}
            </summary>
            {data.versions.map((v) => (
              <p key={v.version}>
                <Link
                  href={`/classement?semaine=${data.week.key}&version=${v.version}`}
                >
                  Version {v.version}
                </Link>{" "}
                · {date(v.createdAt)}
                {"reason" in v && v.reason ? ` · ${v.reason}` : ""}
              </p>
            ))}
          </details>
        )}
      </section>

      {data.manager && data.week.endsAt <= new Date() && (
        <section className="panel">
          <SectionHeader
            title={
              data.closed
                ? "Publication et correction"
                : "Clôturer cette semaine"
            }
            description={
              data.closed
                ? "Une correction motivée crée une nouvelle version et conserve les précédentes."
                : "La clôture conserve les contributions, la population et les rangs de la semaine."
            }
          />
          <form action={closeRanking} className="panel-body">
            <input type="hidden" name="week" value={data.week.key} />
            <input
              type="hidden"
              name="version"
              value={data.latestVersion ?? ""}
            />
            {data.closed && data.correctionNeeded && (
              <label>
                Motif de correction
                <textarea
                  name="reason"
                  required
                  minLength={10}
                  maxLength={2000}
                  placeholder="Décrivez les sources corrigées et la raison de cette publication."
                />
              </label>
            )}
            {data.closed && !data.correctionNeeded ? (
              <p>La dernière publication est à jour.</p>
            ) : (
              <RankingSubmitButton
                correction={data.closed}
                disabled={data.demo}
              />
            )}
          </form>
        </section>
      )}
    </div>
  );
}
