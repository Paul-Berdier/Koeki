"use client";

import { useActionState, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ROLES, type Role } from "@koeki/domain/permissions";
import { isLeadershipRole } from "@koeki/domain/account-policy";
import { accountAction } from "./actions";
import styles from "./account-action-dialog.module.css";

const labels: Record<Role, string> = { SUPER_ADMIN: "Super-administrateur", KOEKI_MANAGER: "Responsable Kōeki", ECONOMIC_AGENT: "Agent économique", NINJA: "Ninja", AUDITOR: "Auditeur" };
type Operation = "revoke" | "reactivate" | "roles" | "remove-agent";
const titles: Record<Operation, string> = { revoke: "Désactiver l’accès au site", reactivate: "Réactiver l’accès", roles: "Modifier les rôles", "remove-agent": "Retirer le rôle d’agent" };

export function AccountActionDialog({ user, operation, replacements, canGrantLeadership }: {
  user: { id: string; name: string; roles: Role[]; dossiers: number; tasks: number };
  operation: Operation; replacements: { id: string; name: string }[]; canGrantLeadership: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [state, action, pending] = useActionState(accountAction, null);
  useEffect(() => { setReady(true); }, []);
  useEffect(() => { if (state?.ok) setOpen(false); }, [state]);
  const canReassign = operation !== "reactivate";
  return <>
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild><button className={`button button-ghost ${styles.trigger}`} type="button" disabled={!ready}>{titles[operation]}</button></Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content}>
          <Dialog.Title className={styles.title}>{titles[operation]}</Dialog.Title>
          <Dialog.Description className={styles.description}>
            <strong>{user.name}</strong> · {user.roles.map((role) => labels[role]).join(", ")}.
            {operation === "revoke" ? " L’accès sera coupé immédiatement et toutes les sessions seront invalidées. La fiche ninja, les taxes, paiements et auteurs historiques seront conservés." : operation === "reactivate" ? " La personne devra se reconnecter. Les anciennes affectations ne seront pas restaurées." : operation === "remove-agent" ? " La personne conserve ses autres rôles et sa fiche ninja. Son activité passée demeure dans l’historique." : " Les droits changent dès la prochaine requête. Retirer le rôle d’agent transfère les dossiers et les tâches restantes."}
          </Dialog.Description>
          <form action={action}>
            <input type="hidden" name="userId" value={user.id} />
            <input type="hidden" name="operation" value={operation} />
            {operation === "roles" && <fieldset className={styles.roles}><legend>Rôles à conserver</legend>{ROLES.filter((role) => canGrantLeadership || !isLeadershipRole(role)).map((role) => <label key={role}><input type="checkbox" name={`role_${role}`} defaultChecked={user.roles.includes(role)} />{labels[role]}</label>)}</fieldset>}
            {canReassign && <><p>{user.dossiers} dossier(s) et {user.tasks} tâche(s) ouverte(s) actuellement attribués.</p><label>Transférer les affectations si l’agent quitte le service<select name="replacementAgentId" defaultValue=""><option value="">À attribuer — aucun remplaçant</option>{replacements.filter((replacement) => replacement.id !== user.id).map((replacement) => <option key={replacement.id} value={replacement.id}>{replacement.name}</option>)}</select></label></>}
            <label>Motif obligatoire<textarea name="reason" required minLength={3} maxLength={1000} aria-describedby={state && !state.ok ? `error-${user.id}-${operation}` : undefined} /></label>
            {state && !state.ok && <p id={`error-${user.id}-${operation}`} className="notice error" role="alert">{state.message}</p>}
            <div className={styles.actions}><Dialog.Close asChild><button className="button button-ghost" type="button" disabled={pending}>Annuler</button></Dialog.Close><button className="button button-primary" type="submit" disabled={pending}>{pending ? "Modification en cours…" : titles[operation]}</button></div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    {state?.ok && <p role="status" className="notice">{state.message}</p>}
  </>;
}
