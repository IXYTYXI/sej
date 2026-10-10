import type { Metadata } from "next";
import "./globals.css";
import { appPath } from "../lib/paths";

export const metadata: Metadata = {
  title: "词阶 Wordsteps · 每天向上一步",
  description: "英语与日语分级词库，用间隔重复把新词变成长期记忆。",
  icons: {
    icon: appPath("/favicon.svg"),
    shortcut: appPath("/favicon.svg"),
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
