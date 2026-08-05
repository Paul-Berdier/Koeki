"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

interface DonatableItem { id: string; label: string; rate: number }
interface Row { resourceId: string; quantity: string }

const formatRyo = (value: number) => new Intl.NumberFormat("fr-FR").format(value);

export function SettlementItems({ resources }: { resources: DonatableItem[] }) {
  const [ryo, setRyo] = useState("0");
  const [rows, setRows] = useState<Row[]>([{ resourceId: "", quantity: "" }]);
  const rateOf = (id: string) => resources.find((resource) => resource.id === id)?.rate ?? 0;
  const objectsTotal = rows.reduce((total, row) => total + (Number.parseInt(row.quantity, 10) || 0) * rateOf(row.resourceId), 0);
  const grandTotal = objectsTotal + (Number.parseInt(ryo, 10) || 0);
  const update = (index: number, patch: Partial<Row>) => setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return <>
    <label>Ryō reçus<input type="number" name="amount" min={0} step={1} value={ryo} onChange={(event) => setRyo(event.target.value)} /></label>
    <fieldset>
      <legend>Objets donnés (couverture selon le barème de la base)</legend>
      {rows.map((row, index) => <div key={index} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 110px auto", gap: 12, alignItems: "end" }}>
        <label>Objet {index + 1}<select name={`resourceId_${index + 1}`} value={row.resourceId} onChange={(event) => update(index, { resourceId: event.target.value })}><option value="">—</option>{resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.label}</option>)}</select></label>
        <label>Quantité<input type="number" name={`quantity_${index + 1}`} min={0} step={1} value={row.quantity} onChange={(event) => update(index, { quantity: event.target.value })} /></label>
        <button type="button" className="button button-ghost" aria-label={`Retirer l’objet ${index + 1}`} style={{ minHeight: 38 }} disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, i) => i !== index))}><X size={14} /></button>
      </div>)}
      <div className="form-actions" style={{ marginTop: 4 }}><button type="button" className="button button-ghost" onClick={() => setRows([...rows, { resourceId: "", quantity: "" }])}><Plus size={14} /> Ajouter un objet</button></div>
    </fieldset>
    <p className="notice" role="status" style={{ margin: 0 }} aria-live="polite">Objets donnés : <strong>{formatRyo(objectsTotal)} ¥</strong> · Couverture totale (Ryō + objets) : <strong>{formatRyo(grandTotal)} ¥</strong></p>
  </>;
}
