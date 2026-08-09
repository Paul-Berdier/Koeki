import { redirect } from "next/navigation";
import { PageHeader } from "@koeki/ui";
import { EquipmentBoard } from "@/components/equipment-board";
import { DEMO_EQUIPMENT_ROWS, EQUIPMENT_SLOTS, type EquipmentRow } from "@/lib/equipment";
import { demoMode, hasPermission, requireSession } from "@/lib/session";
import { prisma } from "@koeki/database";
import { updateEquipment } from "./actions";

const JONIN_PLUS = ["JONIN", "JONIN_COMMANDER", "KAGE", "SANIN"];

const equippedCount = (row: EquipmentRow) => EQUIPMENT_SLOTS.filter(([slot]) => {
  const tier = row.slots[slot]?.tier;
  return tier && tier !== "Aucun";
}).length;

export default async function EquipmentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  if (!hasPermission(session, "inventory:write") && !hasPermission(session, "audit:read")) redirect("/access-denied");

  const query = await searchParams;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const info = typeof query.info === "string" ? query.info : null;
  const canEdit = !demoMode && hasPermission(session, "inventory:write");

  const rows: EquipmentRow[] = demoMode ? DEMO_EQUIPMENT_ROWS : (await prisma.ninjaProfile.findMany({
    where: { status: "ACTIVE", currentGrade: { code: { in: JONIN_PLUS } } },
    include: { currentGrade: true, equipment: true },
    orderBy: [{ currentGrade: { sortOrder: "desc" } }, { lastName: "asc" }, { firstName: "asc" }]
  })).map((ninja) => ({
    id: ninja.id,
    code: ninja.code,
    name: `${ninja.firstName} ${ninja.lastName}`,
    grade: ninja.currentGrade.label,
    slots: (ninja.equipment?.slots ?? {}) as EquipmentRow["slots"]
  }));

  const complete = rows.filter((row) => equippedCount(row) === EQUIPMENT_SLOTS.length).length;
  const empty = rows.filter((row) => equippedCount(row) === 0).length;

  return <div className="page-wrap equipment-page">
    <PageHeader
      eyebrow="Forces de Suna"
      title="Équipement des Jōnin"
      description="Consultez les panoplies, repérez les slots manquants et mettez un ninja à jour sans quitter la liste."
      metrics={[
        { label: "Ninjas suivis", value: rows.length },
        { label: "Panoplies complètes", value: complete },
        { label: "À renseigner", value: empty }
      ]}
    />
    {demoMode && <p className="notice" role="status">Mode démonstration : les modifications sont désactivées.</p>}
    {info && <p className="notice" role="status">{info}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    <EquipmentBoard rows={rows} canEdit={canEdit} action={updateEquipment} />
  </div>;
}
