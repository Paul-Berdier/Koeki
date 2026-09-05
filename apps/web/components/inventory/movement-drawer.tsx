"use client";

import { useActionState, useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, SlidersHorizontal, X } from "lucide-react";
import { INVENTORY_IN_REASONS, INVENTORY_OUT_REASONS, addQuantities, formatQuantityWithUnit, normalizeSearch, parseQuantityInput } from "@koeki/domain/inventory";
import type { ActionState, InventoryRow, NinjaOption } from "@/lib/inventory-types";

export type DrawerMode = "in" | "out" | "adjust";
type FormAction = (previous: ActionState, formData: FormData) => Promise<ActionState>;

/** Compact side panel used for entries, exits and manager adjustments. Server-validated
 *  through `useActionState`; the panel stays open on error and closes on success. */
export function MovementDrawer({ mode, resource, resources, ninjas, canAdjust, action, adjustmentAction, onClose, onSuccess }: {
  mode: DrawerMode; resource: InventoryRow | null; resources: InventoryRow[]; ninjas: NinjaOption[]; canAdjust: boolean;
  action: FormAction; adjustmentAction: FormAction; onClose: () => void; onSuccess: (message: string) => void;
}) {
  const [state, formAction, pending] = useActionState(mode === "adjust" ? adjustmentAction : action, null);
  const [resourceText, setResourceText] = useState(resource?.name ?? "");
  const [quantity, setQuantity] = useState("");
  const [sign, setSign] = useState<"+" | "-">("+");
  const [counterpartyMode, setCounterpartyMode] = useState<"ninja" | "external" | "none">(mode === "out" ? "ninja" : "none");
  const [ninjaText, setNinjaText] = useState("");
  const [reason, setReason] = useState("");
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);
  const titleId = useId();
  const listId = useId();
  const ninjaListId = useId();
  const firstField = useRef<HTMLInputElement>(null);
  const handledState = useRef<ActionState>(null);

  useEffect(() => { firstField.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    if (state?.ok && handledState.current !== state) { handledState.current = state; onSuccess(state.message); }
  }, [state, onSuccess]);

  const selected = resource ?? (() => {
    const needle = normalizeSearch(resourceText);
    if (!needle) return null;
    return resources.find((row) => normalizeSearch(`${row.name} · ${row.code}`) === needle) ?? resources.find((row) => normalizeSearch(row.name) === needle) ?? resources.find((row) => normalizeSearch(row.code) === needle) ?? null;
  })();
  const ninja = (() => {
    const needle = normalizeSearch(ninjaText);
    if (!needle) return null;
    return ninjas.find((entry) => normalizeSearch(`${entry.name} · ${entry.code}`) === needle) ?? ninjas.find((entry) => normalizeSearch(entry.name) === needle) ?? ninjas.find((entry) => normalizeSearch(entry.code) === needle) ?? null;
  })();
  const parsed = selected ? parseQuantityInput(quantity, selected.unit.decimals, selected.unit.label) : null;
  const delta = parsed?.ok ? (mode === "out" || (mode === "adjust" && sign === "-") ? -parsed.value : parsed.value) : 0;
  const next = selected ? addQuantities(selected.quantity, delta) : 0;
  const reasons = mode === "out" ? INVENTORY_OUT_REASONS : INVENTORY_IN_REASONS;
  const isOut = mode === "out" || (mode === "adjust" && sign === "-");
  const title = mode === "in" ? "Entrée de stock" : mode === "out" ? "Sortie de stock" : "Ajustement de stock";
  const Icon = mode === "in" ? ArrowDownToLine : mode === "out" ? ArrowUpFromLine : SlidersHorizontal;
  const submitLabel = parsed?.ok && selected ? (mode === "in" ? `Ajouter ${formatQuantityWithUnit(parsed.value, selected.unit)}` : mode === "out" ? `Retirer ${formatQuantityWithUnit(parsed.value, selected.unit)}` : `Ajuster de ${sign}${formatQuantityWithUnit(parsed.value, selected.unit)}`) : (mode === "in" ? "Ajouter" : mode === "out" ? "Retirer" : "Ajuster");
  const insufficient = selected !== null && isOut && next < 0 && selected.inventoryStatus === "COUNTED";

  return <div className="drawer-backdrop" onClick={onClose} role="presentation">
    <aside className={`drawer drawer-${mode}`} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}>
      <header className="drawer-header">
        <div><span className="drawer-kicker"><Icon size={14} aria-hidden="true" /> {mode === "adjust" ? "Responsable" : "Mouvement"}</span><h2 id={titleId}>{title}</h2>{selected && <p>{selected.name} <code>{selected.code}</code> · stock actuel <strong>{selected.hasMovements || selected.inventoryStatus === "COUNTED" ? formatQuantityWithUnit(selected.quantity, selected.unit) : "non inventorié"}</strong></p>}</div>
        <button type="button" className="drawer-close" onClick={onClose} aria-label="Fermer"><X size={18} /></button>
      </header>
      <form action={formAction} className="drawer-form">
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <input type="hidden" name="direction" value={mode === "out" ? "out" : "in"} />
        {mode === "adjust" && <input type="hidden" name="sign" value={sign} />}
        {resource ? <input type="hidden" name="resourceId" value={resource.id} /> : <label>Ressource *{resourceText && !selected && <small className="field-warn"> — choisissez une proposition</small>}
          <input ref={firstField} list={listId} value={resourceText} placeholder="Fer, Plan T2, RES-IRON…" autoComplete="off" required onChange={(event) => setResourceText(event.target.value)} />
          <datalist id={listId}>{resources.filter((row) => row.isActive).map((row) => <option key={row.id} value={`${row.name} · ${row.code}`} />)}</datalist>
          <input type="hidden" name="resourceId" value={selected?.id ?? ""} />
        </label>}
        {mode === "adjust" && <div className="segmented" role="group" aria-label="Sens de l’ajustement">
          <button type="button" className={sign === "+" ? "active" : ""} aria-pressed={sign === "+"} onClick={() => setSign("+")}>+ Ajouter</button>
          <button type="button" className={sign === "-" ? "active" : ""} aria-pressed={sign === "-"} onClick={() => setSign("-")}>− Retirer</button>
        </div>}
        <label>Quantité *{selected && <small className="field-help"> en {selected.unit.label}{selected.unit.decimals ? ` (${selected.unit.decimals} décimale${selected.unit.decimals > 1 ? "s" : ""} max.)` : " entière"}</small>}
          <div className="quantity-field">
            <input ref={resource ? firstField : undefined} name="quantity" inputMode="decimal" value={quantity} placeholder={selected?.unit.decimals ? "12,5" : "25"} required autoComplete="off" aria-describedby={parsed && !parsed.ok && quantity ? "quantity-error" : undefined} onChange={(event) => setQuantity(event.target.value)} />
            <span aria-hidden="true">{selected?.unit.label ?? ""}</span>
          </div>
          {parsed && !parsed.ok && quantity && <small id="quantity-error" className="field-warn">{parsed.error}</small>}
        </label>
        {mode !== "adjust" && <fieldset className="counterparty-field">
          <legend>{mode === "out" ? "Pris par *" : "Origine / donné par"}</legend>
          <div className="segmented" role="group" aria-label="Type de contrepartie">
            <button type="button" className={counterpartyMode === "ninja" ? "active" : ""} aria-pressed={counterpartyMode === "ninja"} onClick={() => setCounterpartyMode("ninja")}>Ninja</button>
            <button type="button" className={counterpartyMode === "external" ? "active" : ""} aria-pressed={counterpartyMode === "external"} onClick={() => setCounterpartyMode("external")}>Personne externe</button>
            {mode === "in" && <button type="button" className={counterpartyMode === "none" ? "active" : ""} aria-pressed={counterpartyMode === "none"} onClick={() => setCounterpartyMode("none")}>Aucune</button>}
          </div>
          <input type="hidden" name="counterpartyMode" value={counterpartyMode} />
          {counterpartyMode === "ninja" && <label>Ninja{ninjaText && !ninja && <small className="field-warn"> — choisissez une proposition</small>}
            <input list={ninjaListId} value={ninjaText} placeholder="Nom ou code NIN-…" autoComplete="off" required={mode === "out"} onChange={(event) => setNinjaText(event.target.value)} />
            <datalist id={ninjaListId}>{ninjas.map((entry) => <option key={entry.id} value={`${entry.name} · ${entry.code}`} />)}</datalist>
            <input type="hidden" name="ninjaId" value={ninja?.id ?? ""} />
          </label>}
          {counterpartyMode === "external" && <label>Nom / référence<input name="counterpartyLabel" maxLength={120} placeholder="Marchand de Suna, caravane…" required={mode === "out"} /></label>}
        </fieldset>}
        {mode === "adjust" ? <label>Justification *<input name="reason" required minLength={3} maxLength={300} placeholder="Casse constatée en rayon, erreur de saisie…" /></label>
          : <label>Motif *<select name="reason" required value={reason} onChange={(event) => setReason(event.target.value)}>
            <option value="" disabled>Choisir un motif…</option>{reasons.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
          </select>{reason === "Autre" && <input name="reasonOther" placeholder="Précisez le motif" required maxLength={300} style={{ marginTop: 6 }} />}</label>}
        <label>Note {mode === "adjust" ? "" : "(facultatif)"}<textarea name="notes" rows={2} maxLength={1000} placeholder="Contexte utile pour la traçabilité" /></label>
        {selected && <div className="movement-preview" aria-live="polite">
          <div><span>Stock actuel</span><strong>{selected.hasMovements || selected.inventoryStatus === "COUNTED" ? formatQuantityWithUnit(selected.quantity, selected.unit) : "—"}</strong></div>
          <div><span>Mouvement</span><strong className={delta < 0 ? "negative" : delta > 0 ? "positive" : ""}>{parsed?.ok ? `${delta < 0 ? "−" : "+"}${formatQuantityWithUnit(Math.abs(delta), selected.unit)}` : "—"}</strong></div>
          <div><span>Nouveau stock</span><strong className={next < 0 ? "negative" : ""}>{parsed?.ok ? formatQuantityWithUnit(next, selected.unit) : "—"}</strong></div>
        </div>}
        {insufficient && <p className="notice error" role="alert">Stock insuffisant. Disponible : <strong>{formatQuantityWithUnit(Math.max(0, selected.quantity), selected.unit)}</strong> · demandé : <strong>{formatQuantityWithUnit(Math.abs(delta), selected.unit)}</strong>.{canAdjust ? " Un responsable peut forcer l’opération ci-dessous avec justification." : " Demandez à un responsable de vérifier le stock."}</p>}
        {selected && selected.inventoryStatus === "NOT_INVENTORIED" && <p className="notice" role="status">{selected.name} n’a jamais été inventorié : le stock affiché est la somme des mouvements connus. Un premier comptage fixera le vrai point de départ.</p>}
        {canAdjust && isOut && <label className="check-field"><input type="checkbox" name="allowNegative" /> Autoriser un stock négatif (justification obligatoire dans la note, audité)</label>}
        {state && !state.ok && <p className="notice error" role="alert">{state.error}</p>}
        <div className="drawer-actions">
          <button type="button" className="button button-ghost" onClick={onClose}>Annuler</button>
          <button type="submit" className="button button-primary" disabled={pending || !selected || !parsed?.ok}>{pending ? "Enregistrement…" : submitLabel}</button>
        </div>
      </form>
    </aside>
  </div>;
}
