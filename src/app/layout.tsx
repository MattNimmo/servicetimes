import type { Metadata } from "next";
import { Sora } from "next/font/google";

import "./globals.css";
import "./(instrument)/instrument.css";

const sora = Sora({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "ECC Service Times",
  description: "Plan-versus-actual service timing for Emmanuel Christian Center.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${sora.className} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
