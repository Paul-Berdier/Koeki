"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Pencil, Search, SearchX, ShieldAlert } from "lucide-react";
import { EquipmentEditor } from "@/components/equipment-editor";
import { EQUIPMENT_SLOTS, type EquipmentRow } from "@/lib/equipment";

type Filter = "all" | "incomplete" | "empty" | "complete";

const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr");

const equippedCount = (row: EquipmentRow) => EQUIPMENT_SLOTS.filter(([slot]) => {
  const tier = row.slots[slot]?.tier;
  return tier && tier !== "Aucun";
}).length;

function SlotSummary({ row }: { row: EquipmentRow }) {
  return <div className="equipment-slots" aria-label={`Panoplie de ${row.name}`}>
    {EQUIPMENT_SLOTS.map(([slot, label]) => {
      const value = row.slots[slot];
      const tier = value?.tier && value.tier !== "Aucun" ? value.tier : null;
      return <div className={`equipment-slot ${tier ? `tier-${tier.toLowerCase()}` : "is-empty"}`} key={slot}>
        <span>{label}</span>
        {tier ? <><strong>{tier}</strong><small>{value?.type || "Non orienté"}</small></> : <><strong>—</strong><small>Non renseigné</small></>}
      </div>;
    })}
  </div>;
}

export function EquipmentBoard({ rows, canEdit, action }: {
  rows: EquipmentRow[];
  canEdit: boolean;
  action: (formData: FormData) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query);

  const counts = useMemo(() => {
    const complete = rows.filter((row) => equippedCount(row) === EQUIPMENT_SLOTS.length).length;
    const empty = rows.filter((row) => equippedCount(row) === 0).length;
    return { all: rows.length, incomplete: rows.length - complete, empty, complete };
  }, [rows]);

  const visibleRows = useMemo(() => {
    const needle = normalize(deferredQuery.trim());
    return rows.filter((row) => {
      const count = equippedCount(row);
      const matchesFilter = filter === "all"
        || (filter === "incomplete" && count < EQUIPMENT_SLOTS.length)
        || (filter === "empty" && count === 0)
        || (filter === "complete" && count === EQUIPMENT_SLOTS.length);
      return matchesFilter && (!needle || normalize(`${row.name} ${row.code} ${row.grade}`).includes(needle));
    });
  }, [deferredQuery, filter, rows]);

  const filters: Array<{ value: Filter; label: string }> = [
    { value: "all", label: "Tous" },
    { value: "incomplete", label: "À compléter" },
    { value: "empty", label: "Sans équipement" },
    { value: "complete", label: "Complets" }
  ];

  return <section className="panel equipment-panel">
    <div className="equipment-toolbar">
      <div className="equipment-toolbar-heading">
        <div>
          <h2>Panoplies</h2>
          <p>Les dossiers incomplets sont signalés pour être repérés en un coup d’œil.</p>
        </div>
        <label className="equipment-search">
          <span className="sr-only">Rechercher un ninja</span>
          <Search size={17} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un ninja…" />
        </label>
      </div>
      <div className="equipment-filters" role="group" aria-label="Filtrer les panoplies">
        {filters.map((item) => <button type="button" key={item.value} className={filter === item.value ? "active" : ""} aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>
          {item.label}<span>{counts[item.value]}</span>
        </button>)}
      </div>
    </div>

    <div className="equipment-result-count" aria-live="polite">
      {visibleRows.length} ninja{visibleRows.length > 1 ? "s" : ""} affiché{visibleRows.length > 1 ? "s" : ""}
    </div>

    {visibleRows.length ? <div className="equipment-list">
      {visibleRows.map((row) => {
        const count = equippedCount(row);
        const complete = count === EQUIPMENT_SLOTS.length;
        const empty = count === 0;
        const isEditing = editingId === row.id;
        return <article className={`equipment-row ${empty ? "needs-attention" : ""} ${isEditing ? "is-editing" : ""}`} key={row.id}>
          <div className="equipment-row-summary">
            <Link className="equipment-person ninja-record-link" href={`/ninjas/${row.id}`}>
              <strong>{row.name}</strong>
              <span>{row.grade} · {row.code}</span>
            </Link>
            <div className={`equipment-progress ${complete ? "is-complete" : empty ? "is-empty" : ""}`}>
              <div><span>{complete ? <CheckCircle2 size={14} aria-hidden="true" /> : <ShieldAlert size={14} aria-hidden="true" />}{complete ? "Complet" : empty ? "À renseigner" : "En cours"}</span><strong>{count}/{EQUIPMENT_SLOTS.length}</strong></div>
              <i aria-hidden="true"><b style={{ width: `${count / EQUIPMENT_SLOTS.length * 100}%` }} /></i>
            </div>
            <SlotSummary row={row} />
            {canEdit && <button className="equipment-edit-button" type="button" aria-expanded={isEditing} onClick={() => setEditingId(isEditing ? null : row.id)}>
              <Pencil size={15} aria-hidden="true" />{isEditing ? "Fermer" : "Modifier"}
            </button>}
          </div>
          {isEditing && <div className="equipment-inline-editor"><EquipmentEditor key={row.id} ninja={row} action={action} onCancel={() => setEditingId(null)} /></div>}
        </article>;
      })}
    </div> : <div className="equipment-no-result"><SearchX size={25} aria-hidden="true" /><strong>Aucun ninja trouvé</strong><p>Modifiez la recherche ou choisissez un autre filtre.</p></div>}
  </section>;
}
