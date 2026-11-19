import type { MetadataRoute } from "next";
import { getSetting } from "@/lib/settings";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const school = await getSetting("school");
  return {
    name: school.name,
    short_name: school.name.split(" ").slice(0, 2).join(" "),
    description: "Fees, uniforms, bus and school updates",
    start_url: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#4f46e5",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
