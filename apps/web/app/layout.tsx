import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FlowProcure",
  description: "Enterprise procurement without the friction",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
