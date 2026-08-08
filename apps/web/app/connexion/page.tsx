import { KeyRound, ShieldCheck } from "lucide-react";
import { signIn } from "@/auth";

export const metadata = { title: "Connexion" };

export default function SignInPage() {
  async function connect() { "use server"; await signIn("discord", { redirectTo: "/" }); }
  return <main className="invite-page">
    <section className="invite-card">
      <div className="brand-mark" aria-hidden="true"><span /></div>
      <p className="eyebrow">Service économique de Suna</p>
      <h1>KŌEKI</h1>
      <p>Registre des taxes, dons et ressources du village. Accès réservé au personnel autorisé et aux shinobis invités.</p>
      <form action={connect}><button className="button button-primary" type="submit"><KeyRound size={17} /> Se connecter avec Discord</button></form>
      <p style={{ fontSize: 11 }}>Pas encore d’accès ? La Kōeki fonctionne sur invitation : demandez votre lien à un responsable du service.</p>
      <small><ShieldCheck size={14} /> Aucun compte public ne peut être créé.</small>
      <div className="invite-dunes" aria-hidden="true"><i /><i /><i /></div>
    </section>
  </main>;
}
