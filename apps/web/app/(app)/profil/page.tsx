import Link from "next/link";
import { redirect } from "next/navigation";
import { UserPlus } from "lucide-react";
import { PageHeader, SectionHeader } from "@koeki/ui";
import { demoMode, requireSession } from "@/lib/session";
import { createOwnProfile } from "../ninjas/actions";
import { ClaimProfileForm } from "./claim-profile-form";
import { prisma } from "@koeki/database";

export const dynamic = "force-dynamic";

export default async function ProfilePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const query = await searchParams;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  if (!demoMode) {
    const existing = await prisma.ninjaProfile.findUnique({ where: { userId: session.userId }, select: { id: true, code: true, firstName: true, lastName: true } });
    if (existing && query.identite !== "1") redirect(`/ninjas/${existing.id}`);
    if (existing) return <div className="page-wrap">
      <PageHeader eyebrow="Compte personnel" title="Vérifier mon identité" description="Cette page présente uniquement votre propre compte connecté et la fiche qui lui est rattachée." />
      <section className="panel"><div className="form-grid">
        <p><strong>Personnage rattaché :</strong> {existing.firstName} {existing.lastName} · {existing.code}</p>
        <p><strong>Nom du compte de connexion :</strong> {session.name}</p>
        <p className="field-help">Le nom du compte peut être un pseudonyme Discord : il n’a pas besoin d’être identique au nom du personnage et ne sert pas à choisir automatiquement une fiche.</p>
        <p className="notice">Si ce personnage n’est pas le vôtre, n’enregistrez aucune opération et ne renommez pas sa fiche. Déconnectez-vous, vérifiez le compte choisi dans Discord, puis reconnectez-vous. Si le mauvais nom persiste, un responsable doit vérifier le rattachement ; vos taxes et vos historiques ne doivent pas être déplacés au hasard.</p>
        <div className="form-actions"><Link className="button button-primary" href={`/ninjas/${existing.id}`}>Ouvrir ma fiche ninja</Link>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Auth.js sign-out handler */}
          <a className="button button-ghost" href="/api/auth/signout">Se déconnecter</a>
        </div>
      </div></section>
    </div>;
  }
  const [grades, unclaimed] = demoMode ? [[], []] : await Promise.all([
    prisma.ninjaGrade.findMany({ where: { isActive: true, code: { not: "UNKNOWN" } }, orderBy: { sortOrder: "asc" } }),
    prisma.ninjaProfile.findMany({
      where: { userId: null, status: "ACTIVE", invitations: { none: { status: "PENDING", expiresAt: { gt: new Date() } } } },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { code: "asc" }],
      select: { id: true, code: true, firstName: true, lastName: true }
    })
  ]);
  const creationForm = (withConfirm: boolean) => <form action={createOwnProfile} className="form-grid">
    {withConfirm ? <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" name="confirmNew" required style={{ minHeight: 0, width: 16, height: 16 }} /> J’ai cherché dans la liste : ma fiche n’existe pas encore dans le registre</label> : <input type="hidden" name="confirmNew" value="on" />}
    <div className="form-row">
      <label>Prénom *<input type="text" name="firstName" required maxLength={80} /></label>
      <label>Nom *<input type="text" name="lastName" required maxLength={80} /></label>
    </div>
    <div className="form-row">
      <label>Grade *<select name="gradeId" required defaultValue=""><option value="" disabled>Sélectionner un grade…</option>{grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.label}</option>)}</select></label>
      <label>Pseudonyme<input type="text" name="alias" maxLength={80} /></label>
    </div>
    <label>Clan ou famille<input type="text" name="clan" maxLength={80} /></label>
    <div className="form-actions"><button className="button button-ghost" type="submit"><UserPlus size={16} /> Créer ma fiche</button></div>
  </form>;
  return <div className="page-wrap">
    <PageHeader eyebrow="Bienvenue à la Kōeki" title="Liez votre fiche ninja" description="Votre compte doit être rattaché à un shinobi de Suna. Vérifiez le nom complet et le code : aucune fiche n’est choisie automatiquement à partir d’un prénom." />
    {error && <p className="notice error" role="alert">{error}</p>}
    {demoMode ? <p className="notice" role="status">Mode démonstration : les écritures sont désactivées.</p> : <div className="detail-grid" style={{ alignItems: "start" }}>
      {unclaimed.length > 0 && <section className="panel">
        <SectionHeader title="Réclamer ma fiche existante" description="Choisissez exactement votre personnage, vérifiez son code et confirmez votre sélection." />
        <ClaimProfileForm choices={unclaimed} />
      </section>}
      <section className="panel">
        {unclaimed.length > 0 ? <details>
          <summary style={{ cursor: "pointer", padding: "16px 20px", fontWeight: 700, fontSize: 13, color: "var(--sand-300)" }}>Mon personnage n’apparaît pas dans la liste — créer une nouvelle fiche</summary>
          <SectionHeader title="Créer une nouvelle fiche" description="Uniquement si votre personnage n’existe vraiment pas dans le registre. Une fiche liée ou réservée doit être vérifiée par un responsable, pas recréée." />
          {creationForm(true)}
        </details> : <>
          <SectionHeader title="Créer ma fiche" description="Aucune fiche libre dans le registre : vérifiez avec un responsable avant de créer un doublon." />
          {creationForm(false)}
        </>}
      </section>
    </div>}
  </div>;
}
