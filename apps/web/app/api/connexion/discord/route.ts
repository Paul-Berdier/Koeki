import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { signIn, signOut } from "@/auth";
import { prisma } from "@koeki/database";
import { checkInvitation } from "@/lib/invitation-check";
import { INVITATION_COOKIE, invitationCookieOptions } from "@/lib/invitation-state";
import { readAuthStartForm, sameOriginAuthPost, trustedAuthOrigin } from "@/lib/auth-start-guard";

export const runtime = "nodejs";
const privateHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

/** Native form POST -> HTTP 303. Switching Discord accounts is not account linking. */
export async function POST(request: Request) {
  const origin = trustedAuthOrigin(process.env.AUTH_URL);
  if (!origin) return new NextResponse("Configuration de connexion indisponible", { status: 503, headers: privateHeaders });
  if (!sameOriginAuthPost(request.headers, origin)) return new NextResponse("Origine de connexion refusée", { status: 403, headers: privateHeaders });
  const form = await readAuthStartForm(request);
  if (!form || !["invitation", "connexion"].includes(form.get("intent") ?? "")) return new NextResponse("Formulaire invalide", { status: 400, headers: privateHeaders });
  const jar = await cookies();
  let inviteToken: string | null = null;
  if (form.get("intent") === "invitation") {
    const token = form.get("token");
    const check = await checkInvitation(token);
    if (!check.ok || !token) {
      jar.delete(INVITATION_COOKIE);
      return NextResponse.redirect(new URL(`/access-denied?error=${check.ok ? "InvitationInvalid" : check.error}`, origin), { status: 303, headers: privateHeaders });
    }
    const invitation = await prisma.invitation.findUnique({ where: { id: check.id }, select: { ninjaProfileId: true } });
    if (!invitation) return new NextResponse("Invitation indisponible", { status: 409, headers: privateHeaders });
    if (invitation.ninjaProfileId && (form.get("confirmIdentity") !== "on" || form.get("confirmedNinjaId") !== invitation.ninjaProfileId)) {
      jar.delete(INVITATION_COOKIE);
      return new NextResponse("Vérifiez le personnage indiqué sur l’invitation et confirmez qu’il s’agit bien du vôtre avant de continuer.", { status: 400, headers: privateHeaders });
    }
    inviteToken = token;
  } else if (form.has("token")) {
    return new NextResponse("Formulaire invalide", { status: 400, headers: privateHeaders });
  }
  try {
    // End only this browser's Kōeki session, after CSRF/input checks. Otherwise
    // Auth.js can attach a different Discord account to the still-signed-in user.
    await signOut({ redirect: false });
    jar.delete(INVITATION_COOKIE);
    if (inviteToken) jar.set(INVITATION_COOKIE, inviteToken, invitationCookieOptions());
    const destination: unknown = await signIn("discord", { redirect: false, redirectTo: "/" });
    if (typeof destination !== "string") throw new Error("INVALID_DESTINATION");
    const target = new URL(destination);
    if (target.origin !== "https://discord.com" || !["/api/oauth2/authorize", "/oauth2/authorize"].includes(target.pathname) || target.username || target.password) throw new Error("INVALID_DESTINATION");
    return NextResponse.redirect(target, { status: 303, headers: privateHeaders });
  } catch {
    jar.delete(INVITATION_COOKIE);
    console.warn("[auth] démarrage de la connexion indisponible");
    return NextResponse.redirect(new URL("/access-denied?error=Configuration", origin), { status: 303, headers: privateHeaders });
  }
}
