import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/Navbar";

export const metadata: Metadata = {
  title: "IzzyCheck — Weryfikacja Pojazdów & Audatex Raporty B2B",
  description: "Aplikacja B2B dla operatorów Izzy Lease do automatycznej weryfikacji wyceny i historii szkód VIN Audatex.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pl" className="dark">
      <body className="bg-slate-950 text-slate-100 antialiased selection:bg-blue-600 selection:text-white">
        <Navbar />
        <main className="min-h-[calc(100vh-4rem)] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black">
          {children}
        </main>
      </body>
    </html>
  );
}
