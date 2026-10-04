import Link from "next/link";
import { ArrowRight, BookOpen, Clock3, Hammer, Layers3 } from "lucide-react";
import { EmptyState, MoneyDisplay, StatusBadge } from "@koeki/ui";
import { CraftingFilters } from "@/components/crafting-filters";
import { ModulePage } from "@/components/module-page";
import { getCrafting } from "@/lib/data";
import { demoMode, hasPermission, requireSession } from "@/lib/session";
import { executeCraft } from "./actions";

export default async function CraftingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const query = await searchParams;
  const data = await getCrafting({
    q: typeof query.q === "string" ? query.q : undefined,
    categorie:
      typeof query.categorie === "string" && query.categorie
        ? query.categorie
        : undefined,
  });
  const canCraft = !demoMode && hasPermission(session, "inventory:write");
  const canManage = !demoMode && hasPermission(session, "settings:manage");
  const crafted = typeof query.fabrique === "string" ? query.fabrique : null;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const isFiltered = Boolean(query.q || query.categorie);
  return (
    <ModulePage
      eyebrow="Ateliers"
      title="Artisanat"
      description="Choisissez une recette, vérifiez les ingrédients et lancez la fabrication."
      actionLabel={canManage ? "Nouvelle recette" : undefined}
      actionHref="/crafting/new"
      metrics={[
        {
          label: "Recettes actives",
          value: String(data.metrics.activeCount),
          detail: `${data.metrics.categoryCount} catégorie${data.metrics.categoryCount > 1 ? "s" : ""}`,
        },
        {
          label: "Fabricables",
          value: String(data.metrics.craftableCount),
          detail: "Avec le stock actuel",
          tone: "good",
        },
        {
          label: "Bloquées",
          value: String(data.metrics.limitedCount),
          detail: data.metrics.limitedCount
            ? "Ressource limitante épuisée"
            : "Aucune recette bloquée",
          tone: data.metrics.limitedCount ? "warn" : "good",
        },
        {
          label: "Fabrications",
          value: String(data.metrics.executions),
          detail: "Total confirmé et audité",
        },
      ]}
    >
      {crafted && (
        <p className="notice" role="status" style={{ margin: "12px 18px 0" }}>
          Fabrication confirmée : <code>{crafted}</code> — mouvements de stock
          enregistrés.
        </p>
      )}
      {error && (
        <p
          className="notice error"
          role="alert"
          style={{ margin: "12px 18px 0" }}
        >
          {error}
        </p>
      )}
      <CraftingFilters categories={data.categories} names={data.names} />
      {data.recipes.length ? (
        <div className="recipe-grid">
          {data.recipes.map((recipe) => (
            <article
              className="recipe-card"
              key={recipe.id}
              aria-labelledby={`recipe-${recipe.id}`}
            >
              <header>
                <span>
                  <BookOpen size={18} aria-hidden="true" />
                </span>
                <StatusBadge
                  status={
                    recipe.craftable > 5
                      ? "paid"
                      : recipe.craftable > 0
                        ? "warning"
                        : "overdue"
                  }
                >
                  {recipe.craftable} fabricable{recipe.craftable > 1 ? "s" : ""}
                </StatusBadge>
              </header>
              <h2 id={`recipe-${recipe.id}`}>{recipe.name}</h2>
              <p>
                {recipe.category}
                {recipe.minimumGrade
                  ? ` · Grade minimal ${recipe.minimumGrade}`
                  : ""}
              </p>
              <p className="recipe-ingredients">
                {recipe.ingredients.length
                  ? recipe.ingredients
                      .map(
                        (ingredient) =>
                          `${ingredient.quantity.toLocaleString("fr-FR")}× ${ingredient.name}`,
                      )
                      .join(" · ")
                  : "Aucun ingrédient défini"}
              </p>
              {recipe.output && (
                <p className="recipe-output">
                  <strong>Résultat</strong> {recipe.output}
                </p>
              )}
              <footer>
                <span>
                  <Clock3 size={14} aria-hidden="true" />
                  {recipe.duration}
                </span>
                <span>
                  <Hammer size={14} aria-hidden="true" />
                  <MoneyDisplay amount={recipe.cost} />
                </span>
                <span title={recipe.code}>
                  <Layers3 size={14} aria-hidden="true" />v{recipe.version}
                </span>
              </footer>
              {canCraft && recipe.craftable > 0 && (
                <form action={executeCraft} className="recipe-craft-form">
                  <input type="hidden" name="recipeId" value={recipe.id} />
                  <input
                    type="hidden"
                    name="idempotencyKey"
                    value={crypto.randomUUID()}
                  />
                  <label>
                    Quantité
                    <input
                      aria-label={`Quantité de ${recipe.name}`}
                      type="number"
                      name="quantity"
                      min={1}
                      max={recipe.craftable}
                      defaultValue={1}
                    />
                  </label>
                  <button className="button button-primary" type="submit">
                    Fabriquer
                  </button>
                </form>
              )}
              {canManage && (
                <Link
                  className="text-link"
                  href={`/crafting/new?base=${recipe.id}`}
                >
                  Nouvelle version <ArrowRight size={13} aria-hidden="true" />
                </Link>
              )}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title={
            isFiltered
              ? "Aucune recette ne correspond"
              : "Aucune recette active"
          }
          description={
            isFiltered
              ? "Essayez un autre nom, code ou ingrédient, ou réinitialisez les filtres."
              : "Créez une première recette pour ouvrir les ateliers."
          }
        />
      )}
    </ModulePage>
  );
}
