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
    prisma.ninjaGrade.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.ninjaProfile.findMany({ where: { userId: null, status: "ACTIVE" }, orderBy: [{ firstName: "asc" }, { lastName: "asc" }], select: { id: true, code: true, firstName: true, lastName: true } })
  ]);
  return <div className="page-wrap">
    <PageHeader eyebrow="Bienvenue à la Kōeki" title="Votre fiche ninja" description="Liez votre identité de shinobi de Suna à votre compte Discord : elle portera vos taxes, points et opérations." />
    {error && <p className="notice error" role="alert">{error}</p>}
    {demoMode ? <p className="notice" role="status">Mode démonstration : les écritures sont désactivées.</p> : <div className="detail-grid" style={{ alignItems: "start" }}>
      {unclaimed.length > 0 && <section className="panel">
        <SectionHeader title="Réclamer ma fiche existante" description="Votre personnage figure déjà dans le registre importé ? Tapez son nom et liez sa fiche à votre compte." />
        <form action={claimOwnProfile} className="form-grid">
          <label>Fiche du registre<input name="ninjaRef" list="fiches-registre" required placeholder="Tapez votre prénom pour chercher…" autoComplete="off" /></label>
          <datalist id="fiches-registre">{unclaimed.map((ninja) => <option key={ninja.id} value={`${ninja.firstName} ${ninja.lastName} · ${ninja.code}`.replace(/\s+/g, " ")} />)}</datalist>
          <div className="form-actions"><button className="button button-primary" type="submit"><Link2 size={16} /> Lier cette fiche à mon compte</button></div>
        </form>
      </section>}
      <section className="panel">
        <SectionHeader title="Créer une nouvelle fiche" description="Uniquement si votre personnage n’existe pas encore dans le registre" />
        <form action={createOwnProfile} className="form-grid">
          <div className="form-row">
            <label>Prénom *<input type="text" name="firstName" required maxLength={80} /></label>
            <label>Nom *<input type="text" name="lastName" required maxLength={80} /></label>
          </div>
          <div className="form-row">
            <label>Grade *<select name="gradeId" required>{grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.label}</option>)}</select></label>
            <label>Pseudonyme<input type="text" name="alias" maxLength={80} /></label>
          </div>
          <label>Clan ou famille<input type="text" name="clan" maxLength={80} /></label>
          <div className="form-actions"><button className="button button-ghost" type="submit"><UserPlus size={16} /> Créer ma fiche</button></div>
        </form>
      </section>
    </div>}
  </div>;
}
