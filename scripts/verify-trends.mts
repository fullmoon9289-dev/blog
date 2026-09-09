import path from "node:path";
import { newContext, closeQuietly } from "@/lib/playwright";
import { extractForTest } from "@/lib/scrape/trends";

console.log("\n[A] 수집 추출기 검증 (6-4) — 저장된 검색 결과 HTML 사용\n");
const { browser, context } = await newContext({ headless: true });
const page = await context.newPage();
await page.goto("file://" + path.resolve("scripts/harness/search-fixture.html"));

const news = await extractForTest(page, "news");
const blog = await extractForTest(page, "blog");
await closeQuietly(browser);

let fail = 0;
const t = (label: string, cond: boolean, detail = "") => {
  if (!cond) fail++;
  console.log(`  ${cond ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
};

console.log("  뉴스 추출 결과:");
for (const n of news) console.log(`     · ${n.title}`);
console.log("  블로그 추출 결과:");
for (const b of blog) console.log(`     · ${b.title}`);
console.log("");

t("고객센터(help.naver.com//alias/) 가 걸러졌다",
  !news.some((n) => n.url.includes("help.naver.com")));
t("'새 창 열림' 노이즈 항목이 제거됐다",
  !news.some((n) => n.title.includes("새 창 열림") || n.title === "네이버뉴스"));
t("노이즈 텍스트(언론사 선정 / 더보기)가 걸러졌다",
  !news.some((n) => /언론사 선정|더보기/.test(n.title)));
t("같은 URL 중복이 하나로 합쳐졌다",
  new Set(news.map((n) => n.url)).size === news.length,
  `${news.length}건 / 고유 URL ${new Set(news.map((n) => n.url)).size}개`);
t("중복 시 '제목이 더 짧은 쪽'이 남았다",
  news.some((n) => n.title === "전기차 보조금 개편안 내달 확정"));
t("본문 스니펫이 요약으로 살아남았다",
  news.some((n) => n.summary.includes("셈법이 복잡해지고")));
t("'새 창 열림'을 뗀 뒤 제목이 온전하다",
  news.some((n) => n.title === "충전 인프라 확충 속도 낸다"));
t("블로그는 게시글만 통과했다(홈·목록 탈락)",
  blog.length === 1 && blog[0].url.includes("/223456789012"),
  `${blog.length}건`);

console.log(`\n  ${fail === 0 ? "→ 수집 필터 8종 전부 통과" : `${fail}건 실패`}\n`);
process.exit(fail === 0 ? 0 : 1);
