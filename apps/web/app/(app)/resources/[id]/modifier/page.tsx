import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Save, Trash2 } from "lucide-react";
import { PageHeader, SectionHeader } from "@koeki/ui";
import { demoMode, hasPermission, requirePermission } from "@/lib/session";
import { deleteResource, updateResource } from "../../actions";
import { activePrice } from "@/lib/finance";
import { prisma } from "@koeki/database";

export default async function EditResourcePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePermission("inventory:catalog");
  const { id } = await params;
  const query = await searchParams;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const [resource, categories, units, currentPrice] = demoMode ? [null, [], [], null] : await Promise.all([
    prisma.resource.findUnique({ where: { id }, include: { aliases: true, unit: true, _count: { select: { movements: true } } } }),
    prisma.resourceCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { label: "asc" }] }),
    prisma.resourceUnit.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    activePrice(prisma, id)
  ]);
  if (!demoMode && !resource) notFound();
  const canPrice = hasPermission(session, "settings:manage");
  const unitLocked = Boolean(resource && resource._count.movements > 0);
  return <div className="page-wrap">
    <PageHeader eyebrow={resource ? `Ressource ${resource.code}` : "Mode démonstration"} title="Modifier la ressource" description="Chaque modification est auditée. Les seuils pilotent les états Faible et Critique ; l’unité se fige dès qu’un mouvement existe."
      actions={<>{resource && <Link className="button button-ghost" href={`/inventory/${resource.id}`}><ArrowLeft size={17} /> Fiche inventaire</Link>}<Link className="button button-ghost" href="/resources">Catalogue</Link></>} />
    {error && <p className="notice error" role="alert">{error}</p>}
    {demoMode || !resource ? <p className="notice" role="status">Mode démonstration : les écritures sont désactivées.</p> : <>
    <section className="panel" style={{ maxWidth: 720 }}>
      <SectionHeader title="Définition" description="Nom, code, catégorie, unité, alias, seuils" />
      <form action={updateResource} className="form-grid">
        <input type="hidden" name="resourceId" value={resource.id} />
        <div className="form-row">
          <label>Nom *<input type="text" name="name" required minLength={2} maxLength={120} defaultValue={resource.name} /></label>
          <label>Code<input type="text" name="code" maxLength={40} defaultValue={resource.code} pattern="[A-Za-z0-9][A-Za-z0-9-]{2,39}" style={{ textTransform: "uppercase" }} /></label>
        </div>
        <div className="form-row">
          <label>Catégorie *<select name="categoryId" required defaultValue={resource.categoryId}>{categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
          <label>Unité *{unitLocked && <small className="field-help"> (verrouillée : {resource._count.movements} mouvement{resource._count.movements > 1 ? "s" : ""})</small>}
            <select name="unitId" required defaultValue={resource.unitId} disabled={unitLocked}>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.label}{unit.decimals ? ` (${unit.decimals} décimales)` : " (entière)"}</option>)}</select>
            {unitLocked && <input type="hidden" name="unitId" value={resource.unitId} />}
          </label>
        </div>
        <label>Alias de recherche <small className="field-help">(séparés par des virgules)</small><input type="text" name="aliases" maxLength={400} defaultValue={resource.aliases.map((alias) => alias.alias).join(", ")} /></label>
        <label>Description<input type="text" name="description" maxLength={500} defaultValue={resource.description ?? ""} /></label>
        <div className="form-row">
          <label>Seuil bas (alerte « Faible »)<input type="number" name="minimumStock" min={0} step="0.001" defaultValue={Number(resource.minimumStock)} /></label>
          <label>Seuil critique (alerte « Critique »)<input type="number" name="criticalStock" min={0} step="0.001" defaultValue={Number(resource.criticalStock)} /></label>
        </div>
        {canPrice ? <>
          <div className="form-row">
            <label>Points par unité donnée<input type="number" name="pointsPerUnit" min={0} step={1} defaultValue={resource.pointsPerUnit} /></label>
            <label>Exonération par unité donnée (Ryō)<input type="number" name="exemptionPerUnit" min={0} step={1} defaultValue={Number(resource.exemptionPerUnit)} /></label>
          </div>
          <div className="form-row">
            <label>Prix unitaire (Ryō)<input type="number" name="price" min={0} step={1} defaultValue={currentPrice === null ? "" : Number(currentPrice)} /></label>
            <label>Motif du changement de prix<input type="text" name="priceReason" maxLength={300} placeholder="Obligatoire si le prix change" /></label>
          </div>
          <label>Besoin du village<select name="demand" defaultValue={resource.demand}><option value="NONE">Non besoin</option><option value="NEEDED">Besoin</option><option value="CRITICAL">Critique (besoin primaire)</option></select></label>
        </> : <>
          <input type="hidden" name="pointsPerUnit" value={resource.pointsPerUnit} />
          <input type="hidden" name="exemptionPerUnit" value={Number(resource.exemptionPerUnit)} />
          <input type="hidden" name="demand" value={resource.demand} />
        </>}
        <label className="check-field"><input type="checkbox" name="isActive" defaultChecked={resource.isActive} /> Ressource active (visible dans l’inventaire et les transactions)</label>
        <div className="form-actions"><button className="button button-primary" type="submit"><Save size={16} /> Enregistrer</button></div>
      </form>
    </section>
    <section className="panel" style={{ maxWidth: 720, marginTop: 12, borderColor: "rgba(169,79,63,.48)" }}>
      <SectionHeader title="Supprimer la ressource" description="Sans historique : suppression définitive. Utilisée quelque part (mouvements, prix, transactions, recettes, comptages) : désactivation." />
      <form action={deleteResource} className="form-grid">
        <input type="hidden" name="resourceId" value={resource.id} />
        <label className="check-field"><input type="checkbox" name="confirm" required /> Je confirme pour {resource.name} ({resource.code})</label>
        <div className="form-actions"><button className="button button-ghost" type="submit" style={{ color: "var(--terracotta-300)", borderColor: "rgba(169,79,63,.48)" }}><Trash2 size={16} /> Supprimer / désactiver</button></div>
      </form>
    </section>
    </>}
  </div>;
}
