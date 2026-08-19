import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin", "cyrillic"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin", "cyrillic"] });

export const metadata: Metadata = {
  title: "Побег по алиби — реальный билет, убедительная причина",
  description: "Абсурдный планировщик побега на живых данных Tutu.ru MCP.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "Побег по алиби",
    description: "Реальный билет. Убедительная причина.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Побег по алиби" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
