import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "KŌEKI — Service économique de Suna", template: "%s · KŌEKI" },
  description: "Administration économique privée du village fictif de Suna.",
  robots: { index: false, follow: false, nocache: true }
};

export const viewport: Viewport = { colorScheme: "dark", themeColor: "#17140f" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // A per-request CSP nonce can only be attached while rendering dynamically.
  await connection();
  return <html lang="fr"><body>{children}</body></html>;
}
