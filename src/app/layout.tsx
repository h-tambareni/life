import type { Metadata } from "next";
import {
  Cormorant_Garamond,
  Source_Sans_3,
  Source_Code_Pro,
} from "next/font/google";
import "./globals.css";
import AutoRefresh from "@/components/AutoRefresh";

const headingSerif = Cormorant_Garamond({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const bodySans = Source_Sans_3({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const mono = Source_Code_Pro({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "life",
  description:
    "A personal dashboard for workouts, sleep, diet, and sobriety—crafted with a modern stoic aesthetic.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${headingSerif.variable} ${bodySans.variable} ${mono.variable} antialiased`}
      >
        <AutoRefresh />
        {children}
      </body>
    </html>
  );
}
