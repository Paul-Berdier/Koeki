import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { signIn } from "@/auth";
import { checkInvitation } from "@/lib/invitation-check";
import { INVITATION_COOKIE, invitationCookieOptions } from "@/lib/invitation-state";
import { readAuthStartForm, sameOriginAuthPost, trustedAuthOrigin } from "@/lib/auth-start-guard";

export const runtime = "nodejs";
const privateHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

/** Native form POST -> HTTP 303, not a client router/RSC fetch of the Discord origin. */
export async function POST(request: Request) {
  const origin = trustedAuthOrigin(process.env.AUTH_URL);
  if (!origin) return new NextResponse("Configuration de connexion indisponible", { status: 503, headers: privateHeaders });
  // This endpoint replaces the Server Action entry point, so it explicitly keeps
  // same-origin CSRF enforcement before any cookie is set or OAuth request starts.
  if (!sameOriginAuthPost(request.headers, origin)) return new NextResponse("Origine de connexion refusée", { status: 403, headers: privateHeaders });
  const form = await readAuthStartForm(request);
  if (!form || !["invitation", "connexion"].includes(form.get("intent") ?? "")) return new NextResponse("Formulaire invalide", { status: 400, headers: privateHeaders });
  const jar = await cookies();
  if (form.get("intent") === "invitation") {
    const token = form.get("token");
    const check = await checkInvitation(token);
    if (!check.ok || !token) {
      jar.delete(INVITATION_COOKIE);
      return NextResponse.redirect(new URL(`/access-denied?error=${check.ok ? "InvitationInvalid" : check.error}`, origin), { status: 303, headers: privateHeaders });
    }
    jar.set(INVITATION_COOKIE, token, invitationCookieOptions());
  } else if (form.has("token")) {
    return new NextResponse("Formulaire invalide", { status: 400, headers: privateHeaders });
  }
  try {
    const destination: unknown = await signIn("discord", { redirect: false, redirectTo: "/" });
    if (typeof destination !== "string") throw new Error("INVALID_DESTINATION");
    const target = new URL(destination);
    if (target.origin !== "https://discord.com" || !["/api/oauth2/authorize", "/oauth2/authorize"].includes(target.pathname) || target.username || target.password) throw new Error("INVALID_DESTINATION");
    return NextResponse.redirect(target, { status: 303, headers: privateHeaders });
  } catch {
    console.warn("[auth] démarrage de la connexion indisponible");
    return NextResponse.redirect(new URL("/access-denied?error=Configuration", origin), { status: 303, headers: privateHeaders });
  }
}
