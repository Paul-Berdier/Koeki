"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import * as Dialog from "@radix-ui/react-dialog";
import styles from "./comptes/account-action-dialog.module.css";

/** Confirmation captures the actual entered scale before applying its impact. */
export function ConfirmSettingSubmit({ formId, label, impact, fields }: { formId: string; label: string; impact: string; fields: { name: string; label: string; unit: string }[] }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<{ label: string; value: string }[]>([]);
  const { pending } = useFormStatus();
  function preview() {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form?.reportValidity()) return;
    const data = new FormData(form);
    setValues(fields.map((field) => ({ label: field.label, value: `${String(data.get(field.name) ?? "")} ${field.unit}` })));
    setOpen(true);
  }
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger asChild><button className="button button-primary" type="button" disabled={pending} onClick={(event) => { event.preventDefault(); preview(); }}>{pending ? "Application en cours…" : label}</button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className={styles.overlay} /><Dialog.Content className={styles.content}>
      <Dialog.Title className={styles.title}>Confirmer les paramètres économiques</Dialog.Title>
      <Dialog.Description className={styles.description}>{impact}</Dialog.Description>
      <dl className="mini-list">{values.map((value) => <div key={value.label}><dt>{value.label}</dt><dd>{value.value}</dd></div>)}</dl>
      <div className={styles.actions}><Dialog.Close asChild><button className="button button-ghost" type="button">Revenir à la saisie</button></Dialog.Close><button className="button button-primary" type="button" disabled={pending} onClick={() => { (document.getElementById(formId) as HTMLFormElement | null)?.requestSubmit(); setOpen(false); }}>Confirmer et appliquer</button></div>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
