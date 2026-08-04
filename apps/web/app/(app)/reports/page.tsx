import { StatusBadge } from "@koeki/ui";
import { ModulePage } from "@/components/module-page";

export default function ReportsPage() {
  return <ModulePage eyebrow="Suivi des agents" title="Rapports" description="Les chiffres d’activité sont préremplis depuis les écritures réelles." actionLabel="Nouveau rapport" metrics={[
    { label: "À examiner", value: "2", detail: "Soumis par les agents", tone: "warn" },
    { label: "Approuvés ce cycle", value: "6", detail: "100 % dans les délais", tone: "good" },
    { label: "Transactions couvertes", value: "84", detail: "347 500 Ryō traités" },
    { label: "Corrections", value: "3", detail: "Taux de 3,6 %" }
  ]}><div className="table-scroll"><table><thead><tr><th>Période</th><th>Agent</th><th>Paiements</th><th>Dons / rachats</th><th>Montant traité</th><th>Statut</th></tr></thead><tbody><tr><td>28 juil. — 3 août</td><td><strong>Kaemon Tori</strong></td><td>14</td><td>9</td><td>86 400 Ryō</td><td><StatusBadge status="pending">Soumis</StatusBadge></td></tr><tr><td>28 juil. — 3 août</td><td><strong>Sonemi Hakumei</strong></td><td>19</td><td>7</td><td>112 800 Ryō</td><td><StatusBadge status="pending">Soumis</StatusBadge></td></tr><tr><td>21 — 27 juillet</td><td><strong>Kaemon Tori</strong></td><td>17</td><td>8</td><td>94 200 Ryō</td><td><StatusBadge status="paid">Approuvé</StatusBadge></td></tr></tbody></table></div></ModulePage>;
}
