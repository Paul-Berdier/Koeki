import { redirect } from "next/navigation";
import { EmptyState, MetricCard, PageHeader, SectionHeader, StatusBadge } from "@koeki/ui";
import { EQUIPMENT_SLOTS, EquipmentEditor } from "@/components/equipment-editor";
import { demoMode, hasPermission, requireSession } from "@/lib/session";
import { prisma } from "@koeki/database";
import { updateEquipment } from "./actions";

const JONIN_PLUS = ["TOKUBETSU_JONIN", "JONIN", "JONIN_COMMANDER", "KAGE", "SANIN"];
type Slots = Record<string, { tier?: string | null; type?: string | null }>;
const equippedCount = (slots: Slots) => Object.values(slots).filter((slot) => slot?.tier && slot.tier !== "Aucun").length;

export default async function EquipmentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  if (!hasPermission(session, "inventory:write") && !hasPermission(session, "audit:read")) redirect("/access-denied");
  const query = await searchParams;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const info = typeof query.info === "string" ? query.info : null;
  if (demoMode) return <div className="page-wrap">
    <PageHeader eyebrow="Forces de Suna" title="Équipement des Jonin" description="Panoplies des ninjas de grade Tokubetsu Jonin et plus." />
    <p className="notice" role="status">Mode démonstration : les écritures sont désactivées.</p>
  </div>;
  const canEdit = hasPermission(session, "inventory:write");
  const jonins = await prisma.ninjaProfile.findMany({
    where: { status: "ACTIVE", currentGrade: { code: { in: JONIN_PLUS } } },
    include: { currentGrade: true, equipment: true },
    orderBy: [{ currentGrade: { sortOrder: "desc" } }, { lastName: "asc" }, { firstName: "asc" }]
  });
  const rows = jonins.map((ninja) => ({
    id: ninja.id, code: ninja.code, name: `${ninja.firstName} ${ninja.lastName}`, grade: ninja.currentGrade.label,
    slots: (ninja.equipment?.slots ?? {}) as Slots
  }));
  const equipped = rows.filter((row) => equippedCount(row.slots) > 0);
  const complete = rows.filter((row) => equippedCount(row.slots) === EQUIPMENT_SLOTS.length);
  return <div className="page-wrap">
    <PageHeader eyebrow="Forces de Suna" title="Équipement des Jonin" description="Qui est équipé, et de quoi — panoplies par slot des ninjas de grade Tokubetsu Jonin et plus, reprises du registre du bot et tenues à jour ici." />
    {info && <p className="notice" role="status">{info}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    <section className="metric-grid" aria-label="État d’équipement">
      <MetricCard label="Jonin et plus" value={String(rows.length)} detail="Ninjas actifs concernés" />
      <MetricCard label="Équipés" value={String(equipped.length)} detail="Au moins un slot renseigné" tone={equipped.length ? "good" : "neutral"} />
      <MetricCard label="Panoplies complètes" value={String(complete.length)} detail={`${EQUIPMENT_SLOTS.length} slots sur ${EQUIPMENT_SLOTS.length}`} tone={complete.length ? "good" : "neutral"} />
      <MetricCard label="Sans équipement" value={String(rows.length - equipped.length)} detail={rows.length - equipped.length ? "À équiper ou à renseigner" : "Tout le monde est suivi"} tone={rows.length - equipped.length ? "warn" : "good"} />
    </section>
    <div className="detail-grid" style={{ alignItems: "start" }}>
      <section className="panel stack-panel">
        <SectionHeader title="Panoplies" description="Tier et orientation (Armure / Jutsu / Ténacité) par slot" />
        {rows.length ? <div className="table-scroll"><table><thead><tr><th>Ninja</th><th>Grade</th>{EQUIPMENT_SLOTS.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead><tbody>
          {rows.map((row) => <tr key={row.id}>
            <td><strong>{row.name}</strong> <small style={{ color: "var(--sand-500)" }}>{row.code}</small></td>
            <td>{row.grade}</td>
            {EQUIPMENT_SLOTS.map(([slot]) => {
              const value = row.slots[slot];
              const tier = value?.tier && value.tier !== "Aucun" ? value.tier : null;
              return <td key={slot}>{tier ? <StatusBadge status={tier === "T4" ? "paid" : tier === "T3" ? "due" : "pending"}>{tier}{value?.type ? ` ${value.type}` : ""}</StatusBadge> : <span className="muted">—</span>}</td>;
            })}
          </tr>)}
        </tbody></table></div> : <EmptyState title="Aucun Jonin actif" description="Les ninjas de grade Tokubetsu Jonin et plus apparaîtront ici." />}
      </section>
      {canEdit && <section className="panel">
        <SectionHeader title="Mettre à jour une panoplie" description="Sélectionnez un ninja — ses slots actuels se préremplissent" />
        <EquipmentEditor jonins={rows.map((row) => ({ id: row.id, label: `${row.name} · ${row.grade}`, slots: row.slots }))} action={updateEquipment} />
      </section>}
    </div>
  </div>;
}
