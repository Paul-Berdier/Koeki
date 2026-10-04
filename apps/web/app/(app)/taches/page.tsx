import Link from "next/link";
import { prisma } from "@koeki/database";
import { PageHeader, EmptyState, StatusBadge } from "@koeki/ui";
import { ActionForm } from "@/components/action-form";
import {
  getAssignableAgents,
  getTasks,
  priorityLabels,
  taskLabels,
} from "@/lib/team-service";
import { demoMode, hasPermission, requirePermission } from "@/lib/session";
import { formatReportDate } from "@/lib/report-period";
import { createTask, transitionTask, updateTaskAssignment } from "./actions";

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requirePermission("tasks:read"),
    query = await searchParams;
  const manager = hasPermission(session, "tasks:manage");
  const [data, agents, dossiers] = await Promise.all([
    getTasks(session, {
      id: query.id,
      status: query.statut,
      page: Number(query.page) || 1,
      assignee: query.agent,
    }),
    manager ? getAssignableAgents(session) : [],
    manager && !demoMode
      ? prisma.ninjaProfile.findMany({
          where: { status: "ACTIVE" },
          select: { id: true, firstName: true, lastName: true, code: true },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        })
      : [],
  ]);
  const choices = (
    <>
      <option value="">À attribuer</option>
      {agents.map((agent) => (
        <option key={agent.id} value={agent.id}>
          {agent.name}
        </option>
      ))}
    </>
  );
  const dates = (date: Date | null) =>
    date
      ? date.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })
      : "Sans échéance";
  const pageHref = (page: number) =>
    `?${new URLSearchParams({ ...(query.statut ? { statut: query.statut } : {}), ...(query.agent ? { agent: query.agent } : {}), ...(query.id ? { id: query.id } : {}), page: String(page) })}`;
  const badge = (status: string) =>
    status === "DONE"
      ? ("paid" as const)
      : status === "BLOCKED"
        ? ("overdue" as const)
        : status === "IN_PROGRESS"
          ? ("pending" as const)
          : ("draft" as const);
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="Suivi"
        title={manager ? "Tâches de l’équipe" : "Mes tâches"}
        description={
          manager
            ? "Répartissez le travail et suivez les échéances de l’équipe."
            : "Ouvrez une tâche pour renseigner son avancement ou signaler un blocage."
        }
      />
      {query.erreur && (
        <p role="alert" className="notice error">
          {query.erreur}
        </p>
      )}
      {query.id && (
        <Link className="text-link" href="/taches">
          ← Revenir à toutes les tâches
        </Link>
      )}
      <section className="panel">
        <form
          method="get"
          className="filter-bar"
          aria-label="Filtrer les tâches"
        >
          <label>
            État
            <select name="statut" defaultValue={query.statut ?? ""}>
              <option value="">Tous</option>
              <option value="overdue">Échéance dépassée</option>
              {Object.entries(taskLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {manager && (
            <label>
              Agent
              <select name="agent" defaultValue={query.agent ?? ""}>
                <option value="">Toute l’équipe</option>
                <option value="unassigned">À attribuer</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button className="button button-primary">Filtrer les tâches</button>
          {(query.statut || query.agent) && (
            <Link className="button button-ghost" href="/taches">
              Effacer les filtres
            </Link>
          )}
        </form>
      </section>
      {manager && !demoMode && (
        <details
          className="panel settings-disclosure"
          open={Boolean(query.reportId) || query.nouvelle === "1"}
        >
          <summary>Créer une tâche de suivi</summary>
          <ActionForm action={createTask} className="form-grid">
            <label>
              Titre
              <input name="title" required minLength={3} maxLength={160} />
            </label>
            <label>
              Objectif et description
              <textarea
                name="description"
                required
                minLength={5}
                maxLength={4000}
              />
            </label>
            <div className="form-row">
              <label>
                Agent<select name="assigneeId">{choices}</select>
              </label>
              <label>
                Priorité
                <select name="priority" defaultValue="NORMAL">
                  {Object.entries(priorityLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Échéance
                <input type="date" name="dueAt" />
              </label>
            </div>
            <label>
              Dossier ninja (facultatif)
              <select name="ninjaId" defaultValue={query.ninjaId ?? ""}>
                <option value="">Aucun dossier lié</option>
                {dossiers.map((dossier) => (
                  <option key={dossier.id} value={dossier.id}>
                    {dossier.firstName} {dossier.lastName} · {dossier.code}
                  </option>
                ))}
              </select>
            </label>
            <input type="hidden" name="reportId" value={query.reportId ?? ""} />
            {query.reportId && (
              <p>
                Liée au{" "}
                <Link className="text-link" href={`/reports/${query.reportId}`}>
                  rapport source
                </Link>
                .
              </p>
            )}
            <div className="form-actions">
              <button className="button button-primary">Créer la tâche</button>
            </div>
          </ActionForm>
        </details>
      )}
      <div className="task-list">
        {data.tasks.length === 0 && (
          <section className="panel">
            <EmptyState
              title="Aucune tâche"
              description="Aucune tâche accessible ne correspond à cette sélection."
            />
          </section>
        )}
        {data.tasks.map((task) => {
          const closed = ["DONE", "CANCELLED"].includes(task.status);
          const overdue = !closed && task.dueAt && task.dueAt < new Date();
          return (
            <details
              className="panel task-item"
              id={task.id}
              key={task.id}
              open={query.id === task.id}
            >
              <summary className="task-summary">
                <span className="work-row-main">
                  <strong>{task.title}</strong>
                  <span className="task-meta">
                    <span>{task.assigneeName}</span>
                    <span className={overdue ? "negative" : undefined}>
                      {overdue ? "En retard · " : ""}
                      {dates(task.dueAt)}
                    </span>
                    <span>
                      Priorité{" "}
                      {(
                        priorityLabels[task.priority] ?? task.priority
                      ).toLocaleLowerCase("fr-FR")}
                    </span>
                  </span>
                </span>
                <StatusBadge status={badge(task.status)}>
                  {taskLabels[task.status]}
                </StatusBadge>
              </summary>
              <div className="task-body">
                <p className="preserve-lines">{task.description}</p>
                {task.resolution && (
                  <p className="notice">
                    <strong>Dernier suivi</strong>
                    <br />
                    {task.resolution}
                  </p>
                )}
                <div className="form-actions">
                  {task.ninjaId && (
                    <Link
                      className="text-link"
                      href={`/ninjas/${task.ninjaId}`}
                    >
                      Dossier ninja
                    </Link>
                  )}
                  {task.reportId && (
                    <Link
                      className="text-link"
                      href={`/reports/${task.reportId}`}
                    >
                      Rapport source
                    </Link>
                  )}
                  <Link className="text-link" href={`/taches?id=${task.id}`}>
                    Lien vers cette tâche
                  </Link>
                </div>
                {!demoMode && (manager || !closed) && (
                  <ActionForm action={transitionTask} className="form-grid">
                    <input type="hidden" name="taskId" value={task.id} />
                    <input type="hidden" name="version" value={task.version} />
                    <div className="form-row">
                      <label>
                        Nouvel état
                        <select name="status" defaultValue={task.status}>
                          {Object.entries(taskLabels)
                            .filter(([key]) => manager || key !== "CANCELLED")
                            .map(([key, label]) => (
                              <option value={key} key={key}>
                                {label}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        Avancement, blocage ou résolution
                        <textarea name="reason" maxLength={4000} />
                      </label>
                    </div>
                    <div className="form-actions">
                      <button className="button button-primary">
                        Mettre à jour l’avancement
                      </button>
                    </div>
                  </ActionForm>
                )}
                {manager && !demoMode && (
                  <details className="settings-disclosure">
                    <summary>
                      Réaffecter, prioriser ou modifier l’échéance
                    </summary>
                    <ActionForm
                      action={updateTaskAssignment}
                      className="form-grid"
                    >
                      <input type="hidden" name="taskId" value={task.id} />
                      <input
                        type="hidden"
                        name="version"
                        value={task.version}
                      />
                      <div className="form-row">
                        <label>
                          Agent
                          <select
                            name="assigneeId"
                            defaultValue={task.assigneeId ?? ""}
                          >
                            {choices}
                          </select>
                        </label>
                        <label>
                          Priorité
                          <select name="priority" defaultValue={task.priority}>
                            {Object.entries(priorityLabels).map(
                              ([key, label]) => (
                                <option key={key} value={key}>
                                  {label}
                                </option>
                              ),
                            )}
                          </select>
                        </label>
                        <label>
                          Échéance
                          <input
                            name="dueAt"
                            type="date"
                            defaultValue={
                              task.dueAt ? formatReportDate(task.dueAt) : ""
                            }
                          />
                        </label>
                      </div>
                      <label>
                        Justification
                        <textarea
                          name="reason"
                          minLength={5}
                          maxLength={1000}
                          required
                        />
                      </label>
                      <div className="form-actions">
                        <button className="button button-primary">
                          Appliquer les changements
                        </button>
                      </div>
                    </ActionForm>
                  </details>
                )}
                <details className="settings-disclosure">
                  <summary>Historique des transitions</summary>
                  <ol className="task-history">
                    {task.transitions.map((transition) => (
                      <li key={transition.id}>
                        <strong>
                          {transition.fromStatus
                            ? taskLabels[transition.fromStatus]
                            : "Création"}{" "}
                          → {taskLabels[transition.toStatus]}
                        </strong>
                        <small>
                          {transition.createdAt.toLocaleString("fr-FR", {
                            timeZone: "Europe/Paris",
                          })}
                        </small>
                        {transition.reason && <p>{transition.reason}</p>}
                      </li>
                    ))}
                  </ol>
                </details>
              </div>
            </details>
          );
        })}
      </div>
      <footer className="table-footer">
        <span>
          {data.total} tâche(s) · page {data.page} sur {data.pageCount}
        </span>
        <div className="form-actions">
          {data.page > 1 && (
            <Link
              className="button button-ghost"
              href={pageHref(data.page - 1)}
            >
              Précédent
            </Link>
          )}
          {data.page < data.pageCount && (
            <Link
              className="button button-ghost"
              href={pageHref(data.page + 1)}
            >
              Suivant
            </Link>
          )}
        </div>
      </footer>
    </div>
  );
}
