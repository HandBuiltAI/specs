import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import "./ui/catalog.css";
import { THEME_SCRIPT, ThemeToggle } from "./ui/theme.tsx";

export const metadata: Metadata = {
  title: "Specs",
  description: "Turns messy brand materials into an agent-readable brand kit, then art-directs on-brand Instagram posts that explain their decisions.",
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ececea" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0e" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme is set before paint by THEME_SCRIPT, so the server and browser markup differ on purpose.
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <header className="topbar">
          <Link href="/" className="wordmark" aria-label="Specs home">
            Specs<i aria-hidden="true" />
          </Link>
          <nav>
            <Link href="/build">Build a kit</Link>
            <Link href="/catalog">Components</Link>
            <ThemeToggle />
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
