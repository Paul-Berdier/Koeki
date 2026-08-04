import { MoneyDisplay } from "@koeki/ui";
import { ModulePage } from "@/components/module-page";

export default function InventoryPage() {
  return <ModulePage eyebrow="Stocks traçables" title="Inventaire" description="Chaque variation est expliquée par un mouvement immuable et audité." actionLabel="Ajustement contrôlé" metrics={[
    { label: "Valeur estimée", value: <MoneyDisplay amount={418200} />, detail: "Au dernier prix connu" },
    { label: "Mouvements aujourd’hui", value: "18", detail: "12 entrées · 6 sorties" },
    { label: "Stocks critiques", value: "3", detail: "Action nécessaire", tone: "danger" },
    { label: "Écart physique", value: "0", detail: "Dernier contrôle conforme", tone: "good" }
  ]}><div className="inventory-board"><div className="stock-card critical"><span>Critique</span><strong>Tissu renforcé</strong><b>9 m</b><small>Seuil critique : 12 m</small></div><div className="stock-card warning"><span>Bas</span><strong>Bois d’aulne</strong><b>14 pl.</b><small>Seuil bas : 20 planches</small></div><div className="stock-card critical"><span>Critique</span><strong>Sable siliceux</strong><b>4 sacs</b><small>Seuil critique : 8 sacs</small></div></div></ModulePage>;
}
