"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Save, X } from "lucide-react";
import { EQUIPMENT_SLOTS, type EquipmentRow } from "@/lib/equipment";

const TIERS = ["Aucun", "T1", "T2", "T3", "T4"];
const TYPES = ["Armure", "Jutsu", "Ténacité"];

interface SlotFormValue {
  tier: string;
  type: string;
}

function SaveButton() {
  const { pending } = useFormStatus();
  return <button className="button button-primary" type="submit" disabled={pending}>
    <Save size={16} aria-hidden="true" />
    {pending ? "Enregistrement…" : "Enregistrer"}
  </button>;
}

export function EquipmentEditor({ ninja, action, onCancel }: {
  ninja: EquipmentRow;
  action: (formData: FormData) => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, SlotFormValue>>(() =>
    Object.fromEntries(EQUIPMENT_SLOTS.map(([slot]) => {
      const current = ninja.slots[slot];
      return [slot, { tier: current?.tier ?? "Aucun", type: current?.type ?? "" }];
    }))
  );

  return <form action={action} className="equipment-editor">
    <input type="hidden" name="ninjaId" value={ninja.id} />
    <div className="equipment-editor-heading">
      <div>
        <span>Modification en cours</span>
        <h3>{ninja.name}</h3>
        <p>{ninja.grade} · {ninja.code}</p>
      </div>
      <button className="equipment-close" type="button" onClick={onCancel} aria-label="Fermer l’éditeur">
        <X size={18} aria-hidden="true" />
      </button>
    </div>

    <div className="equipment-editor-grid">
      {EQUIPMENT_SLOTS.map(([slot, label]) => {
        const current = values[slot] ?? { tier: "Aucun", type: "" };
        const isEmpty = current.tier === "Aucun";
        return <fieldset className="equipment-editor-slot" key={slot}>
          <legend>{label}</legend>
          <label>
            <span>Tier</span>
            <select name={`slot_${slot}_tier`} value={current.tier} onChange={(event) => {
              const tier = event.target.value;
              setValues((previous) => ({ ...previous, [slot]: { tier, type: tier === "Aucun" ? "" : current.type } }));
            }}>
              {TIERS.map((tier) => <option key={tier} value={tier}>{tier}</option>)}
            </select>
          </label>
          <label>
            <span>Orientation</span>
            {isEmpty
              ? <><input type="hidden" name={`slot_${slot}_type`} value="" /><select value="" disabled aria-label={`${label} · orientation`}><option>—</option></select></>
              : <select name={`slot_${slot}_type`} value={current.type} aria-label={`${label} · orientation`} onChange={(event) => {
                const type = event.target.value;
                setValues((previous) => ({ ...previous, [slot]: { ...current, type } }));
              }}>
                <option value="">—</option>
                {TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>}
          </label>
        </fieldset>;
      })}
    </div>

    <div className="equipment-editor-actions">
      <button className="button button-ghost" type="button" onClick={onCancel}>Annuler</button>
      <SaveButton />
    </div>
  </form>;
}
