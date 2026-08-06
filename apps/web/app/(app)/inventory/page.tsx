import { EmptyState, MoneyDisplay, SectionHeader } from "@koeki/ui";
import { ModulePage } from "@/components/module-page";
import { getInventory } from "@/lib/data";
import { demoMode, hasPermission, requireSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { recordAdjustment } from "./actions";

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  if (!hasPermission(session, "inventory:write") && !hasPermission(session, "audit:read")) redirect("/access-denied");
  const query = await searchParams;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const data = await getInventory();
  const canAdjust = !demoMode && hasPermission(session, "inventory:write");
  const canOverride = hasPermission(session, "settings:manage");
  const aside = canAdjust ? <aside className="aside-duo"><section className="panel">
    <SectionHeader title="Ajustement contrôlé" description="Chaque variation crée un mouvement immuable" />
    <form action={recordAdjustment} className="form-grid">
      <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
      <label>Ressource<select name="resourceId" required>{data.resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name} — stock {resource.stock.toLocaleString("fr-FR")}</option>)}</select></label>
      <label>Quantité (négatif = sortie)<input type="number" name="quantity" step={1} required placeholder="-2" /></label>
      <label>Justification<input type="text" name="justification" required minLength={3} maxLength={300} placeholder="Inventaire physique du 4 août…" /></label>
      {canOverride && <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" name="allowNegative" style={{ minHeight: 0, width: 16, height: 16 }} /> Autoriser un stock négatif (audité)</label>}
      <div className="form-actions"><button className="button button-primary" type="submit">Enregistrer le mouvement</button></div>
    </form>
  </section></aside> : undefined;
  return <ModulePage eyebrow="Stocks traçables" title="Inventaire" description="Chaque variation est expliquée par un mouvement immuable et audité." registerTitle="Derniers mouvements" registerDescription="Journal chronologique" aside={aside} metrics={[
    { label: "Valeur estimée", value: <MoneyDisplay amount={data.metrics.stockValue} />, detail: "Au dernier prix connu" },
    { label: "Mouvements aujourd’hui", value: String(data.metrics.movementsToday), detail: `${data.metrics.inToday} entrées · ${data.metrics.outToday} sorties` },
    { label: "Stocks critiques", value: String(data.metrics.criticalCount), detail: data.metrics.criticalCount ? "Action nécessaire" : "Aucun seuil critique franchi", tone: data.metrics.criticalCount ? "danger" : "good" },
    { label: "Stocks bas", value: String(data.metrics.lowCount), detail: data.metrics.lowCount ? "Réapprovisionnement à planifier" : "Niveaux conformes", tone: data.metrics.lowCount ? "warn" : "good" }
  ]}>
    {error && <p className="notice error" role="alert" style={{ margin: "12px 20px 0" }}>{error}</p>}
    {data.alerts.length > 0 && <div className="inventory-board">{data.alerts.slice(0, 3).map((alert) => <div key={alert.id} className={`stock-card ${alert.level === "critical" ? "critical" : "warning"}`}><span>{alert.level === "critical" ? "Critique" : "Bas"}</span><strong>{alert.name}</strong><b>{alert.stock.toLocaleString("fr-FR")}</b><small>Seuil {alert.level === "critical" ? "critique" : "bas"} : {alert.threshold.toLocaleString("fr-FR")}</small></div>)}</div>}
    {data.movements.length ? <div className="table-scroll"><table><thead><tr><th>Date</th><th>Ressource</th><th>Type</th><th>Quantité</th><th>Agent</th><th>Justification</th></tr></thead><tbody>{data.movements.map((movement) => <tr key={movement.id}><td>{movement.at}</td><td><strong>{movement.resource}</strong></td><td>{movement.type}</td><td className={movement.quantity < 0 ? "negative" : "positive"}>{movement.quantity > 0 ? "+" : ""}{movement.quantity.toLocaleString("fr-FR")}</td><td>{movement.agent}</td><td>{movement.justification}</td></tr>)}</tbody></table></div>
      : <EmptyState title="Aucun mouvement" description="Les dons, rachats, fabrications et ajustements alimenteront ce journal." />}
  </ModulePage>;
}
