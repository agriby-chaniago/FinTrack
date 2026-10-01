import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";

import { MotionProvider } from "@/components/motion";
import { THEME_COOKIE, themeAttribute } from "@/lib/theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FinTrack",
  description: "Low-input personal cashflow tracking",
  applicationName: "FinTrack",
  appleWebApp: { capable: true, title: "FinTrack", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f5f1" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1316" },
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
      <body className="flex min-h-full flex-col">
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
