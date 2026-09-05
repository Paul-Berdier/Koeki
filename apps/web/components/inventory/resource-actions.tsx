"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, ArrowUpFromLine, SlidersHorizontal } from "lucide-react";
import type { ActionState, InventoryRow, NinjaOption } from "@/lib/inventory-types";
import { MovementDrawer, type DrawerMode } from "./movement-drawer";

type FormAction = (previous: ActionState, formData: FormData) => Promise<ActionState>;

/** Entry / exit / adjustment buttons of a resource page. */
export function ResourceActions({ row, ninjas, canAdjust, movementAction, adjustmentAction }: { row: InventoryRow; ninjas: NinjaOption[]; canAdjust: boolean; movementAction: FormAction; adjustmentAction: FormAction }) {
  const router = useRouter();
  const [open, setOpen] = useState<DrawerMode | null>(null);
  const onSuccess = useCallback((message: string) => { setOpen(null); router.push(`/inventory/${row.id}?info=${encodeURIComponent(message)}`); router.refresh(); }, [router, row.id]);
  return <>
    <button type="button" className="button button-primary" onClick={() => setOpen("in")}><ArrowDownToLine size={17} aria-hidden="true" /> Entrée</button>
    <button type="button" className="button button-ghost" onClick={() => setOpen("out")}><ArrowUpFromLine size={17} aria-hidden="true" /> Sortie</button>
    {canAdjust && <button type="button" className="button button-ghost" onClick={() => setOpen("adjust")}><SlidersHorizontal size={17} aria-hidden="true" /> Ajuster</button>}
    {open && <MovementDrawer mode={open} resource={row} resources={[row]} ninjas={ninjas} canAdjust={canAdjust} action={movementAction} adjustmentAction={adjustmentAction} onClose={() => setOpen(null)} onSuccess={onSuccess} />}
  </>;
}
