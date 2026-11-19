import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";
import { LangProvider } from "@/lib/i18n/client";
import { getLang } from "@/lib/i18n/server";
import { getSetting } from "@/lib/settings";
import { cookies } from "next/headers";

export async function generateMetadata(): Promise<Metadata> {
  const school = await getSetting("school");
  return {
    title: { default: school.name, template: `%s · ${school.name}` },
    description: "School Management System — stationery, uniforms, fees and transport in one place",
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, title: school.name, statusBarStyle: "default" },
    icons: { icon: "/icon.svg", apple: "/icon-192.png" },
  };
}

export const viewport: Viewport = { themeColor: "#0e0e10", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  // Dark by default; "light" when the user switched (theme cookie). Rendered on the server, so there is no flash.
  const theme = (await cookies()).get("theme")?.value === "light" ? "light" : "dark";
  return (
    <html lang={lang} className={theme === "dark" ? "dark" : undefined}>
      <body className="min-h-screen">
        <LangProvider lang={lang}>
          <ToastProvider>{children}</ToastProvider>
        </LangProvider>
      </body>
    </html>
  );
}
