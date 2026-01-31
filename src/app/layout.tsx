import type { Metadata } from "next";
import "./globals.css";
import AutoRefresh from "@/components/AutoRefresh";
import NavBar from "@/components/NavBar";

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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700&family=Source+Code+Pro:wght@400;500&family=Source+Sans+3:ital,wght@0,300;0,400;0,500;0,600;0,700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        <AutoRefresh />
        <NavBar />
        {children}
      </body>
    </html>
  );
}
