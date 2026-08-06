"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

interface CraftableResource { id: string; name: string; label: string }
export interface RecipeRowSeed { text: string; quantity: string }

const MAX_INGREDIENTS = 8;
const normalize = (value: string) => value.trim().toLowerCase();
const warnStyle = { color: "var(--terracotta-300)", textTransform: "none", letterSpacing: "normal" } as const;

export function RecipeItems({ resources, initialIngredients, initialOutput }: { resources: CraftableResource[]; initialIngredients?: RecipeRowSeed[]; initialOutput?: RecipeRowSeed }) {
  const [rows, setRows] = useState<RecipeRowSeed[]>(initialIngredients?.length ? initialIngredients : [{ text: "", quantity: "" }]);
  const [output, setOutput] = useState<RecipeRowSeed>(initialOutput ?? { text: "", quantity: "" });
  const resolve = (text: string) => {
    const query = normalize(text);
    if (!query) return null;
    return resources.find((resource) => normalize(resource.label) === query) ?? resources.find((resource) => normalize(resource.name) === query) ?? null;
  };
  const update = (index: number, patch: Partial<RecipeRowSeed>) => setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return <>
    <datalist id="ressources-atelier">{resources.map((resource) => <option key={resource.id} value={resource.label} />)}</datalist>
    <fieldset>
      <legend>Ingrédients consommés — tapez pour chercher, le stock affiché est celui d’aujourd’hui</legend>
      {rows.map((row, index) => {
        const matched = resolve(row.text);
        return <div key={index} className="item-row">
          <label>Ingrédient {index + 1}{row.text && !matched && <small style={warnStyle}> — choisissez une proposition</small>}
            <input list="ressources-atelier" value={row.text} placeholder="Fer, Plan Bague T2…" autoComplete="off" onChange={(event) => update(index, { text: event.target.value })} />
            <input type="hidden" name={`ingredientId_${index + 1}`} value={matched?.id ?? ""} />
          </label>
          <label>Quantité<input type="number" name={`ingredientQty_${index + 1}`} min={0} step="0.01" value={row.quantity} onChange={(event) => update(index, { quantity: event.target.value })} /></label>
          <button type="button" className="button button-ghost" aria-label={`Retirer l’ingrédient ${index + 1}`} disabled={rows.length === 1 && !row.text && !row.quantity} onClick={() => (rows.length === 1 ? setRows([{ text: "", quantity: "" }]) : setRows(rows.filter((_, i) => i !== index)))}><X size={14} /></button>
        </div>;
      })}
      {rows.length < MAX_INGREDIENTS && <div className="form-actions"><button type="button" className="button button-ghost" onClick={() => setRows([...rows, { text: "", quantity: "" }])}><Plus size={14} /> Ajouter un ingrédient</button></div>}
    </fieldset>
    <fieldset>
      <legend>Production (facultatif) — l’objet fabriqué entre en stock</legend>
      <div className="item-row">
        <label>Objet produit{output.text && !resolve(output.text) && <small style={warnStyle}> — choisissez une proposition</small>}
          <input list="ressources-atelier" value={output.text} placeholder="Bague T2, Kit de soin…" autoComplete="off" onChange={(event) => setOutput({ ...output, text: event.target.value })} />
          <input type="hidden" name="outputId" value={resolve(output.text)?.id ?? ""} />
        </label>
        <label>Quantité produite<input type="number" name="outputQty" min={0} step="0.01" value={output.quantity} onChange={(event) => setOutput({ ...output, quantity: event.target.value })} /></label>
        <button type="button" className="button button-ghost" aria-label="Vider la production" disabled={!output.text && !output.quantity} onClick={() => setOutput({ text: "", quantity: "" })}><X size={14} /></button>
      </div>
    </fieldset>
  </>;
}
