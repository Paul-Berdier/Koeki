import Link from "next/link";
import { ArrowLeft, PackagePlus } from "lucide-react";
import { PageHeader, SectionHeader } from "@koeki/ui";
import { demoMode, hasPermission, requirePermission } from "@/lib/session";
import { createResource } from "../actions";
import { prisma } from "@koeki/database";

export default async function NewResourcePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePermission("inventory:catalog");
  const query = await searchParams;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const [categories, units] = demoMode ? [[], []] : await Promise.all([
    prisma.resourceCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { label: "asc" }] }),
    prisma.resourceUnit.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } })
  ]);
  const canPrice = hasPermission(session, "settings:manage");
  return <div className="page-wrap">
    <PageHeader eyebrow="Catalogue" title="Nouvelle ressource" description="Aucune quantité n’est saisie ici : le stock de départ vient toujours d’un comptage (solde initial tracé). Le code est stable et sert de référence (futur scan)."
      actions={<Link className="button button-ghost" href="/inventory"><ArrowLeft size={17} /> Inventaire</Link>} />
    {error && <p className="notice error" role="alert">{error}</p>}
    {demoMode ? <p className="notice" role="status">Mode démonstration : les écritures sont désactivées.</p> : <section className="panel" style={{ maxWidth: 720 }}>
      <SectionHeader title="Définition" description="Nom, catégorie et unité sont obligatoires ; les alias facilitent la recherche" />
      <form action={createResource} className="form-grid">
        <div className="form-row">
          <label>Nom *<input type="text" name="name" required minLength={2} maxLength={120} placeholder="Fer, Plan T2, Pièces Chakra…" /></label>
          <label>Code <small className="field-help">(facultatif — proposé depuis le nom)</small><input type="text" name="code" maxLength={40} placeholder="RES-IRON" pattern="[A-Za-z0-9][A-Za-z0-9-]{2,39}" style={{ textTransform: "uppercase" }} /></label>
        </div>
        <div className="form-row">
          <label>Catégorie *<select name="categoryId" required defaultValue="">{<option value="" disabled>Choisir…</option>}{categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
          <label>Unité *<select name="unitId" required defaultValue={units.find((unit) => unit.code === "UNIT")?.id ?? ""}>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.label}{unit.decimals ? ` (${unit.decimals} décimales)` : " (entière)"}</option>)}</select></label>
        </div>
        <label>Alias de recherche <small className="field-help">(séparés par des virgules : Iron, T1…)</small><input type="text" name="aliases" maxLength={400} placeholder="Iron" /></label>
        <label>Description<input type="text" name="description" maxLength={500} /></label>
        <div className="form-row">
          <label>Seuil bas (alerte « Faible »)<input type="number" name="minimumStock" min={0} step="0.001" defaultValue={0} /></label>
          <label>Seuil critique (alerte « Critique »)<input type="number" name="criticalStock" min={0} step="0.001" defaultValue={0} /></label>
        </div>
        {canPrice && <>
          <div className="form-row">
            <label>Prix de rachat (Ryō / unité, facultatif)<input type="number" name="price" min={0} step={1} placeholder="Aucun prix pour l’instant" /></label>
            <label>Besoin du village<select name="demand" defaultValue="NONE"><option value="NONE">Non besoin</option><option value="NEEDED">Besoin</option><option value="CRITICAL">Critique (besoin primaire)</option></select></label>
          </div>
          <div className="form-row">
            <label>Points par unité donnée<input type="number" name="pointsPerUnit" min={0} step={1} defaultValue={0} /></label>
            <label>Exonération par unité donnée (Ryō)<input type="number" name="exemptionPerUnit" min={0} step={1} defaultValue={0} /></label>
          </div>
        </>}
        <div className="form-actions"><button className="button button-primary" type="submit"><PackagePlus size={16} /> Créer la ressource</button></div>
      </form>
    </section>}
  </div>;
}
