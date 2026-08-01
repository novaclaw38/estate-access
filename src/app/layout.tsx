import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Estate Security Manager",
  description: "Visitor pre-clearance and gate access control",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
