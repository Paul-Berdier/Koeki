"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

interface DonatableItem { id: string; name: string; label: string; rate: number }
interface Row { text: string; quantity: string }

const formatRyo = (value: number) => new Intl.NumberFormat("fr-FR").format(value);
const normalize = (value: string) => value.trim().toLowerCase();

export function SettlementItems({ resources, taxCoverageBps }: { resources: DonatableItem[]; taxCoverageBps: number }) {
  const [ryo, setRyo] = useState("0");
  const [rows, setRows] = useState<Row[]>([{ text: "", quantity: "" }]);
  const resolve = (text: string) => {
    const query = normalize(text);
    if (!query) return null;
    return resources.find((resource) => normalize(resource.label) === query) ?? resources.find((resource) => normalize(resource.name) === query) ?? null;
  };
  const objectsTotal = rows.reduce((total, row) => total + (Number.parseInt(row.quantity, 10) || 0) * (resolve(row.text)?.rate ?? 0), 0);
  const update = (index: number, patch: Partial<Row>) => setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return <>
    <label>Ryō reçus<input type="number" name="amount" min={0} step={1} value={ryo} onChange={(event) => setRyo(event.target.value)} /></label>
    {taxCoverageBps > 0 ? <fieldset>
      <legend>Objets donnés — le crédit peut couvrir au maximum {(taxCoverageBps / 100).toLocaleString("fr-FR")} % de chaque taxe</legend>
      <datalist id="objets-registre">{resources.map((resource) => <option key={resource.id} value={resource.label} />)}</datalist>
      {rows.map((row, index) => {
        const matched = resolve(row.text);
        return <div key={index} className="item-row">
          <label>Objet {index + 1}{row.text && !matched && <small style={{ color: "var(--terracotta-300)", textTransform: "none", letterSpacing: "normal" }}> — choisissez une proposition</small>}
            <input list="objets-registre" value={row.text} placeholder="Fer, Bague T4, Plan…" autoComplete="off" onChange={(event) => update(index, { text: event.target.value })} />
            <input type="hidden" name={`resourceId_${index + 1}`} value={matched?.id ?? ""} />
          </label>
          <label>Quantité<input type="number" name={`quantity_${index + 1}`} min={0} step={1} value={row.quantity} onChange={(event) => update(index, { quantity: event.target.value })} /></label>
          <button type="button" className="button button-ghost" aria-label={`Retirer l’objet ${index + 1}`} disabled={rows.length === 1 && !row.text && !row.quantity} onClick={() => (rows.length === 1 ? setRows([{ text: "", quantity: "" }]) : setRows(rows.filter((_, i) => i !== index)))}><X size={14} /></button>
        </div>;
      })}
      <div className="form-actions"><button type="button" className="button button-ghost" onClick={() => setRows([...rows, { text: "", quantity: "" }])}><Plus size={14} /> Ajouter un objet</button></div>
    </fieldset> : <p className="notice" role="status" style={{ margin: 0 }}>Les objets ne peuvent pas régler une taxe tant que l’application du crédit d’exonération est à 0 %. Enregistrez les dons depuis la page Dons : leur crédit restera conservé sur le dossier.</p>}
    <p className="notice" role="status" style={{ margin: 0 }} aria-live="polite">Ryō reçus : <strong>{formatRyo(Number.parseInt(ryo, 10) || 0)} ¥</strong>{taxCoverageBps > 0 && <> · Crédit nominal ajouté par les objets : <strong>{formatRyo(objectsTotal)} ¥</strong> · Son utilisation réelle est plafonnée à <strong>{(taxCoverageBps / 100).toLocaleString("fr-FR")} %</strong> du montant brut de chaque semaine cochée.</>}</p>
  </>;
}
