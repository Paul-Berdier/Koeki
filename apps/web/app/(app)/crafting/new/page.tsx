import Link from "next/link";
import { ArrowLeft, BookPlus } from "lucide-react";
import { PageHeader, SectionHeader } from "@koeki/ui";
import { RecipeItems, type RecipeRowSeed } from "@/components/recipe-items";
import { demoMode, requirePermission } from "@/lib/session";
import { createRecipe } from "../actions";
import { prisma } from "@koeki/database";

const DEFAULT_CATEGORIES = ["Armurerie", "Armes", "Bijouterie", "Médecine", "Outillage"];
const DEFAULT_DIFFICULTIES = ["Novice", "Confirmé", "Expert", "Maître"];

export default async function NewRecipePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("settings:manage");
  const query = await searchParams;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const baseId = typeof query.base === "string" ? query.base : null;
  const [resources, grades, existingRecipes, stocks, base] = demoMode ? [[], [], [], [], null] : await Promise.all([
    prisma.resource.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.ninjaGrade.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.craftRecipe.findMany({ select: { code: true, category: true, difficulty: true }, orderBy: { code: "asc" } }),
    prisma.inventoryMovement.groupBy({ by: ["resourceId"], _sum: { quantity: true } }),
    baseId ? prisma.craftRecipe.findUnique({ where: { id: baseId }, include: { ingredients: true, outputs: true } }) : Promise.resolve(null)
  ]);
  const stockOf = new Map(stocks.map((entry) => [entry.resourceId, Number(entry._sum.quantity ?? 0)]));
  const items = resources.map((resource) => ({ id: resource.id, name: resource.name, label: `${resource.name} — stock ${(stockOf.get(resource.id) ?? 0).toLocaleString("fr-FR")}` }));
  const labelById = new Map(items.map((item) => [item.id, item.label]));
  const categories = [...new Set([...existingRecipes.map((recipe) => recipe.category), ...DEFAULT_CATEGORIES])].sort((a, b) => a.localeCompare(b));
  const difficulties = [...new Set([...existingRecipes.map((recipe) => recipe.difficulty), ...DEFAULT_DIFFICULTIES])].sort((a, b) => a.localeCompare(b));
  const codes = [...new Set(existingRecipes.map((recipe) => recipe.code))];
  const seed = (rows: Array<{ resourceId: string; quantity: unknown }>): RecipeRowSeed[] => rows.map((row) => ({ text: labelById.get(row.resourceId) ?? "", quantity: String(Number(row.quantity)) }));
  const initialIngredients = base ? seed(base.ingredients) : [];
  const initialOutput = base?.outputs[0] ? seed([base.outputs[0]])[0] : undefined;
  return <div className="page-wrap">
    <PageHeader eyebrow="Ateliers de Suna" title={base ? `Nouvelle version — ${base.name}` : "Nouvelle recette"}
      description={base ? `Tout est prérempli depuis la v${base.version} : modifiez ce qui change, l’ancienne version sera désactivée, jamais supprimée.` : "Le code est généré automatiquement. Pour faire évoluer une recette existante, passez par « Nouvelle version » depuis sa carte."}
      actions={<Link className="button button-ghost" href="/crafting"><ArrowLeft size={17} /> Recettes</Link>} />
    {error && <p className="notice error" role="alert">{error}</p>}
    {demoMode ? <p className="notice" role="status">Mode démonstration : les écritures sont désactivées.</p> : <section className="panel" style={{ maxWidth: 720 }}>
      <SectionHeader title="Définition" description="Seuls le nom, la catégorie, la difficulté, la durée, le coût et au moins un ingrédient sont nécessaires" />
      <form action={createRecipe} className="form-grid">
        <datalist id="categories-atelier">{categories.map((category) => <option key={category} value={category} />)}</datalist>
        <datalist id="difficultes-atelier">{difficulties.map((difficulty) => <option key={difficulty} value={difficulty} />)}</datalist>
        <datalist id="codes-recettes">{codes.map((code) => <option key={code} value={code} />)}</datalist>
        <div className="form-row">
          <label>Nom *<input type="text" name="name" required maxLength={120} defaultValue={base?.name ?? ""} placeholder="Bague T2, Kit de soin du désert…" /></label>
          <label>Code (facultatif — laissez vide pour le générer)<input type="text" name="code" list="codes-recettes" defaultValue={base?.code ?? ""} placeholder="Généré automatiquement" autoComplete="off" /></label>
        </div>
        <div className="form-row">
          <label>Catégorie *<input type="text" name="category" required maxLength={60} list="categories-atelier" defaultValue={base?.category ?? ""} placeholder="Choisissez ou saisissez…" autoComplete="off" /></label>
          <label>Difficulté *<input type="text" name="difficulty" required maxLength={40} list="difficultes-atelier" defaultValue={base?.difficulty ?? ""} placeholder="Novice, Confirmé…" autoComplete="off" /></label>
        </div>
        <div className="form-row">
          <label>Durée RP (minutes — 60 = 1 h RP)<input type="number" name="durationRpMinutes" required min={1} defaultValue={base?.durationRpMinutes ?? ""} placeholder="90" /></label>
          <label>Coût de fabrication (Ryō)<input type="number" name="cost" required min={0} defaultValue={base ? Number(base.cost) : ""} placeholder="0 si gratuit" /></label>
        </div>
        <label>Grade minimal<select name="minimumGradeCode" defaultValue={base?.minimumGradeCode ?? ""}><option value="">Aucun</option>{grades.map((grade) => <option key={grade.id} value={grade.code}>{grade.label}</option>)}</select></label>
        <label>Description<textarea name="description" maxLength={1000} defaultValue={base?.description ?? ""} placeholder="Facultative — visible par les artisans" /></label>
        <RecipeItems resources={items} initialIngredients={initialIngredients} {...(initialOutput ? { initialOutput } : {})} />
        <div className="form-actions"><button className="button button-primary" type="submit"><BookPlus size={16} /> {base ? `Publier la v${base.version + 1}` : "Créer la recette"}</button></div>
      </form>
    </section>}
  </div>;
}
