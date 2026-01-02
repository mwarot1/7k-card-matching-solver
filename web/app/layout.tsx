import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { OpenCVProvider } from "../utils/opencv-loader";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "CardSolverV3 | AI Mathching Solver",
  description: "Advanced AI-powered card matching solver for 7k Minigames",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <OpenCVProvider>
          {children}
        </OpenCVProvider>
      </body>
    </html>
  );
}
