"use server";
import { prisma } from "@koeki/database";
import { redirect } from "next/navigation";
import { requireWriteAccess } from "@/lib/session";
import { assertTeamActor } from "@/lib/team-service";

export async function readNotification(formData: FormData) {
  const session = await requireWriteAccess("self:read");
  const id = String(formData.get("notificationId") ?? "");
  await prisma.$transaction(async (tx) => {
    await assertTeamActor(tx, session.userId, "self:read");
    await tx.notification.updateMany({ where: { id, userId: session.userId, status: "UNREAD" }, data: { status: "READ" } });
  });
  redirect("/notifications");
}
