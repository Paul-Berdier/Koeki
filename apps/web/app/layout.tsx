import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "KŌEKI — Service économique de Suna", template: "%s · KŌEKI" },
  description: "Administration économique privée du village fictif de Suna.",
  robots: { index: false, follow: false, nocache: true }
};

export const viewport: Viewport = { colorScheme: "dark", themeColor: "#17140f" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><body>{children}</body></html>;
}
