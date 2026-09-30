import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";

import { THEME_COOKIE, themeAttribute } from "@/lib/theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FinTrack",
  description: "Low-input personal cashflow tracking",
  applicationName: "FinTrack",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "FinTrack", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0f14" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The theme is resolved on the server so the first paint never flashes.
  const preference = (await cookies()).get(THEME_COOKIE)?.value;
  return (
    <html lang="id" data-theme={themeAttribute(preference)} className={`${geistSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
