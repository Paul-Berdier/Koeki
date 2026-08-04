import { MoneyDisplay, StatusBadge } from "@koeki/ui";
import { ModulePage } from "@/components/module-page";

const resources = [
  ["RES-CUI-01", "Minerai de cuivre", "Minerais", 180, "kg", 82, "paid"],
  ["RES-TIS-03", "Tissu renforcé", "Textiles", 320, "m", 9, "overdue"],
  ["RES-BOI-02", "Bois d’aulne", "Bois", 95, "planche", 14, "warning"],
  ["RES-HER-08", "Herbe du désert", "Herboristerie", 60, "botte", 143, "paid"]
] as const;

export default function ResourcesPage() {
  return <ModulePage eyebrow="Catalogue et tarification" title="Ressources" description="Prix publics historisés, unités contrôlées et disponibilité du village." actionLabel="Nouvelle transaction" metrics={[
    { label: "Rachats ce cycle", value: <MoneyDisplay amount={67400} />, detail: "23 opérations" },
    { label: "Dons reçus", value: <MoneyDisplay amount={22400} />, detail: "Valeur estimée", tone: "good" },
    { label: "Prix à revoir", value: "5", detail: "Plus de 3 cycles", tone: "warn" },
    { label: "Catalogue", value: "48", detail: "42 ressources actives" }
  ]}><div className="table-scroll"><table><thead><tr><th>Code</th><th>Ressource</th><th>Catégorie</th><th>Prix unitaire</th><th>Stock</th><th>Disponibilité</th></tr></thead><tbody>{resources.map((resource) => <tr key={resource[0]}><td><code>{resource[0]}</code></td><td><strong>{resource[1]}</strong></td><td>{resource[2]}</td><td><MoneyDisplay amount={resource[3]} /></td><td>{resource[5]} {resource[4]}</td><td><StatusBadge status={resource[6]}>{resource[6] === "paid" ? "Disponible" : resource[6] === "overdue" ? "Critique" : "Stock bas"}</StatusBadge></td></tr>)}</tbody></table></div></ModulePage>;
}
