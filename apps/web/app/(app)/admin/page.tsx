import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AlertTriangle, Ban, CheckCircle2, KeyRound, Settings2, ShieldCheck, TimerReset, X } from "lucide-react";
import { EmptyState, PageHeader, SectionHeader, StatusBadge } from "@koeki/ui";
import { getAdmin } from "@/lib/data";
import { formatPercentBps } from "@/lib/format";
import { demoMode, hasPermission, requireSession, roleLabels } from "@/lib/session";
import { createInvitation, dismissLastInvite, revokeInvitation, revokeUserAccess, updateApprovalThreshold, updatePenaltySettings } from "./actions";

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  if (!hasPermission(session, "settings:manage") && !hasPermission(session, "users:manage")) redirect("/access-denied");
  const query = await searchParams;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const data = await getAdmin();
  const canUsers = !demoMode && hasPermission(session, "users:manage");
  const canWrite = !demoMode;
  let lastInvite: { token: string; role: string; expiresAt: string } | null = null;
  const rawInvite = (await cookies()).get("koeki_last_invite")?.value;
  if (rawInvite) { try { lastInvite = JSON.parse(rawInvite); } catch { lastInvite = null; } }
  const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");
  const penaltyMissing = data.penalty.percentBps === null || !data.penalty.isValidated;
  return <div className="page-wrap">
    <PageHeader eyebrow="Accès responsable" title="Administration" description="Politiques, invitations, permissions et paramètres structurants." />
    {error && <p className="notice error" role="alert">{error}</p>}
    {lastInvite && <div className="notice" role="status" style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
      <span>Invitation <strong>{roleLabels[lastInvite.role as keyof typeof roleLabels] ?? lastInvite.role}</strong> générée — transmettez ce lien unique (affiché une seule fois) :<br /><code>{appUrl}/invite/{lastInvite.token}</code></span>
      <form action={dismissLastInvite}><button className="button button-ghost" type="submit" aria-label="Masquer le lien"><X size={15} /></button></form>
    </div>}
    {penaltyMissing && <div className="admin-alert" role="alert"><AlertTriangle /><div><strong>Le taux de majoration n’est pas configuré.</strong><p>Les majorations automatiques sont désactivées jusqu’à validation explicite d’un responsable.</p></div><a href="#penalty-panel">Configurer</a></div>}

    <div className="admin-grid">
      <section className="panel">
        <SectionHeader title="Générer une invitation" description="Jeton à usage unique, seul le hash est stocké" />
        {canWrite ? <form action={createInvitation} className="form-grid">
          <div className="form-row">
            <label>Rôle<select name="roleId" required>{data.roles.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}</select></label>
            <label>Expiration<select name="expiresDays" defaultValue="7"><option value="3">3 jours</option><option value="7">7 jours</option><option value="14">14 jours</option><option value="30">30 jours</option></select></label>
          </div>
          <label>Rattacher à un ninja (facultatif)<select name="ninjaProfileId" defaultValue=""><option value="">Aucun</option>{data.freeNinjas.map((ninja) => <option key={ninja.id} value={ninja.id}>{ninja.code} · {ninja.name}</option>)}</select></label>
          <div className="form-actions"><button className="button button-primary" type="submit"><KeyRound size={16} /> Générer l’invitation</button></div>
        </form> : <p className="notice" style={{ margin: 18 }}>Mode démonstration : génération désactivée.</p>}
        <SectionHeader title="Invitations récentes" description="Révocables tant qu’elles n’ont pas été utilisées" />
        {data.invitations.length ? <div className="table-scroll"><table><thead><tr><th>Rôle</th><th>Ninja lié</th><th>Créée</th><th>Expire</th><th>État</th><th></th></tr></thead><tbody>{data.invitations.map((invitation) => <tr key={invitation.id}><td><strong>{invitation.role}</strong></td><td>{invitation.ninja ?? "—"}</td><td>{invitation.createdAt}</td><td>{invitation.expiresAt}</td><td><StatusBadge status={invitation.badge}>{invitation.statusLabel}</StatusBadge></td><td>{canWrite && invitation.canRevoke && <form action={revokeInvitation}><input type="hidden" name="invitationId" value={invitation.id} /><button className="button button-ghost" style={{ minHeight: 30 }} type="submit"><Ban size={14} /> Révoquer</button></form>}</td></tr>)}</tbody></table></div>
          : <EmptyState title="Aucune invitation" description="Générez la première invitation pour ouvrir l’accès." />}
        <SectionHeader title="Comptes" description="Accès révocables immédiatement (sessions invalidées)" />
        {data.users.length ? <div className="table-scroll"><table><thead><tr><th>Utilisateur</th><th>Rôles</th><th>État</th><th></th></tr></thead><tbody>{data.users.map((user) => <tr key={user.id}><td><strong>{user.name}</strong></td><td>{user.roles}</td><td><StatusBadge status={user.revoked ? "overdue" : "paid"}>{user.revoked ? "Révoqué" : "Actif"}</StatusBadge></td><td>{canUsers && !user.revoked && <form action={revokeUserAccess}><input type="hidden" name="userId" value={user.id} /><button className="button button-ghost" style={{ minHeight: 30 }} type="submit"><Ban size={14} /> Révoquer</button></form>}</td></tr>)}</tbody></table></div>
          : <EmptyState title="Aucun compte" description="Les comptes apparaissent après la première connexion sur invitation." />}
      </section>

      <aside style={{ display: "grid", gap: 12, alignContent: "start" }}>
        <section className="panel" id="penalty-panel">
          <SectionHeader title="Majorations de retard" description="Aucune automatisation sans taux validé" />
          {canWrite ? <form action={updatePenaltySettings} className="form-grid">
            <div className="form-row">
              <label>Taux (points de base, 1000 = 10 %)<input type="number" name="percentBps" min={1} max={10000} defaultValue={data.penalty.percentBps ?? ""} placeholder="Non défini" /></label>
              <label>Base de calcul<select name="basis" defaultValue={data.penalty.basis}><option value="ORIGINAL_TAX">Taxe originale</option><option value="REMAINING_PRINCIPAL">Principal restant</option><option value="CURRENT_DEBT">Dette actuelle</option></select></label>
            </div>
            <div className="form-row">
              <label>Applications maximum<input type="number" name="maxApplications" min={1} max={20} defaultValue={data.penalty.maxApplications} /></label>
              <label>Plafond de dette (Ryō)<input type="number" name="maxDebt" min={0} defaultValue={data.penalty.maxDebt} /></label>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" name="isRateValidated" defaultChecked={data.penalty.isValidated} style={{ minHeight: 0, width: 16, height: 16 }} /> Je valide explicitement ce taux</label>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" name="isEnabled" defaultChecked={data.penalty.isEnabled} style={{ minHeight: 0, width: 16, height: 16 }} /> Activer l’application automatique</label>
            <div className="form-actions"><button className="button button-ghost" type="submit">Enregistrer</button></div>
          </form> : <div className="mini-list"><div><span>Taux</span><strong>{data.penalty.percentBps === null ? "Non défini" : formatPercentBps(data.penalty.percentBps)}</strong></div></div>}
        </section>
        <section className="panel">
          <SectionHeader title="Seuil d’approbation" description="Rachats importants soumis à validation" />
          {canWrite ? <form action={updateApprovalThreshold} className="form-grid">
            <label>Seuil (Ryō)<input type="number" name="amount" min={0} defaultValue={data.approval.amount} /></label>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" name="isValidated" defaultChecked={data.approval.isValidated} style={{ minHeight: 0, width: 16, height: 16 }} /> Activer ce seuil (validation managériale)</label>
            <div className="form-actions"><button className="button button-ghost" type="submit">Enregistrer</button></div>
          </form> : null}
        </section>
        <section className="panel">
          <SectionHeader title="Configuration active" description="Paramètres versionnés et audités" />
          <div className="settings-list">
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, alignItems: "center", padding: "12px 17px", borderBottom: "1px solid var(--border)" }}><span className="setting-icon"><Settings2/></span><span><strong>Politique fiscale</strong><small style={{ display: "block", color: "var(--sand-500)" }}>{data.policy ? `${data.policy.name} v${data.policy.version} · ${data.policy.rateCount} grades` : "Aucune politique active"}</small></span><StatusBadge status={data.policy ? "paid" : "overdue"}>{data.policy ? "Active" : "Manquante"}</StatusBadge></div>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, alignItems: "center", padding: "12px 17px" }}><span className="setting-icon"><TimerReset/></span><span><strong>Temps RP</strong><small style={{ display: "block", color: "var(--sand-500)" }}>{data.rpTimeLabel}</small></span><StatusBadge status="paid">Configuré</StatusBadge></div>
          </div>
        </section>
        <section className="panel"><SectionHeader title="État du système" description="Contrôles de sécurité"/><div className="system-checks"><p><CheckCircle2/>Base Kōeki isolée</p><p><CheckCircle2/>Invitations à usage unique</p><p><CheckCircle2/>Sessions révocables</p><p><CheckCircle2/>Worker idempotent</p><p><CheckCircle2/>Indexation interdite</p><p><ShieldCheck/>Permissions vérifiées côté serveur</p></div></section>
      </aside>
    </div>
  </div>;
}
