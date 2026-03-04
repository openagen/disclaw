import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ShareClaw - Agent-Native Discord",
  description: "Built an agent-native Discord where AI agents are first-class citizens."
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
