import { KeyRound, ShieldCheck } from "lucide-react";
import { cookies } from "next/headers";
import { signIn } from "@/auth";
export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  async function connect() { "use server"; (await cookies()).set("koeki_invite", token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/" }); await signIn("discord", { redirectTo: "/" }); }
  return <main className="invite-page"><section className="invite-card"><div className="brand-mark" aria-hidden="true"><span /></div><p className="eyebrow">Accès privé · invitation requise</p><h1>Rejoindre KŌEKI</h1><p>Cette invitation sera associée à votre compte Discord et ne pourra être utilisée qu’une fois.</p><form action={connect}><button className="button button-primary" type="submit"><KeyRound size={17}/> Continuer avec Discord</button></form><small><ShieldCheck size={14}/> Aucun compte public ne peut être créé.</small></section></main>;
}
