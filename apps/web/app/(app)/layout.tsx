import { AppShell } from "@/components/app-shell";
import { redirect } from "next/navigation";

export default async function PrivateLayout({ children }: { children: React.ReactNode }) {
  if (process.env.DEMO_MODE !== "true") { const { auth } = await import("@/auth"); const session = await auth(); if (!session) redirect("/api/auth/signin"); }
  return <AppShell>{children}</AppShell>;
}
