"use client";

import { ErrorState } from "@koeki/ui";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="page-wrap">
    <ErrorState description="Le registre demandé n’a pas pu être chargé. Une opération envoyée juste avant cette erreur peut déjà avoir été enregistrée : vérifiez son résultat avant de la renvoyer." />
    {error.digest && <p className="muted">Référence de l’erreur : {error.digest}</p>}
    <div className="inline-actions">
      <button type="button" className="button secondary" onClick={() => reset()}>Réessayer l’affichage</button>
      <button type="button" className="button" onClick={() => window.location.assign(window.location.href)}>Recharger la page</button>
    </div>
    <p className="muted">Ces boutons rechargent l’affichage ; ils ne renvoient pas le formulaire.</p>
  </div>;
}
