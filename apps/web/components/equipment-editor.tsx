"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { EQUIPMENT_SLOTS } from "@/lib/equipment";

const TIERS = ["Aucun", "T1", "T2", "T3", "T4"];
const TYPES = ["", "Armure", "Jutsu", "Ténacité"];

export interface JoninRow { id: string; label: string; slots: Record<string, { tier?: string | null; type?: string | null }> }

export function EquipmentEditor({ jonins, action }: { jonins: JoninRow[]; action: (formData: FormData) => void }) {
  const [ninjaId, setNinjaId] = useState("");
  const selected = jonins.find((ninja) => ninja.id === ninjaId) ?? null;
  return <form action={action} className="form-grid" key={ninjaId}>
    <label>Ninja<select name="ninjaId" required value={ninjaId} onChange={(event) => setNinjaId(event.target.value)}>
      <option value="">Sélectionner…</option>{jonins.map((ninja) => <option key={ninja.id} value={ninja.id}>{ninja.label}</option>)}
    </select></label>
    {selected && EQUIPMENT_SLOTS.map(([slot, label]) => {
      const current = selected.slots[slot] ?? {};
      return <div className="form-row" key={slot}>
        <label>{label} — tier<select name={`slot_${slot}_tier`} defaultValue={current.tier ?? "Aucun"}>{TIERS.map((tier) => <option key={tier} value={tier}>{tier}</option>)}</select></label>
        <label>{label} — type<select name={`slot_${slot}_type`} defaultValue={current.type ?? ""}><option value="">—</option>{TYPES.filter(Boolean).map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
      </div>;
    })}
    {selected && <div className="form-actions"><button className="button button-primary" type="submit"><Save size={16} /> Enregistrer la panoplie</button></div>}
  </form>;
}
