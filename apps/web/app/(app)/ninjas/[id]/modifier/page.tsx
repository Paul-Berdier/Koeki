import Link from "next/link";
import { notFound } from "next/navigation";
import { ArchiveRestore, ArrowLeft, Save, Trash2 } from "lucide-react";
import { PageHeader, SectionHeader } from "@koeki/ui";
import { demoMode, requirePermission } from "@/lib/session";
import { deleteNinja, restoreNinja, updateNinja } from "../../actions";
import { prisma } from "@koeki/database";

export default async function EditNinjaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("ninjas:write");
  const { id } = await params;
  const query = await searchParams;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const ninja = demoMode ? null : await prisma.ninjaProfile.findUnique({ where: { id } });
  if (!demoMode && !ninja) notFound();
  return <div className="page-wrap">
    <PageHeader eyebrow={ninja ? `Dossier ${ninja.code}` : "Mode démonstration"} title="Modifier le dossier" description="Chaque modification est auditée. Le changement de grade se fait depuis la fiche (motif obligatoire)."
      actions={<Link className="button button-ghost" href={`/ninjas/${id}`}><ArrowLeft size={17} /> Retour à la fiche</Link>} />
    {error && <p className="notice error" role="alert">{error}</p>}
    {demoMode || !ninja ? <p className="notice" role="status">Mode démonstration : les écritures sont désactivées.</p> : ninja.status === "ARCHIVED" ? <section className="panel" style={{ maxWidth: 640 }}>
      <SectionHeader title="Dossier archivé" description="Son historique financier est conservé mais il n’apparaît plus dans les registres" />
      <form action={restoreNinja} className="form-grid">
        <input type="hidden" name="ninjaId" value={ninja.id} />
        <div className="form-actions"><button className="button button-primary" type="submit"><ArchiveRestore size={16} /> Restaurer le dossier</button></div>
      </form>
    </section> : <>
    <section className="panel" style={{ maxWidth: 640 }}>
      <SectionHeader title="Identité" description="Prénom et nom restent obligatoires" />
      <form action={updateNinja} className="form-grid">
        <input type="hidden" name="ninjaId" value={ninja.id} />
        <div className="form-row">
          <label>Prénom *<input type="text" name="firstName" required maxLength={80} defaultValue={ninja.firstName} /></label>
          <label>Nom *<input type="text" name="lastName" required maxLength={80} defaultValue={ninja.lastName} /></label>
        </div>
        <div className="form-row">
          <label>Pseudonyme<input type="text" name="alias" maxLength={80} defaultValue={ninja.alias ?? ""} /></label>
          <label>Clan ou famille<input type="text" name="clan" maxLength={80} defaultValue={ninja.clan ?? ""} /></label>
        </div>
        <label>État administratif<select name="status" defaultValue={ninja.status === "INACTIVE" ? "INACTIVE" : "ACTIVE"}><option value="ACTIVE">Actif</option><option value="INACTIVE">Inactif</option></select></label>
        <label>Notes internes<textarea name="notes" maxLength={2000} defaultValue={ninja.notes ?? ""} /></label>
        <div className="form-actions"><button className="button button-primary" type="submit"><Save size={16} /> Enregistrer</button></div>
      </form>
    </section>
    <section className="panel" style={{ maxWidth: 640, marginTop: 12, borderColor: "rgba(169,79,63,.48)" }}>
      <SectionHeader title="Supprimer le dossier" description="Sans historique financier : suppression définitive. Avec historique : archivage (le registre comptable reste intact)." />
      <form action={deleteNinja} className="form-grid">
        <input type="hidden" name="ninjaId" value={ninja.id} />
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" name="confirm" required style={{ minHeight: 0, width: 16, height: 16 }} /> Je confirme la suppression ou l’archivage de {ninja.firstName} {ninja.lastName} ({ninja.code})</label>
        <div className="form-actions"><button className="button button-ghost" type="submit" style={{ color: "var(--terracotta-300)", borderColor: "rgba(169,79,63,.48)" }}><Trash2 size={16} /> Supprimer / archiver</button></div>
      </form>
    </section>
    </>}
  </div>;
}
