import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { MoneyDisplay, PageHeader } from "@koeki/ui";
import { NinjaRegister } from "@/components/ninja-register";
import { getNinjas } from "@/lib/data";
import { demoMode, hasPermission, requireSession } from "@/lib/session";
import { prisma } from "@koeki/database";

export default async function NinjasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  if (!demoMode && session.roles.length === 1 && session.roles[0] === "NINJA") {
    const own = await prisma.ninjaProfile.findUnique({
      where: { userId: session.userId },
      select: { id: true },
    });
    redirect(own ? `/ninjas/${own.id}` : "/profil");
  }
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const grade =
    typeof params.grade === "string" && params.grade ? params.grade : undefined;
  const statut =
    typeof params.statut === "string" && params.statut
      ? params.statut
      : undefined;
  // The whole register (for the chosen grade / situation) is loaded once; the text search
  // filters it in the browser, so typing never re-renders the page from the server.
  const assignedToMe = params.mesDossiers === "1";
  const data = await getNinjas({ grade, statut, assignedToMe });
  const canWrite = hasPermission(session, "ninjas:write");
  const info = typeof params.info === "string" ? params.info : null;
  const error = typeof params.erreur === "string" ? params.erreur : null;
  const rows = data.ninjas.map((ninja) => ({
    ...ninja,
    debt: ninja.debt.toString(),
  }));
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="Dossiers"
        title="Ninjas"
        description={
          assignedToMe
            ? "Vos dossiers attribués : ouvrez une fiche pour poursuivre le suivi."
            : "Retrouvez une identité, consultez sa situation et enregistrez ses opérations."
        }
        metrics={[
          {
            label: "Dossiers",
            value: new Intl.NumberFormat("fr-FR").format(data.stats.total),
          },
          {
            label: "À régulariser",
            value: (
              <Link href="/ninjas?statut=overdue">
                {new Intl.NumberFormat("fr-FR").format(data.stats.overdue)}
              </Link>
            ),
          },
          {
            label: "Grades à renseigner",
            value: (
              <Link href="/ninjas?statut=grade_missing">
                {new Intl.NumberFormat("fr-FR").format(data.stats.needsUpdate)}
              </Link>
            ),
          },
          {
            label: "Dette totale",
            value: <MoneyDisplay amount={data.stats.debt} />,
          },
        ]}
        actions={
          canWrite ? (
            <Link className="button button-primary" href="/ninjas/new">
              <Plus size={17} /> Nouveau ninja
            </Link>
          ) : undefined
        }
      />
      {info && (
        <p className="notice" role="status">
          {info}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div
        className="form-actions"
        role="group"
        aria-label="Périmètre des dossiers"
      >
        <Link
          className={`button ${assignedToMe ? "button-ghost" : "button-primary"}`}
          href="/ninjas"
          aria-current={!assignedToMe ? "page" : undefined}
        >
          Tous les dossiers
        </Link>
        {hasPermission(session, "tasks:read") && (
          <Link
            className={`button ${assignedToMe ? "button-primary" : "button-ghost"}`}
            href="/ninjas?mesDossiers=1"
            aria-current={assignedToMe ? "page" : undefined}
          >
            Mes dossiers
          </Link>
        )}
      </div>
      <NinjaRegister
        ninjas={rows}
        grades={data.grades}
        initialQuery={q}
        initialGrade={grade ?? ""}
        initialStatut={statut ?? ""}
      />
    </div>
  );
}
