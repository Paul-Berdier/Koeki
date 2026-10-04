import Link from "next/link";
import { EmptyState, PageHeader, StatusBadge } from "@koeki/ui";
import { ROLES, isLeadershipRole } from "@koeki/domain";
import { getAccounts } from "@/lib/account-service";
import { demoMode, hasPermission, requirePermission, roleLabels } from "@/lib/session";
import { AccountActionDialog } from "./account-action-dialog";

export default async function AccountsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePermission("users:read");
  const params = await searchParams;
  const query = Object.fromEntries(Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const data = await getAccounts(query);
  const leadership = hasPermission(session, "users:leadership");
  const href = (page: number) => { const url = new URLSearchParams(query); url.set("page", String(page)); return `/admin/comptes?${url}`; };
  return <div className="page-wrap">
    <PageHeader eyebrow="Administration" title="Comptes" description="Retirez un rôle ou un accès sans effacer les identités RP, les obligations fiscales ni l’historique." actions={<Link className="button button-ghost" href="/admin?section=invitations">Invitations et paramètres</Link>} />
    <p className="notice">Les responsables gèrent les agents, ninjas et auditeurs. Seul un super-administrateur peut modifier les dirigeants ou attribuer leurs rôles.</p>
    {demoMode && <p className="notice">Démonstration : aucun compte réel n’est chargé ; connectez-vous hors démonstration pour gérer les accès.</p>}
    {query.erreur && <p className="notice error" role="alert">{query.erreur}</p>}{query.info && <p className="notice" role="status">{query.info}</p>}
    <section className="panel">
      <form className="form-grid" method="get">
        <div className="form-row"><label>Rechercher une identité RP<input name="q" type="search" defaultValue={query.q ?? ""} placeholder="Nom, prénom, alias ou code ninja" maxLength={100} /></label><label>Rôle<select name="role" defaultValue={query.role ?? ""}><option value="">Tous les rôles</option>{ROLES.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label><label>État d’accès<select name="state" defaultValue={query.state === "disabled" ? "disabled" : "active"}><option value="active">Comptes actifs</option><option value="disabled">Comptes désactivés</option></select></label></div>
        <div className="form-actions"><button className="button button-primary" type="submit">Filtrer les comptes</button><Link className="button button-ghost" href="/admin/comptes">Effacer les filtres</Link></div>
      </form>
      {data.users.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label="Comptes et actions autorisées"><table><caption>{data.total} compte(s) · page {data.page} sur {data.pages}</caption><thead><tr><th scope="col">Identité RP</th><th scope="col">Rôles et accès</th><th scope="col">Affectations restantes</th><th scope="col">Actions</th></tr></thead><tbody>{data.users.map((user) => {
        const editable = !demoMode && (leadership || !user.roles.some(isLeadershipRole));
        return <tr key={user.id}><th scope="row"><strong>{user.name}</strong>{user.code && <p>{user.code}</p>}</th><td>{user.roles.map((role) => <div key={role}>{roleLabels[role]}</div>)}<StatusBadge status={user.revokedAt ? "overdue" : "paid"}>{user.revokedAt ? "Accès désactivé" : "Accès actif"}</StatusBadge></td><td>{user.dossiers} dossier(s)<br />{user.tasks} tâche(s) ouverte(s)</td><td>{editable ? <div style={{ display: "grid", gap: 8 }}>
          {user.revokedAt ? <AccountActionDialog user={user} operation="reactivate" replacements={[]} canGrantLeadership={leadership} /> : <>
            <AccountActionDialog user={user} operation="roles" replacements={data.replacements} canGrantLeadership={leadership} />
            {user.roles.includes("ECONOMIC_AGENT") && <AccountActionDialog user={user} operation="remove-agent" replacements={data.replacements} canGrantLeadership={leadership} />}
            {user.id !== session.userId && <AccountActionDialog user={user} operation="revoke" replacements={data.replacements} canGrantLeadership={leadership} />}
          </>}
        </div> : <span>Compte dirigeant protégé</span>}</td></tr>;
      })}</tbody></table></div> : <EmptyState title="Aucun compte dans cette sélection" description="Modifiez la recherche, le rôle ou l’état d’accès." />}
      <nav aria-label="Pagination des comptes" className="form-actions">{data.page > 1 && <Link className="button button-ghost" href={href(data.page - 1)}>Page précédente</Link>}{data.page < data.pages && <Link className="button button-ghost" href={href(data.page + 1)}>Page suivante</Link>}</nav>
    </section>
  </div>;
}
