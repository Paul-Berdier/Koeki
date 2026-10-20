import Link from "next/link";
import { KeyRound, ShieldCheck } from "lucide-react";
import { prisma } from "@koeki/database";
import { checkInvitation } from "@/lib/invitation-check";
import { getAuthErrorMessage } from "@/lib/auth-error-message";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invitation Kōeki", robots: { index: false, follow: false }, referrer: "strict-origin" as const };

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const check = await checkInvitation(token);
  if (!check.ok) {
    const message = getAuthErrorMessage(check.error);
    return <main className="invite-page"><section className="auth-error-card panel" aria-labelledby="invitation-title">
      <p className="eyebrow">Kōeki · Invitation individuelle</p>
      <h1 id="invitation-title">{message.title}</h1>
      <p>{message.description}</p><p className="field-help">{message.help}</p>
      <Link className="button button-primary" href="/connexion">Déjà inscrit ? Se connecter</Link>
    </section></main>;
  }
  // The verified bearer token exposes only its intended character, never the
  // register or the Discord identity of a different person. GET remains read-only.
  const invitation = await prisma.invitation.findUnique({ where: { id: check.id }, select: { ninjaProfile: { select: { id: true, code: true, firstName: true, lastName: true } } } });
  const ninja = invitation?.ninjaProfile;
  return <main className="invite-page"><section className="invite-card">
    <div className="brand-mark" aria-hidden="true"><span /></div>
    <p className="eyebrow">Accès privé · invitation personnelle</p><h1>Rejoindre KŌEKI</h1>
    <p>Le service économique de Suna vous ouvre ses registres.</p>
    <p className="notice"><strong>Un lien = une personne.</strong> Cette invitation sera associée au compte Discord qui l’accepte. Elle ne pourra pas servir à inviter une deuxième personne.</p>
    <p>Vérifiez votre compte Discord avant de continuer. Le compte doit appartenir au serveur autorisé par le service. Une ancienne session Kōeki de ce navigateur sera déconnectée, sans fusionner les comptes.</p>
    {ninja && <p className="notice"><strong>Personnage réservé : {ninja.firstName} {ninja.lastName}</strong><br />{ninja.code}<br />Si ce personnage n’est pas le vôtre, n’acceptez pas ce lien et demandez une nouvelle invitation au responsable.</p>}
    <form method="post" action="/api/connexion/discord" className="form-grid">
      <input type="hidden" name="intent" value="invitation" /><input type="hidden" name="token" value={token} />
      {ninja && <>
        <input type="hidden" name="confirmedNinjaId" value={ninja.id} />
        <label><input type="checkbox" name="confirmIdentity" required /> Je confirme que {ninja.firstName} {ninja.lastName} ({ninja.code}) est bien mon personnage.</label>
      </>}
      <button className="button button-primary" type="submit"><KeyRound size={17} aria-hidden="true" /> Continuer avec Discord</button>
    </form>
    <p className="field-help">Terminez la connexion dans les 10 minutes, dans le même navigateur. Si ce délai est dépassé, rouvrez ce lien tant que l’invitation reste valable.</p>
    <p className="field-help">Invitation valable jusqu’au {check.expiresAt.toLocaleString("fr-FR", { timeZone: "Europe/Paris" })} (heure de Paris).</p>
    <Link className="text-link" href="/connexion">J’ai déjà un accès Kōeki</Link>
    <small><ShieldCheck size={14} aria-hidden="true" /> Aucun compte public ne peut être créé.</small>
    <div className="invite-dunes" aria-hidden="true"><i /><i /><i /></div>
  </section></main>;
}
