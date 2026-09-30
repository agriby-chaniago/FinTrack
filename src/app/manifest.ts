import type { MetadataRoute } from "next";

/**
 * Installable, online-only website (PRD: Installable website). There is no
 * service worker: nothing financial is cached for offline use.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "FinTrack",
    short_name: "FinTrack",
    description: "Pencatatan cashflow pribadi dengan input minimal.",
    lang: "id",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f8fa",
    theme_color: "#4f46e5",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
