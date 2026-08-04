import { BookOpen, Clock3, Hammer, Layers3 } from "lucide-react";
import { MoneyDisplay, StatusBadge } from "@koeki/ui";
import { ModulePage } from "@/components/module-page";

const recipes = [
  ["REC-ARM-014", "Plaque d’avant-bras renforcée", "Armurerie", "Chunin", 6800, 7, "3 h RP"],
  ["REC-OUT-006", "Trousse d’outils de terrain", "Outillage", "Genin confirmé", 2400, 18, "90 min RP"],
  ["REC-MED-021", "Kit de soin du désert", "Médecine", "Chunin", 3100, 4, "2 h RP"]
] as const;

export default function CraftingPage() {
  return <ModulePage eyebrow="Ateliers de Suna" title="Artisanat" description="Recettes versionnées, disponibilité calculée et consommations confirmées." actionLabel="Nouvelle recette" metrics={[
    { label: "Recettes actives", value: "31", detail: "7 catégories" },
    { label: "Fabricables", value: "19", detail: "Avec le stock actuel", tone: "good" },
    { label: "Ressources limitantes", value: "3", detail: "Voir l’inventaire", tone: "warn" },
    { label: "Exécutions ce cycle", value: "12", detail: "Aucune anomalie" }
  ]}><div className="recipe-grid">{recipes.map((recipe) => <article className="recipe-card" key={recipe[0]}><header><span><BookOpen size={18}/></span><StatusBadge status={recipe[5] > 5 ? "paid" : "warning"}>{recipe[5]} fabricables</StatusBadge></header><code>{recipe[0]}</code><h3>{recipe[1]}</h3><p>{recipe[2]} · Grade minimal {recipe[3]}</p><footer><span><Clock3 size={14}/>{recipe[6]}</span><span><Hammer size={14}/><MoneyDisplay amount={recipe[4]} /></span><span><Layers3 size={14}/>v3</span></footer></article>)}</div></ModulePage>;
}
