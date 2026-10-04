import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, MoneyDisplay, StatusBadge } from "@koeki/ui";
import { ModulePage } from "@/components/module-page";
import { getRecovery } from "@/lib/data";
import { demoMode, hasPermission, requireSession } from "@/lib/session";

export default async function RecoveryPage() {
  const session = await requireSession();
  if (
    !hasPermission(session, "payments:write") &&
    !hasPermission(session, "business:read")
  )
    redirect("/access-denied");
  const data = await getRecovery();
  const canAssign = !demoMode && hasPermission(session, "tasks:manage");
  return (
    <ModulePage
      eyebrow="Opérations"
      title="Recouvrement"
      description="Ouvrez les dossiers prioritaires pour encaisser un règlement ou organiser une relance."
      registerTitle="Dossiers à relancer"
      registerDescription="Ordre de priorité : ancienneté et dette."
      metrics={[
        {
          label: "Dette prioritaire",
          value: <MoneyDisplay amount={data.metrics.priorityDebt} />,
          detail: `${data.metrics.priorityCount} dossier${data.metrics.priorityCount > 1 ? "s" : ""} critiques`,
          tone: data.metrics.priorityCount ? "danger" : "good",
        },
        {
          label: "Retard moyen",
          value: data.metrics.averageLate,
          detail: "Sur les dossiers ouverts",
          tone: data.rows.length ? "warn" : "good",
        },
        {
          label: "Dette en retard",
          value: <MoneyDisplay amount={data.metrics.totalDebt} />,
          detail: `${data.rows.length} dossier${data.rows.length > 1 ? "s" : ""} ouverts`,
        },
        {
          label: "Reprise à régulariser",
          value: String(data.metrics.unassigned),
          detail: data.metrics.unassigned
            ? "Impayés de l’ancien registre"
            : "Aucun dossier hérité",
          tone: data.metrics.unassigned ? "warn" : "good",
        },
      ]}
    >
      {data.rows.length ? (
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Dossiers de recouvrement"
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Dossier</th>
                <th scope="col" className="num">
                  Dette
                </th>
                <th scope="col">Situation</th>
                <th scope="col">Référent</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, index) => (
                <tr key={row.id}>
                  <th scope="row">
                    <div className="person-cell">
                      <span className="queue-position">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <Link
                        className="ninja-record-link"
                        href={`/ninjas/${row.id}`}
                      >
                        <strong>{row.name}</strong>
                        <small className="cell-detail">{row.code}</small>
                      </Link>
                    </div>
                  </th>
                  <td className={`num ${row.debt > 0n ? "negative" : "muted"}`}>
                    {row.debt > 0n ? (
                      <MoneyDisplay amount={row.debt} />
                    ) : (
                      "Ancien registre"
                    )}
                  </td>
                  <td>
                    {row.debt > 0n ? (
                      <StatusBadge status="overdue">
                        Relance requise
                      </StatusBadge>
                    ) : (
                      <StatusBadge status="warning">
                        Reprise à régulariser
                      </StatusBadge>
                    )}
                    <small className="cell-detail">{row.due}</small>
                  </td>
                  <td>{row.agent}</td>
                  <td>
                    <div className="work-row-actions">
                      <Link
                        className="button button-ghost"
                        href={`/ninjas/${row.id}`}
                      >
                        Ouvrir le dossier
                      </Link>
                      {canAssign && (
                        <Link
                          className="text-link"
                          href={`/taches?nouvelle=1&ninjaId=${encodeURIComponent(row.id)}`}
                        >
                          Créer une relance
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="Aucun dossier en retard"
          description="Tous les ninjas actifs sont à jour de leurs taxes."
        />
      )}
    </ModulePage>
  );
}
