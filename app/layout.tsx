import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Jugnus",
  description: "Tell Jugnus what you want done. Your AI team figures out the rest.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className={`${geist.className} h-full bg-gray-50 text-gray-900 antialiased`}>
        {children}
      </body>
    </html>
  );
}
