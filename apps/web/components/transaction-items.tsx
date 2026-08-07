"use client";

import { useState } from "react";
import { HandCoins, Plus, X } from "lucide-react";

interface NinjaOption { id: string; name: string; label: string }
interface ResourceOption { id: string; name: string; donLabel: string; buyLabel: string; points: number; rate: number; price: number; hasPrice: boolean }
interface Row { text: string; quantity: string }

const MAX_ROWS = 8;
const formatRyo = (value: number) => new Intl.NumberFormat("fr-FR").format(value);
const normalize = (value: string) => value.trim().toLowerCase();
const warnStyle = { color: "var(--terracotta-300)", textTransform: "none", letterSpacing: "normal" } as const;

export function TransactionItems({ ninjas, resources }: { ninjas: NinjaOption[]; resources: ResourceOption[] }) {
  const [type, setType] = useState<"DONATION" | "BUYBACK">("DONATION");
  const [ninjaText, setNinjaText] = useState("");
  const [rows, setRows] = useState<Row[]>([{ text: "", quantity: "" }]);
  const ninja = (() => {
    const query = normalize(ninjaText);
    if (!query) return null;
    return ninjas.find((entry) => normalize(entry.label) === query) ?? ninjas.find((entry) => normalize(entry.name) === query) ?? null;
  })();
  const resolve = (text: string) => {
    const query = normalize(text);
    if (!query) return null;
    return resources.find((resource) => normalize(resource.donLabel) === query)
      ?? resources.find((resource) => normalize(resource.buyLabel) === query)
      ?? resources.find((resource) => normalize(resource.name) === query) ?? null;
  };
  const update = (index: number, patch: Partial<Row>) => setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const matchedRows = rows.map((row) => ({ matched: resolve(row.text), quantity: Number.parseInt(row.quantity, 10) || 0 }));
  const totals = matchedRows.reduce((sum, row) => (row.matched ? {
    points: sum.points + row.quantity * row.matched.points,
    exemption: sum.exemption + row.quantity * row.matched.rate,
    payout: sum.payout + row.quantity * row.matched.price
  } : sum), { points: 0, exemption: 0, payout: 0 });
  const missingPrice = type === "BUYBACK" ? matchedRows.filter((row) => row.matched && row.quantity > 0 && !row.matched.hasPrice).map((row) => row.matched!.name) : [];

  return <>
    <datalist id="ninjas-registre">{ninjas.map((entry) => <option key={entry.id} value={entry.label} />)}</datalist>
    <datalist id="objets-don">{resources.map((resource) => <option key={resource.id} value={resource.donLabel} />)}</datalist>
    <datalist id="objets-rachat">{resources.map((resource) => <option key={resource.id} value={resource.buyLabel} />)}</datalist>
    <div className="form-row">
      <label>Type d’opération<select name="type" required value={type} onChange={(event) => setType(event.target.value === "BUYBACK" ? "BUYBACK" : "DONATION")}><option value="DONATION">Don (points + exonération)</option><option value="BUYBACK">Rachat (payé en Ryō)</option></select></label>
      <label>Ninja{ninjaText && !ninja && <small style={warnStyle}> — choisissez une proposition</small>}
        <input list="ninjas-registre" value={ninjaText} placeholder="Tapez un nom ou un code NIN-…" autoComplete="off" onChange={(event) => setNinjaText(event.target.value)} required />
        <input type="hidden" name="ninjaId" value={ninja?.id ?? ""} />
      </label>
    </div>
    <fieldset>
      <legend>{type === "BUYBACK" ? "Ressources rachetées — le prix actif s’affiche dans chaque proposition" : "Objets donnés — le barème points/exonération s’affiche dans chaque proposition"}</legend>
      {rows.map((row, index) => {
        const matched = resolve(row.text);
        return <div key={index} className="item-row">
          <label>Ressource {index + 1}{row.text && !matched && <small style={warnStyle}> — choisissez une proposition</small>}
            <input list={type === "BUYBACK" ? "objets-rachat" : "objets-don"} value={row.text} placeholder="Fer, Bague T4, Plan…" autoComplete="off" onChange={(event) => update(index, { text: event.target.value })} />
            <input type="hidden" name={`resourceId_${index + 1}`} value={matched?.id ?? ""} />
          </label>
          <label>Quantité<input type="number" name={`quantity_${index + 1}`} min={0} step={1} value={row.quantity} onChange={(event) => update(index, { quantity: event.target.value })} /></label>
          <button type="button" className="button button-ghost" aria-label={`Retirer la ressource ${index + 1}`} disabled={rows.length === 1 && !row.text && !row.quantity} onClick={() => (rows.length === 1 ? setRows([{ text: "", quantity: "" }]) : setRows(rows.filter((_, i) => i !== index)))}><X size={14} /></button>
        </div>;
      })}
      {rows.length < MAX_ROWS && <div className="form-actions"><button type="button" className="button button-ghost" onClick={() => setRows([...rows, { text: "", quantity: "" }])}><Plus size={14} /> Ajouter une ressource</button></div>}
    </fieldset>
    {missingPrice.length > 0 && <p className="notice error" role="alert">Sans prix actif : {missingPrice.join(", ")} — configurez le prix depuis le catalogue avant le rachat.</p>}
    <p className="notice" role="status" style={{ margin: 0 }} aria-live="polite">
      {type === "BUYBACK"
        ? <>Montant à payer au ninja : <strong>{formatRyo(totals.payout)} ¥</strong> — également crédité en exonération de taxe.</>
        : <>Le ninja gagnera <strong>{formatRyo(totals.points)} point{totals.points > 1 ? "s" : ""}</strong> et <strong>{formatRyo(totals.exemption)} ¥</strong> d’exonération — le crédit couvre immédiatement ses taxes ouvertes.</>}
    </p>
    <div className="form-actions"><button className="button button-primary" type="submit"><HandCoins size={16} /> {type === "BUYBACK" ? "Enregistrer le rachat" : "Enregistrer le don"}</button></div>
  </>;
}
