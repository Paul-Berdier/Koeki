import Link from "next/link";
import { ArrowLeft, PackagePlus } from "lucide-react";
import { PageHeader, SectionHeader } from "@koeki/ui";
import { demoMode, requirePermission } from "@/lib/session";
import { createResource } from "../actions";
import { prisma } from "@koeki/database";

export default async function NewResourcePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("settings:manage");
  const query = await searchParams;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const [categories, units] = demoMode ? [[], []] : await Promise.all([
    prisma.resourceCategory.findMany({ orderBy: { label: "asc" } }),
    prisma.resourceUnit.findMany({ orderBy: { label: "asc" } })
  ]);
  return <div className="page-wrap">
    <PageHeader eyebrow="Catalogue" title="Nouvelle ressource" description="Le code administratif (RES-XXX-NN) est attribué automatiquement. Le prix pourra ensuite évoluer avec son historique."
      actions={<Link className="button button-ghost" href="/resources"><ArrowLeft size={17} /> Catalogue</Link>} />
    {error && <p className="notice error" role="alert">{error}</p>}
    {demoMode ? <p className="notice" role="status">Mode démonstration : les écritures sont désactivées.</p> : <section className="panel" style={{ maxWidth: 680 }}>
      <SectionHeader title="Définition" description="Catégorie et unité sont obligatoires" />
      <form action={createResource} className="form-grid">
        <label>Nom *<input type="text" name="name" required maxLength={120} placeholder="Minerai de cuivre…" /></label>
        <div className="form-row">
          <label>Catégorie *<select name="categoryId" required>{categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
          <label>Unité *<select name="unitId" required>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.label} ({unit.symbol})</option>)}</select></label>
        </div>
        <div className="form-row">
          <label>Prix de rachat (Ryō / unité, facultatif)<input type="number" name="price" min={0} step={1} placeholder="Aucun prix pour l’instant" /></label>
          <label>Description<input type="text" name="description" maxLength={500} /></label>
        </div>
        <div className="form-row">
          <label>Seuil bas (alerte de réapprovisionnement)<input type="number" name="minimumStock" min={0} step="0.01" defaultValue={0} /></label>
          <label>Seuil critique<input type="number" name="criticalStock" min={0} step="0.01" defaultValue={0} /></label>
        </div>
        <div className="form-actions"><button className="button button-primary" type="submit"><PackagePlus size={16} /> Créer la ressource</button></div>
      </form>
    </section>}
  </div>;
}
