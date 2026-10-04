import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  Banknote,
  FileText,
  Gift,
  PackagePlus,
  Users,
} from "lucide-react";
import { EmptyState, PageHeader, SectionHeader, StatusBadge } from "@koeki/ui";
import { getMyWorkSummary, taskLabels } from "@/lib/team-service";
import { formatDate } from "@/lib/format";
import { demoMode, hasPermission, requireSession } from "@/lib/session";
import { prisma } from "@koeki/database";

export default async function DashboardPage() {
  const session = await requireSession();
  if (!hasPermission(session, "business:read")) {
    const own = demoMode
      ? null
      : await prisma.ninjaProfile.findUnique({
          where: { userId: session.userId },
          select: { id: true },
        });
    redirect(own ? `/ninjas/${own.id}` : "/profil");
  }
  if (!hasPermission(session, "tasks:read")) redirect("/statistics");
  const manager = hasPermission(session, "team:read");
  const work = await getMyWorkSummary(session);
  const shortcuts = [
    ...(hasPermission(session, "payments:write")
      ? [
          {
            href: "/ninjas",
            label: "Encaisser une taxe",
            text: "Choisir le dossier ninja",
            icon: Banknote,
          },
        ]
      : []),
    ...(hasPermission(session, "inventory:write")
      ? [
          {
            href: "/dons",
            label: "Enregistrer un don",
            text: "Ressources remises au village",
            icon: Gift,
          },
          {
            href: "/resources/transaction",
            label: "Effectuer un rachat",
            text: "Racheter des ressources",
            icon: PackagePlus,
          },
        ]
      : []),
    ...(hasPermission(session, "reports:write")
      ? [
          {
            href: "/reports/new",
            label: "Rédiger mon rapport",
            text: "Rendre compte de mon travail",
            icon: FileText,
          },
        ]
      : []),
  ];
  return (
    <div className="page-wrap bureau-page">
      <PageHeader
        eyebrow="Service économique de Suna"
        title="Mon bureau"
        description={
          manager
            ? "Les actions du jour et les dossiers qui demandent votre attention."
            : "Vos prochaines tâches et les outils pour faire avancer vos dossiers."
        }
      />
      <div className="bureau-intro">
        <div>
          <span className="eyebrow">
            {manager ? "Responsable du service" : "Agent du service"}
          </span>
          <h2>
            {manager
              ? "Accompagnez votre équipe."
              : "À chaque dossier, la bonne action."}
          </h2>
          <p>
            {manager
              ? "Retrouvez les agents, leur activité et leur charge de travail dans le pilotage."
              : "Retrouvez vos dossiers attribués, puis enregistrez les opérations au fil de votre journée."}
          </p>
          <Link
            href={manager ? "/equipe" : "/ninjas?mesDossiers=1"}
            className="button button-primary"
          >
            {manager
              ? "Ouvrir le pilotage"
              : `Mes dossiers (${work.assignedDossiers})`}
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
        <div className="bureau-emblem" aria-hidden="true">
          <span>砂</span>
          <small>SUNA · KŌEKI</small>
        </div>
      </div>
      <section className="quick-actions" aria-label="Actions courantes">
        {shortcuts.map(({ href, label, text, icon: Icon }) => (
          <Link href={href} key={href}>
            <span className="quick-action-icon">
              <Icon size={20} aria-hidden="true" />
            </span>
            <span>
              <strong>{label}</strong>
              <small>{text}</small>
            </span>
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        ))}
      </section>
      <div className="management-grid">
        <section className="panel">
          <SectionHeader
            title={
              manager ? "Suivi prioritaire du service" : "Mes prochaines tâches"
            }
            description="Les tâches ouvertes, classées par échéance"
            action={
              <Link href="/taches" className="text-link">
                Tout voir <ArrowRight size={16} aria-hidden="true" />
              </Link>
            }
          />
          {work.tasks.length ? (
            <ul className="bureau-task-list">
              {work.tasks.map((task) => (
                <li key={task.id}>
                  <Link href={`/taches?id=${task.id}`}>
                    <span
                      className={`task-indicator ${task.status === "BLOCKED" ? "blocked" : ""}`}
                      aria-hidden="true"
                    />
                    <span>
                      <strong>{task.title}</strong>
                      <small>
                        {task.dueAt
                          ? `Échéance : ${formatDate(task.dueAt)}`
                          : "Sans échéance"}
                      </small>
                    </span>
                    <StatusBadge
                      status={task.status === "BLOCKED" ? "warning" : "pending"}
                    >
                      {taskLabels[task.status] ?? task.status}
                    </StatusBadge>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="Aucune tâche ouverte"
              description={
                manager
                  ? "Créez une tâche depuis le suivi pour organiser une action de l’équipe."
                  : "Les tâches qui vous sont confiées apparaîtront ici."
              }
            />
          )}
        </section>
        <section className="panel">
          <SectionHeader
            title="À ne pas oublier"
            description={
              manager ? "Décisions et interventions" : "Vos points de suivi"
            }
          />
          <div className="attention-list">
            {manager && (
              <Link href="/reports?statut=SUBMITTED">
                <span className="attention-count">{work.awaitingReview}</span>
                <span>Rapports à examiner</span>
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            )}
            <Link href={`/reports?statut=RETURNED&auteur=${session.userId}`}>
              <span className="attention-count">{work.returnedReports}</span>
              <span>Mes rapports à corriger</span>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link href="/taches?statut=overdue">
              <span className="attention-count">{work.overdueTasks}</span>
              <span>
                {manager
                  ? "Tâches du service en retard"
                  : "Mes tâches en retard"}
              </span>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
            {manager && (
              <Link href="/equipe?vue=attributions">
                <span className="attention-count">
                  {work.unassignedDossiers}
                </span>
                <span>Dossiers à attribuer</span>
                <Users size={16} aria-hidden="true" />
              </Link>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
