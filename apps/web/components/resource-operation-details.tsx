import Link from "next/link";
import { MoneyDisplay } from "@koeki/ui";
import { formatRecordedQuantity, type ResourceDetails } from "@/lib/team-resource-journal";

export function ResourceOperationItems({ details }: { details: ResourceDetails | undefined }) {
  if (!details?.items.length) return <p className="muted">Détail des objets indisponible dans cet historique. Le montant seul ne permet pas de le reconstituer.</p>;
  return <div>
    <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
      {details.items.map((item) => <li key={item.id} style={{ marginBottom: 8 }}>
        <strong>{formatRecordedQuantity(item.quantity)} × {item.name}</strong>
        <small className="cell-detail">{item.code} · unité : {item.unit}</small>
      </li>)}
    </ul>
    <details><summary>Valeurs enregistrées par objet</summary>
      <ul style={{ paddingLeft: "1.1rem" }}>{details.items.map((item) => <li key={item.id}>
        {item.name} : valeur unitaire <MoneyDisplay amount={item.unitPrice} /> · total de la ligne <MoneyDisplay amount={item.lineTotal} />
      </li>)}</ul>
      <p className="field-help">Quantités et valeurs conservées lors de l’opération, sans recalcul au tarif actuel. Les noms et unités proviennent du catalogue.</p>
    </details>
  </div>;
}

export function ResourceStockEffects({ details }: { details: ResourceDetails | undefined }) {
  if (!details?.movements.length) return <small className="cell-detail">Aucun mouvement de stock lié documenté.</small>;
  return <details><summary>Mouvements de stock liés ({details.movements.length})</summary>
    <ul style={{ paddingLeft: "1.1rem" }}>{details.movements.map((movement) => <li key={movement.id}>
      <strong>{movement.quantity.startsWith("-") ? "Sortie" : movement.quantity === "0" ? "Sans variation" : "Entrée"} : {formatRecordedQuantity(movement.quantity)} × {movement.name}</strong>
      <small className="cell-detail">{movement.at.toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}{movement.type === "REVERSAL" ? " · contre-écriture" : ""}</small>
    </li>)}</ul>
    <p className="field-help">Les corrections restent visibles, même après la période de l’opération. Un rachat est une entrée de ressources, pas une sortie d’objets.</p>
    <Link href="/inventory/movements" className="text-link">Consulter toutes les entrées et sorties de stock</Link>
  </details>;
}

export function ResourceOperationValue({ type, amount }: { type: "DONATION" | "BUYBACK" | "PAYMENT"; amount: bigint }) {
  return <><small className="cell-detail">{type === "DONATION" ? "Équivalent du don" : type === "BUYBACK" ? "Montant du rachat" : "Paiement en Ryō"}</small>
    <MoneyDisplay amount={amount} />
    {type === "DONATION" && <small className="cell-detail">Valorisation, pas un encaissement en Ryō.</small>}
    {type === "BUYBACK" && <small className="cell-detail">Coût des ressources achetées.</small>}
  </>;
}
