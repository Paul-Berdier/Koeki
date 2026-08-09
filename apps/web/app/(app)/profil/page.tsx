import { redirect } from "next/navigation";
import { Link2, UserPlus } from "lucide-react";
import { PageHeader, SectionHeader } from "@koeki/ui";
import { demoMode, requireSession } from "@/lib/session";
import { claimOwnProfile, createOwnProfile } from "../ninjas/actions";
import { prisma } from "@koeki/database";

export default async function ProfilePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const query = await searchParams;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  if (!demoMode) {
    const existing = await prisma.ninjaProfile.findUnique({ where: { userId: session.userId }, select: { id: true } });
    if (existing) redirect(`/ninjas/${existing.id}`);
  }
  const [grades, unclaimed] = demoMode ? [[], []] : await Promise.all([
    prisma.ninjaGrade.findMany({ where: { isActive: true, code: { not: "UNKNOWN" } }, orderBy: { sortOrder: "asc" } }),
    prisma.ninjaProfile.findMany({
      where: {
        userId: null,
        status: "ACTIVE",
        invitations: { none: { status: "PENDING", expiresAt: { gt: new Date() } } }
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
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
    <PageHeader eyebrow="Bienvenue à la Kōeki" title="Liez votre fiche ninja" description="Étape obligatoire avant d’accéder au registre : votre compte doit être rattaché à un shinobi de Suna. C’est ce nom qui apparaît partout dans la Kōeki — jamais votre pseudo Discord." />
    {error && <p className="notice error" role="alert">{error}</p>}
    {demoMode ? <p className="notice" role="status">Mode démonstration : les écritures sont désactivées.</p> : <div className="detail-grid" style={{ alignItems: "start" }}>
      {unclaimed.length > 0 && <section className="panel">
        <SectionHeader title="Réclamer ma fiche existante" description="Votre personnage figure très probablement déjà dans le registre importé : tapez son nom et liez sa fiche à votre compte." />
        <form action={claimOwnProfile} className="form-grid">
          <label>Fiche du registre<input name="ninjaRef" list="fiches-registre" required placeholder="Tapez votre prénom pour chercher…" autoComplete="off" /></label>
          <datalist id="fiches-registre">{unclaimed.map((ninja) => <option key={ninja.id} value={`${ninja.firstName} ${ninja.lastName} · ${ninja.code}`.replace(/\s+/g, " ")} />)}</datalist>
          <div className="form-actions"><button className="button button-primary" type="submit"><Link2 size={16} /> Lier cette fiche à mon compte</button></div>
        </form>
      </section>}
      <section className="panel">
        {unclaimed.length > 0 ? <details>
          <summary style={{ cursor: "pointer", padding: "16px 20px", fontWeight: 700, fontSize: 13, color: "var(--sand-300)" }}>Mon personnage n’apparaît pas dans la liste — créer une nouvelle fiche</summary>
          <SectionHeader title="Créer une nouvelle fiche" description="Uniquement si votre personnage n’existe vraiment pas dans le registre — s’il y figure, réclamez-le plutôt" />
          {creationForm(true)}
        </details> : <>
          <SectionHeader title="Créer ma fiche" description="Aucune fiche libre dans le registre : enregistrez votre personnage" />
          {creationForm(false)}
        </>}
      </section>
    </div>}
  </div>;
}
