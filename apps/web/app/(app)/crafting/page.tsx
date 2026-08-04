import { BookOpen, Clock3, Hammer, Layers3 } from "lucide-react";
import { EmptyState, MoneyDisplay, StatusBadge } from "@koeki/ui";
import { ModulePage } from "@/components/module-page";
import { getCrafting } from "@/lib/data";
import { demoMode, hasPermission, requireSession } from "@/lib/session";
import { executeCraft } from "./actions";

export default async function CraftingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const query = await searchParams;
  const data = await getCrafting();
  const canCraft = !demoMode && hasPermission(session, "inventory:write");
  const canManage = !demoMode && hasPermission(session, "settings:manage");
  const crafted = typeof query.fabrique === "string" ? query.fabrique : null;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  return <ModulePage eyebrow="Ateliers de Suna" title="Artisanat" description="Recettes versionnées, disponibilité calculée depuis le stock réel, consommations confirmées."
    actionLabel={canManage ? "Nouvelle recette" : undefined} actionHref="/crafting/new" registerTitle="Recettes actives" registerDescription="Le calculateur n’engage jamais le stock : seule la fabrication confirmée le consomme" metrics={[
    { label: "Recettes actives", value: String(data.metrics.activeCount), detail: `${data.metrics.categoryCount} catégorie${data.metrics.categoryCount > 1 ? "s" : ""}` },
    { label: "Fabricables", value: String(data.metrics.craftableCount), detail: "Avec le stock actuel", tone: "good" },
    { label: "Bloquées", value: String(data.metrics.limitedCount), detail: data.metrics.limitedCount ? "Ressource limitante épuisée" : "Aucune recette bloquée", tone: data.metrics.limitedCount ? "warn" : "good" },
    { label: "Fabrications", value: String(data.metrics.executions), detail: "Total confirmé et audité" }
  ]}>
    {crafted && <p className="notice" role="status" style={{ margin: "12px 18px 0" }}>Fabrication confirmée : <code>{crafted}</code> — mouvements de stock enregistrés.</p>}
    {error && <p className="notice error" role="alert" style={{ margin: "12px 18px 0" }}>{error}</p>}
    {data.recipes.length ? <div className="recipe-grid">{data.recipes.map((recipe) => <article className="recipe-card" key={recipe.id}>
      <header><span><BookOpen size={18}/></span><StatusBadge status={recipe.craftable > 5 ? "paid" : recipe.craftable > 0 ? "warning" : "overdue"}>{recipe.craftable} fabricable{recipe.craftable > 1 ? "s" : ""}</StatusBadge></header>
      <code>{recipe.code}</code><h3>{recipe.name}</h3><p>{recipe.category}{recipe.minimumGrade ? ` · Grade minimal ${recipe.minimumGrade}` : ""}</p>
      <footer><span><Clock3 size={14}/>{recipe.duration}</span><span><Hammer size={14}/><MoneyDisplay amount={recipe.cost} /></span><span><Layers3 size={14}/>v{recipe.version}</span></footer>
      {canCraft && recipe.craftable > 0 && <form action={executeCraft} style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input type="hidden" name="recipeId" value={recipe.id} />
        <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--sand-500)" }}>×<input type="number" name="quantity" min={1} max={recipe.craftable} defaultValue={1} style={{ width: 64, minHeight: 32, border: "1px solid var(--border-strong)", borderRadius: 4, background: "rgba(0,0,0,.12)", color: "inherit", padding: "4px 8px" }} /></label>
        <button className="button button-ghost" type="submit" style={{ minHeight: 32 }}>Fabriquer</button>
      </form>}
    </article>)}</div>
      : <EmptyState title="Aucune recette active" description="Créez une première recette pour ouvrir les ateliers." />}
  </ModulePage>;
}
