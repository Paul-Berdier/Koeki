import Link from "next/link";
import { EmptyState } from "@koeki/ui";
import { formatQuantity } from "@koeki/domain/inventory";
import type { ActionState, MovementRow } from "@/lib/inventory-types";
import { ReverseForm } from "./reverse-form";

type FormAction = (previous: ActionState, formData: FormData) => Promise<ActionState>;

/** Journal table shared by the global journal and the resource history. Server component:
 *  only the correction form is interactive. */
export function MovementTable({ rows, showResource, reverseAction, canOverride }: { rows: MovementRow[]; showResource: boolean; reverseAction: FormAction; canOverride: boolean }) {
  if (!rows.length) return <EmptyState title="Aucun mouvement" description="Les entrées, sorties, dons, rachats, fabrications, comptages et corrections apparaîtront ici." />;
  return <div className="table-scroll"><table className="journal-table">
    <thead><tr>
      <th scope="col">Date</th>
      {showResource && <th scope="col">Ressource</th>}
      <th scope="col" className="num">Mouvement</th>
      <th scope="col" className="num">Avant → après</th>
      <th scope="col">Donné / pris par</th>
      <th scope="col">Agent</th>
      <th scope="col">Type</th>
      <th scope="col">Motif</th>
      <th scope="col">Source</th>
      <th scope="col"><span className="sr-only">Correction</span></th>
    </tr></thead>
    <tbody>{rows.map((row) => <tr key={row.id} className={row.reversalId ? "is-reversed" : row.type === "REVERSAL" ? "is-reversal" : ""}>
      <td className="journal-date">{row.atLabel}</td>
      {showResource && <td><Link className="ninja-record-link" href={`/inventory/${row.resourceId}`}><strong>{row.resourceName}</strong></Link><br /><small className="muted"><code>{row.resourceCode}</code></small></td>}
      <td className={`num ${row.quantity < 0 ? "negative" : "positive"}`}><strong>{row.quantity < 0 ? "−" : "+"}{formatQuantity(Math.abs(row.quantity), row.unit.decimals)}</strong> <small>{row.unit.label}</small></td>
      <td className="num muted">{row.before === null || row.after === null ? "—" : `${formatQuantity(row.before, row.unit.decimals)} → ${formatQuantity(row.after, row.unit.decimals)}`}</td>
      <td>{row.counterpartyLabel ? <><small className="muted">{row.counterpartyRole}</small><br />{row.counterpartyNinjaId ? <Link className="ninja-record-link" href={`/ninjas/${row.counterpartyNinjaId}`}><strong>{row.counterpartyLabel}</strong></Link> : <strong>{row.counterpartyLabel}</strong>}</> : <span className="muted">—</span>}</td>
      <td>{row.agent}</td>
      <td>{row.typeLabel}</td>
      <td className="journal-reason" title={row.notes ?? undefined}>{row.reason}{row.notes && <><br /><small className="muted">{row.notes}</small></>}</td>
      <td className="muted">{row.sourceLabel}{row.reversedMovementId && <><br /><small>annule un mouvement</small></>}{row.reversalId && <><br /><small className="negative">annulé</small></>}</td>
      <td className="journal-actions">{row.canReverse && <ReverseForm movementId={row.id} label={`${row.resourceName} ${row.quantity}`} action={reverseAction} canOverride={canOverride} />}</td>
    </tr>)}</tbody>
  </table></div>;
}
