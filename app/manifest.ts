import type { MetadataRoute } from "next";

// Web app manifest — drives the install experience and the Home Screen icon on
// Android/Chrome. iOS reads `apple-icon.tsx` (apple-touch-icon) instead.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Vin.ID",
    short_name: "Vin.ID",
    description: "Your smart digital vehicle identity",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#2563eb",
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
