import Link from "next/link";
import { ArrowLeft, BookPlus } from "lucide-react";
import { PageHeader, SectionHeader } from "@koeki/ui";
import { demoMode, requirePermission } from "@/lib/session";
import { createRecipe } from "../actions";
import { prisma } from "@koeki/database";

export default async function NewRecipePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("settings:manage");
  const query = await searchParams;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const [resources, grades] = demoMode ? [[], []] : await Promise.all([
    prisma.resource.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, include: { unit: true } }),
    prisma.ninjaGrade.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } })
  ]);
  return <div className="page-wrap">
    <PageHeader eyebrow="Ateliers de Suna" title="Nouvelle recette" description="Un même code peut être versionné : l’ancienne version est désactivée, jamais supprimée."
      actions={<Link className="button button-ghost" href="/crafting"><ArrowLeft size={17} /> Recettes</Link>} />
    {error && <p className="notice error" role="alert">{error}</p>}
    {demoMode ? <p className="notice" role="status">Mode démonstration : les écritures sont désactivées.</p> : <section className="panel" style={{ maxWidth: 720 }}>
      <SectionHeader title="Définition" description="Ingrédients consommés et production éventuelle" />
      <form action={createRecipe} className="form-grid">
        <div className="form-row">
          <label>Code (ex. REC-ARM-015)<input type="text" name="code" required pattern="[A-Z0-9-]{3,20}" /></label>
          <label>Nom<input type="text" name="name" required maxLength={120} /></label>
        </div>
        <div className="form-row">
          <label>Catégorie<input type="text" name="category" required maxLength={60} placeholder="Armurerie, Médecine…" /></label>
          <label>Difficulté<input type="text" name="difficulty" required maxLength={40} placeholder="Novice, Confirmé…" /></label>
        </div>
        <div className="form-row">
          <label>Durée RP (minutes)<input type="number" name="durationRpMinutes" required min={1} /></label>
          <label>Coût (Ryō)<input type="number" name="cost" required min={0} /></label>
        </div>
        <label>Grade minimal<select name="minimumGradeCode" defaultValue=""><option value="">Aucun</option>{grades.map((grade) => <option key={grade.id} value={grade.code}>{grade.label}</option>)}</select></label>
        <label>Description<textarea name="description" maxLength={1000} /></label>
        <fieldset>
          <legend>Ingrédients consommés (jusqu’à 4)</legend>
          {[1, 2, 3, 4].map((index) => <div className="form-row" key={index}>
            <label>Ingrédient {index}<select name={`ingredientId_${index}`} defaultValue=""><option value="">—</option>{resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name} ({resource.unit.symbol})</option>)}</select></label>
            <label>Quantité<input type="number" name={`ingredientQty_${index}`} min={0} step="0.01" /></label>
          </div>)}
        </fieldset>
        <div className="form-row">
          <label>Production (facultatif)<select name="outputId" defaultValue=""><option value="">Aucune</option>{resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select></label>
          <label>Quantité produite<input type="number" name="outputQty" min={0} step="0.01" /></label>
        </div>
        <div className="form-actions"><button className="button button-primary" type="submit"><BookPlus size={16} /> Créer la recette</button></div>
      </form>
    </section>}
  </div>;
}
