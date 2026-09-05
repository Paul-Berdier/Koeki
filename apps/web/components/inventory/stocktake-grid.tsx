"use client";

import { useDeferredValue, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ClipboardCheck, Search } from "lucide-react";
import { formatQuantity, normalizeSearch, parseQuantityInput, subtractQuantities } from "@koeki/domain/inventory";
import type { StocktakeCandidate } from "@/lib/inventory-types";

/** Spreadsheet-like count entry: one input per resource, Enter moves to the next line, the
 *  differences against the ledger are previewed live. Submission opens a review session —
 *  nothing moves before the explicit confirmation. */
export function StocktakeGrid({ candidates, mode, action }: { candidates: StocktakeCandidate[]; mode: "initial" | "count"; action: (formData: FormData) => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const deferredQuery = useDeferredValue(query);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const visible = useMemo(() => {
    const needle = normalizeSearch(deferredQuery);
    return needle ? candidates.filter((row) => normalizeSearch(`${row.name} ${row.code} ${row.categoryLabel} ${row.aliases.join(" ")}`).includes(needle)) : candidates;
  }, [candidates, deferredQuery]);
  const summary = useMemo(() => {
    let filled = 0, differences = 0, invalid = 0;
    for (const row of candidates) {
      const raw = values[row.id]?.trim();
      if (!raw) continue;
      const parsed = parseQuantityInput(raw, row.unit.decimals, row.unit.label);
      if (!parsed.ok) { invalid++; continue; }
      filled++;
      if (row.inventoryStatus === "NOT_INVENTORIED" || subtractQuantities(parsed.value, row.quantity) !== 0) differences++;
    }
    return { filled, differences, invalid };
  }, [candidates, values]);
  const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const next = inputs.current.slice(index + 1).find(Boolean);
    next?.focus();
    next?.select();
  };

  return <form action={action} className="stocktake-form">
    <input type="hidden" name="mode" value={mode} />
    <div className="inventory-toolbar">
      <label className="search-field"><Search size={18} aria-hidden="true" /><span className="sr-only">Filtrer les ressources à compter</span>
        <input type="search" value={query} placeholder="Filtrer (les valeurs saisies sont conservées)" autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
      </label>
      <div className="stocktake-summary" aria-live="polite">
        <span><strong>{summary.filled}</strong> saisie{summary.filled > 1 ? "s" : ""}</span>
        <span><strong>{summary.differences}</strong> écart{summary.differences > 1 ? "s" : ""} prévu{summary.differences > 1 ? "s" : ""}</span>
        {summary.invalid > 0 && <span className="field-warn"><strong>{summary.invalid}</strong> valeur{summary.invalid > 1 ? "s" : ""} invalide{summary.invalid > 1 ? "s" : ""}</span>}
      </div>
    </div>
    <div className="inventory-table-wrap stocktake-wrap"><table className="inventory-table stocktake-table">
      <thead><tr><th scope="col">Ressource</th><th scope="col">Catégorie</th><th scope="col" className="num">Stock système</th><th scope="col" className="num count-col">Stock compté</th><th scope="col" className="num">Écart prévu</th></tr></thead>
      <tbody>{candidates.map((row, index) => {
        const hiddenByFilter = !visible.includes(row);
        const raw = values[row.id] ?? "";
        const parsed = raw.trim() ? parseQuantityInput(raw, row.unit.decimals, row.unit.label) : null;
        const difference = parsed?.ok ? subtractQuantities(parsed.value, row.quantity) : null;
        return <tr key={row.id} hidden={hiddenByFilter} className={parsed && !parsed.ok ? "has-error" : difference !== null && difference !== 0 ? "has-diff" : ""}>
          <th scope="row" data-col="name"><strong>{row.name}</strong><small><code>{row.code}</code>{row.inventoryStatus === "NOT_INVENTORIED" && " · jamais compté"}</small></th>
          <td data-col="category">{row.categoryLabel}</td>
          <td className="num" data-col="quantity">{row.hasMovements || row.inventoryStatus === "COUNTED" ? <>{formatQuantity(row.quantity, row.unit.decimals)} <small>{row.unit.label}</small></> : <span className="muted">—</span>}</td>
          <td className="num count-col" data-col="count"><div className="quantity-field compact">
            <input ref={(element) => { inputs.current[index] = element; }} name={`count_${row.id}`} inputMode="decimal" autoComplete="off" value={raw} placeholder={row.unit.decimals ? "0,0" : "0"}
              aria-label={`Stock compté de ${row.name} en ${row.unit.label}`} aria-invalid={parsed ? !parsed.ok : undefined}
              onChange={(event) => setValues((current) => ({ ...current, [row.id]: event.target.value }))} onKeyDown={onKeyDown(index)} />
            <span aria-hidden="true">{row.unit.label}</span>
          </div>{parsed && !parsed.ok && <small className="field-warn">{parsed.error}</small>}</td>
          <td className={`num ${difference === null ? "muted" : difference < 0 ? "negative" : difference > 0 ? "positive" : "muted"}`} data-col="difference">
            {difference === null ? "—" : row.inventoryStatus === "NOT_INVENTORIED" ? `solde initial ${formatQuantity(parsed!.ok ? parsed!.value : 0, row.unit.decimals)}` : difference === 0 ? "aucun" : `${difference > 0 ? "+" : "−"}${formatQuantity(Math.abs(difference), row.unit.decimals)}`}
          </td>
        </tr>;
      })}</tbody>
    </table></div>
    <div className="stocktake-footer">
      <label className="stocktake-notes">Note du comptage (facultatif)<input name="notes" maxLength={300} placeholder="Inventaire du 5 septembre, réserve nord…" /></label>
      <button type="submit" className="button button-primary" disabled={summary.filled === 0 || summary.invalid > 0}><ClipboardCheck size={16} aria-hidden="true" /> {mode === "initial" ? "Enregistrer l’inventaire" : "Vérifier les écarts"}</button>
    </div>
  </form>;
}
