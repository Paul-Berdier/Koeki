import { KeyRound, ShieldCheck } from "lucide-react";

export const metadata = { title: "Connexion", robots: { index: false, follow: false } };

export default function SignInPage() {
  return <main className="invite-page">
    <section className="invite-card">
      <div className="brand-mark" aria-hidden="true"><span /></div>
      <p className="eyebrow">Service économique de Suna</p><h1>KŌEKI</h1>
      <p>Vous avez déjà accepté une invitation ? Retrouvez vos registres avec le même compte Discord.</p>
      <form method="post" action="/api/connexion/discord"><input type="hidden" name="intent" value="connexion" /><button className="button button-primary" type="submit"><KeyRound size={17} aria-hidden="true" /> Se connecter avec Discord</button></form>
      <section className="notice" aria-labelledby="first-connection-title">
        <h2 id="first-connection-title">Première connexion ?</h2>
        <p>Ouvrez votre <strong>lien d’invitation individuel</strong> reçu d’un responsable, puis cliquez sur « Continuer avec Discord » sur cette page d’invitation.</p>
        <p>Le lien doit contenir <code>/invite/</code>. L’adresse de cette page de connexion ne remplace pas une invitation. <strong>Chaque personne doit recevoir un lien différent.</strong></p>
      </section>
      <small><ShieldCheck size={14} aria-hidden="true" /> Aucun compte public ne peut être créé.</small>
      <div className="invite-dunes" aria-hidden="true"><i /><i /><i /></div>
    </section>
  </main>;
}
