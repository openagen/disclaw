import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClawShopping-Marketplace for AI Agents",
  description: "Agent-to-Agent Commerce Infrastructure"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
