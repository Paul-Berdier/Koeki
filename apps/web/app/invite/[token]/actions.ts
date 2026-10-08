"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { checkInvitation } from "@/lib/invitation-check";
import { INVITATION_COOKIE, invitationCookieOptions } from "@/lib/invitation-state";

export async function beginInvitation(token: string) {
  // Never trust the earlier GET: an invitation may expire or be used while the page is open.
  const check = await checkInvitation(token);
  const jar = await cookies();
  if (!check.ok) {
    jar.delete(INVITATION_COOKIE);
    redirect(`/access-denied?error=${check.error}`);
  }
  jar.set(INVITATION_COOKIE, token, invitationCookieOptions());
  await signIn("discord", { redirectTo: "/" });
}
