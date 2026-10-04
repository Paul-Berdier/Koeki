"use client";
import { useState, useTransition, type ComponentProps } from "react";

type Result = void | { error: string };
/** Keeps the existing fields mounted on validation errors; no sensitive draft storage. */
export function ActionForm({ action, children, ...props }: Omit<ComponentProps<"form">, "action" | "onSubmit"> & { action: (data: FormData) => Promise<Result> }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = async (data: FormData) => { setError(null); const result = await action(data); if (result?.error) setError(result.error); };
  return <form {...props} action={run} onSubmit={(event) => {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (submitter instanceof HTMLButtonElement && submitter.name) data.set(submitter.name, submitter.value);
    startTransition(() => run(data));
  }} aria-busy={pending}>
    {error && <p className="notice error" role="alert">{error}</p>}
    <fieldset disabled={pending} style={{ border: 0, margin: 0, padding: 0, display: "contents" }}>{children}</fieldset>
    {pending && <p role="status">Enregistrement en cours…</p>}
  </form>;
}
