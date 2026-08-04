import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Save, Trash2 } from "lucide-react";
import { PageHeader, SectionHeader } from "@koeki/ui";
import { demoMode, requirePermission } from "@/lib/session";
import { deleteResource, updateResource } from "../../actions";
import { prisma } from "@koeki/database";

export default async function EditResourcePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("settings:manage");
  const { id } = await params;
  const query = await searchParams;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const [resource, categories, units] = demoMode ? [null, [], []] : await Promise.all([
    prisma.resource.findUnique({ where: { id } }),
    prisma.resourceCategory.findMany({ orderBy: { label: "asc" } }),
    prisma.resourceUnit.findMany({ orderBy: { label: "asc" } })
  ]);
  if (!demoMode && !resource) notFound();
  return <div className="page-wrap">
    <PageHeader eyebrow={resource ? `Ressource ${resource.code}` : "Mode démonstration"} title="Modifier la ressource" description="Le prix se modifie depuis le catalogue (motif obligatoire, historique conservé)."
      actions={<Link className="button button-ghost" href="/resources"><ArrowLeft size={17} /> Catalogue</Link>} />
    {error && <p className="notice error" role="alert">{error}</p>}
    {demoMode || !resource ? <p className="notice" role="status">Mode démonstration : les écritures sont désactivées.</p> : <>
    <section className="panel" style={{ maxWidth: 680 }}>
      <SectionHeader title="Définition" description="Chaque modification est auditée" />
      <form action={updateResource} className="form-grid">
        <input type="hidden" name="resourceId" value={resource.id} />
        <label>Nom *<input type="text" name="name" required maxLength={120} defaultValue={resource.name} /></label>
        <div className="form-row">
          <label>Catégorie *<select name="categoryId" required defaultValue={resource.categoryId}>{categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
          <label>Unité *<select name="unitId" required defaultValue={resource.unitId}>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.label} ({unit.symbol})</option>)}</select></label>
        </div>
        <label>Description<input type="text" name="description" maxLength={500} defaultValue={resource.description ?? ""} /></label>
        <div className="form-row">
          <label>Seuil bas<input type="number" name="minimumStock" min={0} step="0.01" defaultValue={Number(resource.minimumStock)} /></label>
          <label>Seuil critique<input type="number" name="criticalStock" min={0} step="0.01" defaultValue={Number(resource.criticalStock)} /></label>
        </div>
        <label>Besoin du village<select name="demand" defaultValue={resource.demand}><option value="NONE">Non besoin</option><option value="NEEDED">Besoin</option><option value="CRITICAL">Critique (besoin primaire)</option></select></label>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" name="isActive" defaultChecked={resource.isActive} style={{ minHeight: 0, width: 16, height: 16 }} /> Ressource active (visible dans les transactions et l’inventaire)</label>
        <div className="form-actions"><button className="button button-primary" type="submit"><Save size={16} /> Enregistrer</button></div>
      </form>
    </section>
    <section className="panel" style={{ maxWidth: 680, marginTop: 12, borderColor: "rgba(169,79,63,.48)" }}>
      <SectionHeader title="Supprimer la ressource" description="Sans historique : suppression définitive. Utilisée quelque part (mouvements, prix, transactions, recettes) : désactivation." />
      <form action={deleteResource} className="form-grid">
        <input type="hidden" name="resourceId" value={resource.id} />
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" name="confirm" required style={{ minHeight: 0, width: 16, height: 16 }} /> Je confirme pour {resource.name} ({resource.code})</label>
        <div className="form-actions"><button className="button button-ghost" type="submit" style={{ color: "var(--terracotta-300)", borderColor: "rgba(169,79,63,.48)" }}><Trash2 size={16} /> Supprimer / désactiver</button></div>
      </form>
    </section>
    </>}
  </div>;
}
