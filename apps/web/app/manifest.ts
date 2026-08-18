import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "KŌEKI — Service économique de Suna",
    short_name: "KŌEKI",
    description: "Administration économique privée du village fictif de Suna.",
    start_url: "/",
    display: "standalone",
    background_color: "#17140f",
    theme_color: "#c4943e",
    lang: "fr",
    icons: [
      { src: "/icons/koeki-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/koeki-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/koeki-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
