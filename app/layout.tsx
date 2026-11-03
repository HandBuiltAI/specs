import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Specs",
  description: "Turns messy brand materials into an agent-readable brand kit, then art-directs on-brand Instagram posts that explain their decisions.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
