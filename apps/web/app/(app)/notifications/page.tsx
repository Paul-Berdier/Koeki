import Link from "next/link";
import { prisma } from "@koeki/database";
import { PageHeader, EmptyState } from "@koeki/ui";
import { demoMode, requirePermission } from "@/lib/session";
import { readNotification } from "./actions";

export default async function NotificationsPage() {
  const session = await requirePermission("self:read");
  const notifications = demoMode ? [] : await prisma.notification.findMany({ where: { userId: session.userId, status: { not: "ARCHIVED" } }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, title: true, body: true, status: true, href: true, createdAt: true } });
  return <div className="page-wrap"><PageHeader eyebrow="Communication interne" title="Mes notifications" description="Les 50 dernières notifications destinées à votre compte. L’accès au contenu est à nouveau contrôlé lors de son ouverture." />{notifications.length ? notifications.map((notification) => <section className="panel" key={notification.id}><h2>{notification.title}</h2><p>{notification.status === "UNREAD" ? "Non lue" : "Lue"} · {notification.createdAt.toLocaleString("fr-FR")}</p><p>{notification.body}</p>{notification.href && /^\/(taches|reports|ninjas)(\/|\?|$)/.test(notification.href) && <Link className="button button-ghost" href={notification.href}>Ouvrir</Link>}{notification.status === "UNREAD" && <form action={readNotification}><input type="hidden" name="notificationId" value={notification.id} /><button className="button button-ghost">Marquer comme lue</button></form>}</section>) : <EmptyState title="Aucune notification" description="Les affectations et décisions de rapport apparaîtront ici." />}</div>;
}
