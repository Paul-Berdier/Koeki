import Link from "next/link";
import { isLeadershipRole } from "@koeki/domain";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Ban, KeyRound, X } from "lucide-react";
import { EmptyState, PageHeader, SectionHeader, StatusBadge } from "@koeki/ui";
import { getAdmin } from "@/lib/data";
import { formatPercentBps } from "@/lib/format";
import {
  demoMode,
  hasPermission,
  requireSession,
  roleLabels,
} from "@/lib/session";
import {
  billCurrentWeek,
  createInvitation,
  dismissLastInvite,
  revokeInvitation,
  updateApprovalThreshold,
  updateExemptionPolicy,
  updatePenaltySettings,
  updateTaxRates,
} from "./actions";
import { ConfirmSettingSubmit } from "./confirm-setting-submit";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  if (
    !hasPermission(session, "settings:manage") &&
    !hasPermission(session, "users:manage")
  )
    redirect("/access-denied");
  const query = await searchParams;
  const section =
    query.section === "economic"
      ? "economic"
      : query.section === "technical"
        ? "technical"
        : "invitations";
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const info = typeof query.info === "string" ? query.info : null;
  const data = await getAdmin();
  const canWrite = !demoMode;
  const isSuper = hasPermission(session, "users:leadership");
  const assignableRoles = data.roles.filter(
    (role) => isSuper || !isLeadershipRole(role.code),
  );
  let lastInvite: { token: string; role: string; expiresAt: string } | null =
    null;
  const rawInvite = (await cookies()).get("koeki_last_invite")?.value;
  if (rawInvite) {
    try {
      lastInvite = JSON.parse(rawInvite);
    } catch {
      lastInvite = null;
    }
  }
  const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");
  const penaltyMissing =
    data.penalty.percentBps === null || !data.penalty.isValidated;
  const title =
    section === "economic"
      ? "Réglages économiques"
      : section === "technical"
        ? "Configuration"
        : "Invitations";
  const description =
    section === "economic"
      ? "Consultez les règles actives avant de publier une modification."
      : section === "technical"
        ? "La politique fiscale et le calendrier utilisés par le service."
        : "Ouvrez un accès et suivez les invitations encore valables.";
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="Administration"
        title={title}
        description={description}
      />
      <nav className="settings-tabs" aria-label="Catégories de réglages">
        {[
          ["invitations", "Invitations"],
          ["economic", "Fiscalité et rachats"],
          ["technical", "Configuration"],
        ].map(([key, label]) => (
          <Link
            key={key}
            href={`/admin?section=${key}`}
            aria-current={section === key ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {info && (
        <p className="notice" role="status">
          {info}
        </p>
      )}
      {lastInvite && (
        <div className="notice invite-result" role="status">
          <div>
            <strong>
              Invitation{" "}
              {roleLabels[lastInvite.role as keyof typeof roleLabels] ??
                lastInvite.role}{" "}
              créée
            </strong>
            <p>Transmettez ce lien à la personne invitée.</p>
            <code>
              {appUrl}/invite/{lastInvite.token}
            </code>
          </div>
          <form action={dismissLastInvite}>
            <button
              className="button button-ghost"
              type="submit"
              aria-label="Masquer le lien"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </form>
        </div>
      )}

      {section === "invitations" && (
        <>
          {canWrite && (
            <details
              className="panel settings-disclosure"
              id="new-invitation"
              open={query.nouvelle === "1" || data.invitations.length === 0}
            >
              <summary>Créer une invitation</summary>
              <form action={createInvitation} className="form-grid">
                <div className="form-row">
                  <label>
                    Rôle
                    <select
                      name="roleId"
                      required
                      defaultValue={
                        assignableRoles.find(
                          (role) => role.code === "ECONOMIC_AGENT",
                        )?.id
                      }
                    >
                      {assignableRoles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Expiration
                    <select name="expiresDays" defaultValue="7">
                      <option value="3">3 jours</option>
                      <option value="7">7 jours</option>
                      <option value="14">14 jours</option>
                      <option value="30">30 jours</option>
                    </select>
                  </label>
                </div>
                <label>
                  Rattacher à un ninja (facultatif)
                  <select name="ninjaProfileId" defaultValue="">
                    <option value="">Aucun</option>
                    {data.freeNinjas.map((ninja) => (
                      <option key={ninja.id} value={ninja.id}>
                        {ninja.code} · {ninja.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="form-actions">
                  <button className="button button-primary" type="submit">
                    <KeyRound size={16} aria-hidden="true" /> Générer
                    l’invitation
                  </button>
                </div>
              </form>
            </details>
          )}
          <section className="panel">
            <SectionHeader
              title="Invitations récentes"
              description="Une invitation peut être révoquée avant son utilisation."
            />
            {data.invitations.length ? (
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Invitations récentes"
              >
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Rôle et dossier</th>
                      <th scope="col">Créée</th>
                      <th scope="col">Expire</th>
                      <th scope="col">État</th>
                      <th scope="col">
                        <span className="sr-only">Action</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.invitations.map((invitation) => (
                      <tr key={invitation.id}>
                        <th scope="row">
                          <strong>{invitation.role}</strong>
                          <p className="muted">
                            {invitation.ninja ?? "Sans dossier réservé"}
                          </p>
                        </th>
                        <td>{invitation.createdAt}</td>
                        <td>{invitation.expiresAt}</td>
                        <td>
                          <StatusBadge status={invitation.badge}>
                            {invitation.statusLabel}
                          </StatusBadge>
                        </td>
                        <td>
                          {canWrite &&
                            invitation.canRevoke &&
                            (isSuper ||
                              !isLeadershipRole(invitation.roleCode ?? "")) && (
                              <form action={revokeInvitation}>
                                <input
                                  type="hidden"
                                  name="invitationId"
                                  value={invitation.id}
                                />
                                <button
                                  className="button button-ghost"
                                  type="submit"
                                >
                                  <Ban size={14} aria-hidden="true" /> Révoquer
                                </button>
                              </form>
                            )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="Aucune invitation"
                description="Créez une invitation pour ouvrir le prochain accès."
              />
            )}
          </section>
        </>
      )}

      {section === "economic" && (
        <div className="workspace-split">
          <div className="settings-stack">
            <section className="panel" id="bareme-panel">
              <SectionHeader
                title={`Semaine fiscale ${data.currentWeek.rpYear}`}
                description={`${data.currentWeek.period} · échéance dimanche minuit`}
              />
              <div className="mini-list">
                <div>
                  <span>Dossiers facturés</span>
                  <strong>
                    {data.currentWeek.lines} / {data.currentWeek.activeNinjas}
                  </strong>
                </div>
                <div>
                  <span>Dossiers imposables</span>
                  <strong>{data.currentWeek.billable}</strong>
                </div>
                <div>
                  <span>Grades à renseigner</span>
                  <Link
                    className="text-link"
                    href="/ninjas?statut=grade_missing"
                  >
                    {data.currentWeek.gradesToUpdate}
                  </Link>
                </div>
              </div>
              {data.currentWeek.billable === 0 && (
                <p className="notice error" role="alert">
                  Aucun montant dû cette semaine. Vérifiez les grades et le
                  barème avant de facturer.
                </p>
              )}
              {canWrite && (
                <details className="settings-disclosure">
                  <summary>Facturation de la semaine en cours</summary>
                  <form action={billCurrentWeek} className="form-grid">
                    <p>
                      Génère les obligations manquantes avec le barème actif.
                    </p>
                    <div className="form-actions">
                      <button className="button button-ghost" type="submit">
                        Facturer la semaine en cours maintenant
                      </button>
                    </div>
                  </form>
                </details>
              )}
            </section>
            <details
              className="panel settings-disclosure"
              open={data.currentWeek.billable === 0}
            >
              <summary>
                <strong>Barème hebdomadaire par grade</strong>
                <span>
                  {data.policy
                    ? `${data.policy.name} · version ${data.policy.version}`
                    : "Aucune politique active"}
                </span>
              </summary>
              {canWrite ? (
                <form
                  id="tax-rates-form"
                  action={updateTaxRates}
                  className="form-grid"
                >
                  <p>
                    La publication refacture la semaine en cours et conserve les
                    paiements existants.
                  </p>
                  {data.gradeRates.map((rate) => (
                    <div className="form-row rate-form-row" key={rate.gradeId}>
                      <label htmlFor={`rate-${rate.gradeId}`}>
                        {rate.label}
                      </label>
                      <input
                        id={`rate-${rate.gradeId}`}
                        aria-label={`Taxe hebdomadaire ${rate.label}`}
                        type="number"
                        name={`rate_${rate.gradeId}`}
                        min={0}
                        step={1}
                        defaultValue={rate.amount}
                      />
                    </div>
                  ))}
                  <div className="form-actions">
                    <ConfirmSettingSubmit
                      formId="tax-rates-form"
                      label="Publier le barème et refacturer la semaine"
                      impact="Ce barème s’applique immédiatement à la semaine RP en cours. Les lignes sans opération seront recalculées. Les paiements, majorations et exemptions existants sont conservés ; le crédit disponible s’applique selon le plafond configuré."
                      fields={data.gradeRates.map((rate) => ({
                        name: `rate_${rate.gradeId}`,
                        label: rate.label,
                        unit: "Ryō",
                      }))}
                    />
                  </div>
                </form>
              ) : (
                <div className="mini-list">
                  {data.gradeRates.map((rate) => (
                    <div key={rate.gradeId}>
                      <span>{rate.label}</span>
                      <strong>{rate.amount.toLocaleString("fr-FR")} Ryō</strong>
                    </div>
                  ))}
                </div>
              )}
            </details>
            <details className="panel settings-disclosure" id="exemption-panel">
              <summary>
                <strong>Crédit d’exonération</strong>
                <span>
                  Plafond par semaine :{" "}
                  {formatPercentBps(data.exemption.weeklyTaxCoverageBps)}
                </span>
              </summary>
              {canWrite ? (
                <form
                  id="exemption-policy-form"
                  action={updateExemptionPolicy}
                  className="form-grid"
                >
                  <label>
                    Part maximale d’une taxe couverte (%)
                    <input
                      type="number"
                      name="coveragePercent"
                      min={0}
                      max={100}
                      step={0.01}
                      required
                      defaultValue={data.exemption.weeklyTaxCoverageBps / 100}
                    />
                  </label>
                  <p>
                    À 0 %, les crédits sont conservés mais ne réduisent plus les
                    taxes. Les semaines déjà couvertes restent inchangées.
                  </p>
                  <div className="form-actions">
                    <ConfirmSettingSubmit
                      formId="exemption-policy-form"
                      label="Modifier le plafond d’exonération"
                      impact="Le nouveau plafond s’applique immédiatement aux taxes ouvertes. À 0 %, les soldes de crédit sont conservés et leur application est suspendue. Les taxes déjà couvertes restent inchangées."
                      fields={[
                        {
                          name: "coveragePercent",
                          label: "Part maximale par taxe",
                          unit: "%",
                        },
                      ]}
                    />
                  </div>
                </form>
              ) : (
                <p className="empty-inline">
                  Part appliquée :{" "}
                  {formatPercentBps(data.exemption.weeklyTaxCoverageBps)}.
                </p>
              )}
            </details>
            <details
              className="panel settings-disclosure"
              id="penalty-panel"
              open={penaltyMissing}
            >
              <summary>
                <strong>Majorations de retard</strong>
                <span>
                  {penaltyMissing
                    ? "Taux à valider · automatisation inactive"
                    : `${formatPercentBps(data.penalty.percentBps!)} par semaine · ${data.penalty.isEnabled ? "active" : "inactive"}`}
                </span>
              </summary>
              {canWrite ? (
                <form action={updatePenaltySettings} className="form-grid">
                  <div className="form-row">
                    <label>
                      Taux de majoration (% par semaine de retard)
                      <input
                        type="number"
                        name="percent"
                        min={0.01}
                        max={100}
                        step={0.01}
                        defaultValue={
                          data.penalty.percentBps === null
                            ? ""
                            : data.penalty.percentBps / 100
                        }
                        placeholder="Ex. 10"
                      />
                    </label>
                    <label>
                      Base de calcul
                      <select name="basis" defaultValue={data.penalty.basis}>
                        <option value="ORIGINAL_TAX">Taxe originale</option>
                        <option value="REMAINING_PRINCIPAL">
                          Principal restant
                        </option>
                        <option value="CURRENT_DEBT">Dette actuelle</option>
                      </select>
                    </label>
                  </div>
                  <div className="form-row">
                    <label>
                      Applications maximum
                      <input
                        type="number"
                        name="maxApplications"
                        min={1}
                        max={20}
                        defaultValue={data.penalty.maxApplications}
                      />
                    </label>
                    <label>
                      Plafond de dette (Ryō)
                      <input
                        type="number"
                        name="maxDebt"
                        min={0}
                        defaultValue={data.penalty.maxDebt}
                      />
                    </label>
                  </div>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      name="isRateValidated"
                      defaultChecked={data.penalty.isValidated}
                    />{" "}
                    Je valide explicitement ce taux
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      name="isEnabled"
                      defaultChecked={data.penalty.isEnabled}
                    />{" "}
                    Activer l’application automatique
                  </label>
                  <div className="form-actions">
                    <button className="button button-ghost" type="submit">
                      Enregistrer les majorations
                    </button>
                  </div>
                </form>
              ) : (
                <p className="empty-inline">
                  {penaltyMissing ? "Taux non validé." : "Taux validé."}
                </p>
              )}
            </details>
            <details className="panel settings-disclosure">
              <summary>
                <strong>Approbation des rachats</strong>
                <span>
                  {data.approval.isValidated
                    ? `À partir de ${BigInt(data.approval.amount).toLocaleString("fr-FR")} Ryō`
                    : "Seuil non activé"}
                </span>
              </summary>
              {canWrite ? (
                <form action={updateApprovalThreshold} className="form-grid">
                  <label>
                    Seuil (Ryō)
                    <input
                      type="number"
                      name="amount"
                      min={0}
                      defaultValue={data.approval.amount}
                    />
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      name="isValidated"
                      defaultChecked={data.approval.isValidated}
                    />{" "}
                    Activer ce seuil (validation managériale)
                  </label>
                  <div className="form-actions">
                    <button className="button button-ghost" type="submit">
                      Enregistrer le seuil
                    </button>
                  </div>
                </form>
              ) : (
                <p className="empty-inline">
                  Les rachats au-dessus du seuil actif exigent une approbation.
                </p>
              )}
            </details>
          </div>
          <aside className="workspace-aside">
            <section className="panel">
              <SectionHeader title="Avant de modifier" />
              <div className="work-list">
                <div className="work-row">
                  <p>
                    Les réglages s’appliquent au service. Vérifiez leur effet
                    dans la confirmation avant de publier un barème ou un
                    plafond.
                  </p>
                </div>
                <Link className="work-row" href="/recouvrement">
                  <span className="work-row-main">
                    <strong>Vérifier les taxes ouvertes</strong>
                    <small>Consulter le recouvrement</small>
                  </span>
                </Link>
                <Link className="work-row" href="/audit">
                  <span className="work-row-main">
                    <strong>Retrouver une modification</strong>
                    <small>Consulter le journal d’audit</small>
                  </span>
                </Link>
              </div>
            </section>
          </aside>
        </div>
      )}

      {section === "technical" && (
        <section className="panel">
          <SectionHeader title="Configuration active" />
          <dl className="configuration-list">
            <div>
              <dt>Politique fiscale</dt>
              <dd>
                {data.policy
                  ? `${data.policy.name} · version ${data.policy.version} · ${data.policy.rateCount} grades`
                  : "Aucune politique active"}
              </dd>
            </div>
            <div>
              <dt>Calendrier RP</dt>
              <dd>{data.rpTimeLabel}</dd>
            </div>
          </dl>
          <div className="table-footer">
            <Link className="text-link" href="/admin?section=economic">
              Consulter les réglages économiques
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
