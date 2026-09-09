import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "네이버 블로그 자동화",
  description: "AI 가 글감을 찾고, 글을 쓰고, 사진을 구해 네이버 블로그에 올립니다.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
