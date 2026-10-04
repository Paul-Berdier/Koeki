import { redirect } from "next/navigation";
import Link from "next/link";
import {
  EmptyState,
  MetricCard,
  MoneyDisplay,
  PageHeader,
  PointDisplay,
  SectionHeader,
} from "@koeki/ui";
import { getStatistics } from "@/lib/data";
import { formatPercentBps } from "@/lib/format";
import { hasPermission, requireSession } from "@/lib/session";

const number = new Intl.NumberFormat("fr-FR");

export default async function StatisticsPage() {
  const session = await requireSession();
  if (!hasPermission(session, "statistics:read")) redirect("/access-denied");
  const data = await getStatistics();
  const compliance = [
    { label: "Réglées", count: data.weekCompliance.settled },
    { label: "En attente", count: data.weekCompliance.pending },
    { label: "En retard", count: data.weekCompliance.overdue },
  ];
  const delta = data.previousDeltaBps;
  const rateDetail =
    delta === null
      ? "Aucune année précédente comparable"
      : `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${number.format(Math.abs(delta) / 100)} point${Math.abs(delta) === 100 ? "" : "s"} de pourcentage par rapport à l’année RP ${data.rpYear - 1}`;

  return (
    <div className="page-wrap economy-page">
      <PageHeader
        eyebrow="Pilotage"
        title="Économie"
        description="Recouvrement, crédits et ressources du village. Les montants restent distincts de l’activité des agents."
        actions={<span className="period-label">Année RP {data.rpYear}</span>}
      />

      <section
        className="metric-grid economy-summary"
        aria-label={`Situation fiscale de l’année RP ${data.rpYear}`}
      >
        <MetricCard
          label="À recouvrer sur le cycle"
          value={<MoneyDisplay amount={data.expected} />}
          detail="Montant fiscal attendu"
        />
        <MetricCard
          label="Encaissé"
          value={<MoneyDisplay amount={data.collected} />}
          detail="Ryō affectés aux taxes du cycle"
          tone="good"
        />
        <MetricCard
          label="Exonérations appliquées"
          value={<MoneyDisplay amount={data.exempted} />}
          detail="Crédit déjà utilisé sur ces taxes"
        />
        <MetricCard
          label="Reste à recouvrer"
          value={<MoneyDisplay amount={data.remaining} />}
          detail="Solde fiscal du cycle"
          tone={data.remaining > 0n ? "warn" : "good"}
        />
      </section>

      <section className="panel economy-recovery">
        <SectionHeader
          title="Avancement du recouvrement"
          description={`Année RP ${data.rpYear} · Ryō encaissés et exonérations appliquées`}
        />
        <div className="panel-body">
          <div className="economy-rate">
            <strong>
              {data.expected > 0n ? formatPercentBps(data.rateBps) : "—"}
            </strong>
            <span>
              {data.expected > 0n
                ? rateDetail
                : "Aucun montant fiscal attendu sur ce cycle"}
            </span>
          </div>
          {data.expected > 0n && (
            <progress
              className="economy-progress"
              value={Math.max(0, Math.min(10000, data.rateBps))}
              max={10000}
              aria-label="Part des taxes du cycle réglée par Ryō ou exonération"
            />
          )}
          <p className="muted">
            Le taux porte sur les taxes du cycle. Une exonération appliquée
            règle une taxe sans constituer un encaissement de Ryō.
          </p>
        </div>
      </section>

      <div className="dashboard-grid stats-grid">
        <section className="panel">
          <SectionHeader
            title="Dette ouverte par grade"
            description="Ninjas actifs · toutes années RP confondues"
          />
          {data.debtByGrade.length ? (
            <>
              <div
                className="horizontal-chart"
                role="img"
                aria-label={`Dette par grade : ${data.debtByGrade.map((entry) => `${entry.grade}, ${number.format(entry.amount)} Ryō`).join(" ; ")}`}
              >
                {data.debtByGrade.map((entry) => (
                  <div key={entry.grade}>
                    <span>{entry.grade}</span>
                    <i>
                      <b
                        style={{
                          width: `${Math.max(0, Math.min(100, entry.percent))}%`,
                        }}
                      />
                    </i>
                    <strong>
                      <MoneyDisplay amount={entry.amount} />
                    </strong>
                  </div>
                ))}
              </div>
              <p className="chart-summary">
                Ces dettes comprennent les cycles précédents. Le montant seul ne
                renseigne pas sur leur ancienneté.
              </p>
            </>
          ) : (
            <EmptyState
              title="Aucune dette ouverte"
              description="Aucun solde fiscal positif sur les dossiers actifs."
            />
          )}
        </section>
        <section className="panel">
          <SectionHeader
            title="Situation des lignes fiscales"
            description={`${number.format(data.weekCompliance.total)} ligne(s) sur l’année RP ${data.rpYear}`}
          />
          {data.weekCompliance.total > 0 ? (
            <>
              <div
                className="horizontal-chart"
                role="img"
                aria-label={compliance
                  .map(
                    (row) =>
                      `${number.format(row.count)} ${row.label.toLocaleLowerCase("fr")}`,
                  )
                  .join(", ")}
              >
                {compliance.map((row) => (
                  <div key={row.label}>
                    <span>{row.label}</span>
                    <i>
                      <b
                        style={{
                          width: `${(row.count * 100) / data.weekCompliance.total}%`,
                        }}
                      />
                    </i>
                    <strong>{number.format(row.count)}</strong>
                  </div>
                ))}
              </div>
              <p className="chart-summary">
                {formatPercentBps(data.weekCompliance.settledRateBps)} des
                lignes du cycle sont soldées. Ce graphique compte les lignes
                fiscales, pas les agents.
              </p>
            </>
          ) : (
            <EmptyState
              title="Aucune ligne fiscale"
              description="Le suivi apparaîtra dès la création des taxes du cycle."
            />
          )}
        </section>
      </div>

      <div className="dashboard-grid stats-grid">
        <section className="panel">
          <SectionHeader
            title="Crédits d’exonération"
            description="Crédit accordé, utilisé et encore disponible"
          />
          <div className="mini-list">
            <div>
              <span>
                <strong>Accordé ce cycle</strong>
                <small>Crédit créé sur les dossiers</small>
              </span>
              <strong>
                <MoneyDisplay amount={data.exemptionFlow.granted} />
              </strong>
            </div>
            <div>
              <span>
                <strong>Appliqué ce cycle</strong>
                <small>Taxes couvertes · corrections exclues</small>
              </span>
              <strong>
                <MoneyDisplay amount={data.exemptionFlow.spent} />
              </strong>
            </div>
            <div>
              <span>
                <strong>Encours total</strong>
                <small>Toutes périodes · crédit restant aux ninjas</small>
              </span>
              <strong>
                <MoneyDisplay amount={data.exemptionFlow.outstanding} />
              </strong>
            </div>
          </div>
          <p className="chart-summary">
            L’application d’un crédit aux taxes suit le taux d’exonération
            configuré. L’encours peut inclure du crédit acquis lors de cycles
            précédents.
          </p>
        </section>
        <section className="panel">
          <SectionHeader
            title="Attributions de points"
            description="Principaux bénéficiaires sur le cycle RP"
            action={<PointDisplay points={data.pointsDistributed} />}
          />
          {data.topNinjas.length ? (
            <div className="mini-list">
              {data.topNinjas.map((ninja) => (
                <div key={ninja.code}>
                  <span>
                    {ninja.id ? (
                      <Link
                        className="ninja-record-link"
                        href={`/ninjas/${ninja.id}`}
                      >
                        <strong>{ninja.name}</strong>
                      </Link>
                    ) : (
                      <strong>{ninja.name}</strong>
                    )}
                    <small>{ninja.code}</small>
                  </span>
                  <PointDisplay points={ninja.points} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Aucun point attribué"
              description="Aucune écriture positive de points sur ce cycle."
            />
          )}
          <p className="chart-summary">
            Écritures positives du cycle, avant contre-écritures. Les soldes à
            jour figurent dans les dossiers ninja.
          </p>
        </section>
      </div>

      <section className="panel">
        <SectionHeader
          title="Ressources traitées"
          description="Principales ressources des dons et rachats validés, créés durant ce cycle"
          action={
            hasPermission(session, "inventory:read") ? (
              <Link className="button button-ghost" href="/inventory/movements">
                Journal des stocks →
              </Link>
            ) : undefined
          }
        />
        {data.topResources.length ? (
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Ressources traitées durant le cycle"
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Ressource</th>
                  <th scope="col">Opération</th>
                  <th scope="col" className="num">
                    Quantité enregistrée
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.topResources.map((resource) => (
                  <tr key={`${resource.name}-${resource.typeLabel}`}>
                    <th scope="row">{resource.name}</th>
                    <td>{resource.typeLabel}</td>
                    <td className="num">{number.format(resource.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Aucune ressource traitée"
            description="Les dons et rachats validés du cycle apparaîtront ici."
          />
        )}
        <p className="chart-summary">
          Les quantités suivent l’unité de chaque ressource. Elles ne
          s’additionnent pas entre ressources de natures différentes.
        </p>
      </section>
    </div>
  );
}
