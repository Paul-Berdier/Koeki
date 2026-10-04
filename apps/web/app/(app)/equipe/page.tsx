import Link from "next/link";
import { ArrowRight, CircleCheck, ClipboardList, Users } from "lucide-react";
import { prisma } from "@koeki/database";
import {
  EmptyState,
  MetricCard,
  MoneyDisplay,
  PageHeader,
  SectionHeader,
} from "@koeki/ui";
import { ActionForm } from "@/components/action-form";
import { ActivityChart, WorkloadChart } from "@/components/team-charts";
import { TeamAgentTable } from "@/components/team-agent-table";
import { TeamPeriod } from "@/components/team-period";
import { getAssignableAgents } from "@/lib/team-service";
import { getTeamAnalytics, resolveTeamPeriod } from "@/lib/team-analytics";
import { demoMode, hasPermission, requirePermission } from "@/lib/session";
import { assignDossier } from "./actions";

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requirePermission("team:read"),
    query = await searchParams;
  let period, periodError;
  try {
    period = resolveTeamPeriod({ from: query.du, to: query.au });
  } catch {
    period = resolveTeamPeriod();
    periodError =
      "Cette période est invalide. Les 30 derniers jours sont affichés ; choisissez de 1 à 366 jours.";
  }
  const data = await getTeamAnalytics(session, period);
  const view =
    query.vue === "agents" || query.vue === "attributions"
      ? query.vue
      : "synthese";
  const canAssign = hasPermission(session, "team:assign");
  const pageCount = Math.max(1, Math.ceil(data.totals.unassignedDossiers / 10));
  const page = Math.min(
    pageCount,
    Math.max(1, Math.floor(Number(query.page)) || 1),
  );
  const [assignees, unassigned] =
    view === "attributions"
      ? await Promise.all([
          canAssign ? getAssignableAgents(session) : [],
          !demoMode
            ? prisma.ninjaProfile.findMany({
                where: { referenceAgentId: null, status: "ACTIVE" },
                select: { id: true, firstName: true, lastName: true },
                take: 10,
                skip: (page - 1) * 10,
                orderBy: [{ lastName: "asc" }, { id: "asc" }],
              })
            : [],
        ])
      : [[], []];
  const params = new URLSearchParams({ du: data.from, au: data.to });
  return (
    <div className="page-wrap management-page">
      <PageHeader
        eyebrow="Espace responsable"
        title="Pilotage de l’équipe"
        description="L’activité, la charge et les besoins d’accompagnement de votre service."
        actions={
          <Link href="/taches?nouvelle=1" className="button button-primary">
            <ClipboardList size={17} aria-hidden="true" />
            Créer une tâche
          </Link>
        }
      />
      {periodError && (
        <p className="notice error" role="alert">
          {periodError}
        </p>
      )}
      {query.erreur && (
        <p className="notice error" role="alert">
          {query.erreur}
        </p>
      )}
      <TeamPeriod from={data.from} to={data.to} action="/equipe" view={view} />
      <nav className="view-tabs" aria-label="Vues de l’équipe">
        <Link
          href={`/equipe?${params}`}
          aria-current={view === "synthese" ? "page" : undefined}
        >
          Vue d’ensemble
        </Link>
        <Link
          href={`/equipe?${params}&vue=agents`}
          aria-current={view === "agents" ? "page" : undefined}
        >
          Agents <span>{data.totals.agents}</span>
        </Link>
        <Link
          href={`/equipe?${params}&vue=attributions`}
          aria-current={view === "attributions" ? "page" : undefined}
        >
          À attribuer <span>{data.totals.unassignedDossiers}</span>
        </Link>
      </nav>
      {view === "synthese" && (
        <>
          <section className="metric-grid" aria-label="Synthèse de l’équipe">
            <MetricCard
              label="Agents dans le service"
              value={data.totals.activeAgents}
              detail={`${data.totals.absentAgents} en absence déclarée · ${data.totals.agents} dans le registre`}
            />
            <MetricCard
              label="Opérations validées"
              value={data.totals.total}
              detail={`${data.totals.payments} paiements · ${data.totals.donations} dons · ${data.totals.buybacks} rachats`}
            />
            <MetricCard
              label="Encaissements fiscaux"
              value={
                <MoneyDisplay amount={BigInt(data.totals.collected)} compact />
              }
              detail="Paiements validés sur la période"
              tone="good"
            />
            <MetricCard
              label="Tâches terminées"
              value={data.totals.tasksDone}
              detail={`${data.totals.tasksOpen} tâches actuellement ouvertes`}
            />
          </section>
          <div className="management-grid">
            <section className="panel">
              <SectionHeader
                title="Rythme de l’activité"
                description="Paiements, dons et rachats validés au fil des jours"
              />
              <ActivityChart days={data.daily} />
            </section>
            <section className="panel attention-panel">
              <SectionHeader
                title="À traiter"
                description="La situation du service aujourd’hui"
              />
              <div className="attention-list">
                {data.attention.length ? (
                  data.attention.map((item) => (
                    <Link
                      key={item.kind}
                      href={
                        item.kind === "unassigned-dossiers"
                          ? `/equipe?${params}&vue=attributions`
                          : item.href
                      }
                    >
                      <span
                        className={`attention-count ${item.kind === "blocked" ? "danger" : ""}`}
                      >
                        {item.count}
                      </span>
                      <span>{item.label}</span>
                      <ArrowRight size={16} aria-hidden="true" />
                    </Link>
                  ))
                ) : (
                  <div className="quiet-state">
                    <CircleCheck size={28} aria-hidden="true" />
                    <strong>Aucune action en attente</strong>
                    <p>
                      Aucun blocage, retard ou élément à attribuer enregistré.
                    </p>
                  </div>
                )}
              </div>
            </section>
          </div>
          <section className="panel">
            <SectionHeader
              title="Les agents en un regard"
              description="Activité de la période et charge actuelle, y compris sans opération"
              action={
                <Link
                  href={`/equipe?${params}&vue=agents`}
                  className="text-link"
                >
                  Tous les agents <ArrowRight size={16} aria-hidden="true" />
                </Link>
              }
            />
            <TeamAgentTable
              agents={data.agents}
              from={data.from}
              to={data.to}
              compact
            />
          </section>
        </>
      )}
      {view === "agents" && (
        <>
          <div className="management-grid">
            <section className="panel">
              <SectionHeader
                title="Répartition du travail"
                description="Charge actuelle par agent, indépendante de la période d’activité"
              />
              <WorkloadChart
                rows={data.workload}
                from={data.from}
                to={data.to}
              />
            </section>
            <section className="panel participation-overview">
              <SectionHeader
                title="Présence dans le service"
                description="Participation déclarée, sans mesure de connexion"
              />
              <dl>
                <div>
                  <dt>Participation ouverte</dt>
                  <dd>{data.totals.activeAgents}</dd>
                </div>
                <div>
                  <dt>Absence déclarée aujourd’hui</dt>
                  <dd>{data.totals.absentAgents}</dd>
                </div>
                <div>
                  <dt>Accès désactivé</dt>
                  <dd>{data.totals.disabledAgents}</dd>
                </div>
                <div>
                  <dt>Sans opération sur la période</dt>
                  <dd>{data.totals.noActivityAgents}</dd>
                </div>
              </dl>
              <p>
                Aucune opération enregistrée ne signifie pas une absence de
                travail. Ouvrez la fiche pour consulter le contexte.
              </p>
            </section>
          </div>
          <section className="panel">
            <SectionHeader
              title="Registre des agents"
              description="Recherchez un agent, comparez sa charge et ouvrez sa fiche."
            />
            <TeamAgentTable
              agents={data.agents}
              from={data.from}
              to={data.to}
            />
          </section>
        </>
      )}
      {view === "attributions" && (
        <section className="panel" id="sans-referent">
          <SectionHeader
            title="Dossiers à attribuer"
            description={`${data.totals.unassignedDossiers} dossiers actifs sans référent`}
            action={
              <Link className="text-link" href="/taches?agent=unassigned">
                Tâches sans agent <ArrowRight size={16} aria-hidden="true" />
              </Link>
            }
          />
          {unassigned.length ? (
            <div className="assignment-list">
              {unassigned.map((ninja) => (
                <details key={ninja.id} className="assignment-item">
                  <summary>
                    <span className="assignment-icon">
                      <Users size={18} aria-hidden="true" />
                    </span>
                    <strong>
                      {ninja.firstName} {ninja.lastName}
                    </strong>
                    <span>Attribuer un référent</span>
                  </summary>
                  <div className="assignment-body">
                    <Link href={`/ninjas/${ninja.id}`} className="text-link">
                      Consulter le dossier
                    </Link>
                    {canAssign && !demoMode && (
                      <ActionForm action={assignDossier} className="form-grid">
                        <input
                          type="hidden"
                          name="returnTo"
                          value={`/equipe?${params}&vue=attributions&page=${page}`}
                        />
                        <input type="hidden" name="ninjaId" value={ninja.id} />
                        <label>
                          Référent
                          <select name="assigneeId" required>
                            <option value="">Choisir un agent</option>
                            {assignees.map((agent) => (
                              <option value={agent.id} key={agent.id}>
                                {agent.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Motif
                          <input
                            name="reason"
                            required
                            minLength={5}
                            maxLength={1000}
                          />
                        </label>
                        <button className="button button-primary">
                          Attribuer le dossier
                        </button>
                      </ActionForm>
                    )}
                  </div>
                </details>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Tous les dossiers ont un référent"
              description="Les nouveaux dossiers sans agent apparaîtront ici."
            />
          )}
          <footer className="table-footer">
            <span>
              Page {page} sur {pageCount}
            </span>
            <div className="pagination-controls">
              {page > 1 && (
                <Link
                  href={`/equipe?${params}&vue=attributions&page=${page - 1}`}
                >
                  Précédent
                </Link>
              )}
              {page < pageCount && (
                <Link
                  href={`/equipe?${params}&vue=attributions&page=${page + 1}`}
                >
                  Suivant
                </Link>
              )}
            </div>
          </footer>
        </section>
      )}
      <details className="methodology">
        <summary>Comprendre les indicateurs et leur couverture</summary>
        <div className="methodology-grid">
          {data.definitions.map((definition) => (
            <div key={definition.key}>
              <h3>{definition.label}</h3>
              <p>{definition.description}</p>
            </div>
          ))}
        </div>
        <p>
          {data.dataQuality.excludedPayments +
            data.dataQuality.excludedTransactions}{" "}
          opérations datées exclues · {data.dataQuality.unknownValidationDates}{" "}
          validations sans date connue parmi les créations de la période.
        </p>
      </details>
    </div>
  );
}
