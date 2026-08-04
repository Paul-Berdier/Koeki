import { ScrollText } from "lucide-react";
import { PageHeader, StatusBadge } from "@koeki/ui";

const rows = [
  ["04 août · 13:18", "Sonemi Hakumei", "PAYMENT_CREATED", "PAY-2026-000184", "Paiement de 15 000 Ryō enregistré"],
  ["04 août · 12:54", "Kaemon Tori", "BUYBACK_VALIDATED", "BUY-2026-000067", "Rachat validé après recalcul serveur"],
  ["04 août · 11:42", "Sonemi Hakumei", "TAX_ADJUSTED", "ADJ-2026-000012", "Remise partielle — erreur administrative"],
  ["04 août · 10:03", "Système", "INVENTORY_ALERT", "RES-TIS-03", "Seuil critique atteint"]
] as const;

export default function AuditPage() {
  return <div className="page-wrap"><PageHeader eyebrow="Journal immuable" title="Registre d’audit" description="Traçabilité des accès, décisions financières et changements de configuration." actions={<button className="button button-ghost"><ScrollText size={17}/> Exporter selon mes droits</button>} /><section className="panel"><div className="table-scroll"><table><thead><tr><th>Date UTC</th><th>Auteur</th><th>Action</th><th>Entité</th><th>Résumé</th><th>Intégrité</th></tr></thead><tbody>{rows.map((row) => <tr key={row[3]}>{row.map((cell, index) => <td key={cell}>{index === 2 || index === 3 ? <code>{cell}</code> : index === 1 ? <strong>{cell}</strong> : cell}</td>)}<td><StatusBadge status="paid">Scellé</StatusBadge></td></tr>)}</tbody></table></div></section></div>;
}
