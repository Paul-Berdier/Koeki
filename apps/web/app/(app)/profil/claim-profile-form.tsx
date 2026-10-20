"use client";

import { useActionState, useState } from "react";
import { confirmOwnProfile } from "./actions";

type Choice = { id: string; code: string; firstName: string; lastName: string };
const label = (choice: Choice) => `${choice.firstName} ${choice.lastName} · ${choice.code}`.normalize("NFKC").replace(/\s+/gu, " ").trim();

export function ClaimProfileForm({ choices }: { choices: Choice[] }) {
  const [selection, setSelection] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [state, action, pending] = useActionState(confirmOwnProfile, {});
  return <form action={action} className="form-grid" aria-label="Confirmer ma fiche ninja">
    <label>Personnage et code du registre
      <select name="ninjaRef" required value={selection} onChange={(event) => { setSelection(event.target.value); setConfirmed(false); }}>
        <option value="" disabled>Choisissez votre personnage — aucun choix par défaut</option>
        {choices.map((choice) => <option key={choice.id} value={label(choice)}>{label(choice)}</option>)}
      </select>
    </label>
    <p className="notice" aria-live="polite">{selection ? <>Vous allez rattacher <strong>{selection}</strong> à votre compte connecté.</> : "Aucune fiche sélectionnée. Vérifiez le nom complet et le code, pas seulement le prénom."}</p>
    <label><input type="checkbox" name="confirmIdentity" required checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> Je confirme que le personnage sélectionné est bien le mien.</label>
    {state.error && <p className="notice error" role="alert">{state.error}</p>}
    <p className="field-help">Une fiche déjà rattachée ou réservée ne peut pas être récupérée ici. Si le nom affiché après connexion n’est pas le vôtre, déconnectez-vous et prévenez un responsable ; ne renommez pas une autre fiche.</p>
    <div className="form-actions"><button className="button button-primary" type="submit" disabled={pending}>{pending ? "Vérification de la fiche…" : "Confirmer et lier ma fiche"}</button></div>
  </form>;
}
