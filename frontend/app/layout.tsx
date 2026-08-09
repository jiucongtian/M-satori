import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "身心游 · 每一天，更懂自己一点",
  description: "从你的出生时刻出发，读懂当下的节律，找到适合自己的下一步。",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
