import type { Metadata } from "next";
import { Bricolage_Grotesque, Noto_Sans_TC, Shippori_Mincho } from "next/font/google";
import "./globals.css";

const body = Noto_Sans_TC({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
});

const display = Shippori_Mincho({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

const accent = Bricolage_Grotesque({
  variable: "--font-accent",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "日本音樂香港演出表",
  description: "追蹤日本歌手、樂隊、VTuber 及虛擬歌手來港演出的香港中文演出表。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-Hant-HK"
      className={`${body.variable} ${display.variable} ${accent.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
