import { MoneyDisplay, StatusBadge } from "@koeki/ui";
import { ModulePage } from "@/components/module-page";
import { ninjas } from "@/lib/demo-data";

export default function RecoveryPage() {
  const overdue = ninjas.filter((ninja) => ninja.status === "overdue");
  return <ModulePage eyebrow="File de suivi" title="Recouvrement" description="Dossiers à relancer, classés par ancienneté et exposition." actionLabel="Créer une relance" metrics={[
    { label: "Dette prioritaire", value: <MoneyDisplay amount={115000} />, detail: "3 dossiers critiques", tone: "danger" },
    { label: "Retard moyen", value: "2,7 ans RP", detail: "Sur les dossiers ouverts", tone: "warn" },
    { label: "Promesses actives", value: "4", detail: "58 000 Ryō attendus", tone: "good" },
    { label: "Sans agent", value: "2", detail: "À attribuer aujourd’hui" }
  ]}><div className="table-scroll"><table><thead><tr><th>Priorité</th><th>Ninja</th><th>Dette</th><th>Ancienneté</th><th>Agent</th><th>État</th></tr></thead><tbody>{overdue.map((ninja, index) => <tr key={ninja.code}><td><strong>0{index + 1}</strong></td><td><strong>{ninja.name}</strong><br/><code>{ninja.code}</code></td><td className="negative"><MoneyDisplay amount={ninja.debt} /></td><td>{ninja.due}</td><td>{ninja.agent}</td><td><StatusBadge status="overdue">Relance requise</StatusBadge></td></tr>)}</tbody></table></div></ModulePage>;
}
