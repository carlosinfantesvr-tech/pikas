import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Outfit } from "next/font/google";
import { Shell } from "@/components/shell";
import "./globals.css";

const outfit = Outfit({ subsets: ["latin"], variable: "--font-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "PIKAS",
  description: "Simulación educativa de trading. Sin dinero real.",
  applicationName: "PIKAS",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "PIKAS", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#08090d",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${outfit.variable} ${mono.variable}`}>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
