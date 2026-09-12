import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { OfflinePlayerHost } from "@/components/offline-player-host";
import { DownloadDoneNotifier } from "@/components/download-row";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TV Time",
  description: "Personal TV and movie tracker",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "TV Time",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  // Pinch zoom allowed (a11y); double-tap zoom is already suppressed where
  // it matters by touch-manipulation on the player, so seek taps are safe.
  maximumScale: 5,
  userScalable: true,
  // Edge-to-edge under notch / home indicator (standalone PWA)
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
      </head>
      <body className="min-h-full min-h-dvh bg-black text-white">
        <Providers>
          <DownloadDoneNotifier />
          {children}
        </Providers>
        <OfflinePlayerHost />
      </body>
    </html>
  );
}
