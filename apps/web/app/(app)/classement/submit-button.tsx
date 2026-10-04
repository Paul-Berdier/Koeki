"use client";

import { useFormStatus } from "react-dom";

export function RankingSubmitButton({ correction, disabled }: { correction: boolean; disabled: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" className="button button-primary" disabled={disabled || pending} aria-disabled={disabled || pending} aria-busy={pending}>{pending ? "Publication en cours…" : correction ? "Publier une nouvelle version motivée" : "Clôturer cette semaine"}</button>;
}
