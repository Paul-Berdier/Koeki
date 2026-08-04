import { redirect } from "next/navigation";
import { UserPlus } from "lucide-react";
import { PageHeader, SectionHeader } from "@koeki/ui";
import { demoMode, requireSession } from "@/lib/session";
import { createOwnProfile } from "../ninjas/actions";
import { prisma } from "@koeki/database";

export default async function ProfilePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const query = await searchParams;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  if (!demoMode) {
    const existing = await prisma.ninjaProfile.findUnique({ where: { userId: session.userId }, select: { id: true } });
    if (existing) redirect(`/ninjas/${existing.id}`);
  }
  const grades = demoMode ? [] : await prisma.ninjaGrade.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  return <div className="page-wrap">
    <PageHeader eyebrow="Bienvenue à la Kōeki" title="Votre fiche ninja" description="Enregistrez votre identité de shinobi de Suna : elle sera liée à votre compte Discord et servira à vos taxes, points et opérations." />
    {error && <p className="notice error" role="alert">{error}</p>}
    {demoMode ? <p className="notice" role="status">Mode démonstration : les écritures sont désactivées.</p> : <section className="panel" style={{ maxWidth: 640 }}>
      <SectionHeader title="Enregistrement" description="Le code administratif est attribué automatiquement — un responsable pourra corriger le grade ensuite" />
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
        <div className="form-actions"><button className="button button-primary" type="submit"><UserPlus size={16} /> Créer ma fiche</button></div>
      </form>
    </section>}
  </div>;
}
