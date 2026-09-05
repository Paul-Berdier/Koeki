"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import type { ActionState } from "@/lib/inventory-types";

type FormAction = (previous: ActionState, formData: FormData) => Promise<ActionState>;

/** Inline correction: a REVERSAL line is written, the original stays visible and linked. */
export function ReverseForm({ movementId, label, action, canOverride }: { movementId: string; label: string; action: FormAction; canOverride: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, null);
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);
  const handled = useRef<ActionState>(null);
  useEffect(() => { if (state?.ok && handled.current !== state) { handled.current = state; setOpen(false); router.refresh(); } }, [state, router]);
  if (!open) return <button type="button" className="button button-ghost row-mini-button" onClick={() => setOpen(true)} aria-label={`Annuler le mouvement ${label}`}><Undo2 size={13} aria-hidden="true" /> Annuler</button>;
  return <form action={formAction} className="reverse-form">
    <input type="hidden" name="movementId" value={movementId} />
    <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
    <label><span className="sr-only">Motif de l’annulation</span><input name="reason" required minLength={3} maxLength={300} placeholder="Motif de l’annulation (obligatoire)" autoFocus /></label>
    {canOverride && <label className="check-field"><input type="checkbox" name="allowNegative" /> Autoriser un stock négatif</label>}
    {state && !state.ok && <small className="field-warn" role="alert">{state.error}</small>}
    <div className="reverse-actions">
      <button type="button" className="button button-ghost row-mini-button" onClick={() => setOpen(false)}>Fermer</button>
      <button type="submit" className="button button-primary row-mini-button" disabled={pending}>{pending ? "…" : "Confirmer l’annulation"}</button>
    </div>
  </form>;
}
