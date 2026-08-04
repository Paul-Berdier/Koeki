import { CheckCircle2 } from "lucide-react";
import { EmptyState, MoneyDisplay, SectionHeader, StatusBadge } from "@koeki/ui";
import { ModulePage } from "@/components/module-page";
import { getResources } from "@/lib/data";
import { demoMode, hasPermission, requireSession } from "@/lib/session";
import { approveTransaction, updatePrice } from "./actions";

export default async function ResourcesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const query = await searchParams;
  const canManage = !demoMode && hasPermission(session, "settings:manage");
  const canTransact = !demoMode && hasPermission(session, "inventory:write");
  const data = await getResources(canManage);
  const receipt = typeof query.recu === "string" ? query.recu : null;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const aside = (canManage || data.pendingApprovals.length > 0) ? <aside style={{ display: "grid", gap: 12 }}>
    {canManage && data.pendingApprovals.length > 0 && <section className="panel">
      <SectionHeader title="Validations en attente" description="Rachats au-dessus du seuil configuré" />
      <div className="mini-list">{data.pendingApprovals.map((pending) => <div key={pending.id}><span><strong>{pending.ninja}</strong><small>{pending.receipt} · {pending.at}</small></span><form action={approveTransaction} style={{ display: "flex", alignItems: "center", gap: 8 }}><MoneyDisplay amount={pending.total} /><input type="hidden" name="transactionId" value={pending.id} /><button className="button button-ghost" type="submit"><CheckCircle2 size={15} /> Valider</button></form></div>)}</div>
    </section>}
    {canManage && <section className="panel">
      <SectionHeader title="Modifier un prix" description="Historisé — n’affecte jamais les anciennes transactions" />
      <form action={updatePrice} className="form-grid">
        <label>Ressource<select name="resourceId" required>{data.resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select></label>
        <div className="form-row">
          <label>Nouveau prix (Ryō)<input type="number" name="price" min={0} step={1} required /></label>
          <label>Motif<input type="text" name="reason" required minLength={3} maxLength={300} /></label>
        </div>
        <div className="form-actions"><button className="button button-ghost" type="submit">Appliquer le prix</button></div>
      </form>
    </section>}
  </aside> : undefined;
  return <ModulePage eyebrow="Catalogue et tarification" title="Ressources" description="Prix publics historisés, unités contrôlées et disponibilité du village."
    actionLabel={canTransact ? "Nouvelle transaction" : undefined} actionHref="/resources/transaction" registerDescription="Catalogue et prix actifs" aside={aside} metrics={[
    { label: "Rachats ce cycle", value: <MoneyDisplay amount={data.metrics.buybackTotal} />, detail: `${data.metrics.buybackCount} opération${data.metrics.buybackCount > 1 ? "s" : ""}` },
    { label: "Dons reçus", value: <MoneyDisplay amount={data.metrics.donationValue} />, detail: `${data.metrics.donationCount} don${data.metrics.donationCount > 1 ? "s" : ""} · valeur estimée`, tone: "good" },
    { label: "Validations en attente", value: String(data.pendingApprovals.length), detail: data.pendingApprovals.length ? "Rachats au-dessus du seuil" : "Aucun rachat bloqué", tone: data.pendingApprovals.length ? "warn" : "neutral" },
    { label: "Catalogue", value: String(data.metrics.totalCount), detail: `${data.metrics.activeCount} ressources actives` }
  ]}>
    {receipt && <p className="notice" role="status" style={{ margin: "12px 20px 0" }}>Transaction validée — reçu <code>{receipt}</code>.</p>}
    {error && <p className="notice error" role="alert" style={{ margin: "12px 20px 0" }}>{error}</p>}
    {data.resources.length ? <div className="table-scroll"><table><thead><tr><th>Code</th><th>Ressource</th><th>Catégorie</th><th>Prix unitaire</th><th>Stock</th><th>Disponibilité</th></tr></thead><tbody>{data.resources.map((resource) => <tr key={resource.id}><td><code>{resource.code}</code></td><td><strong>{resource.name}</strong></td><td>{resource.category}</td><td>{resource.price > 0n ? <MoneyDisplay amount={resource.price} /> : <span className="muted">Non défini</span>}</td><td>{resource.stock.toLocaleString("fr-FR")} {resource.unit}</td><td><StatusBadge status={resource.badge}>{resource.stateLabel}</StatusBadge></td></tr>)}</tbody></table></div>
      : <EmptyState title="Catalogue vide" description="Créez les ressources via le seed d’amorçage ou l’administration." />}
  </ModulePage>;
}
