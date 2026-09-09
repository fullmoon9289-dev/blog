import type { Page } from "playwright";
import { newContext, closeQuietly } from "@/lib/playwright";
import { NAVER } from "@/lib/scrape/selectors";
import type { SourceItem } from "@/lib/types";

/**
 * 뉴스·블로그 수집 (6-4)
 *
 * ⚠️ 셀렉터에 의존하지 마세요. 네이버 검색 DOM 은 자주 바뀝니다.
 *    page.evaluate 안에서 "모든 a[href] 를 훑는 일반 추출"로 구현합니다.
 */

type RawLink = { title: string; summary: string; url: string };

/**
 * 브라우저 안에서 실행되는 추출기.
 * ⚠️ 이 함수는 page.evaluate 로 넘어가므로 바깥 스코프를 참조할 수 없습니다.
 *    모든 상수를 인자로 받습니다.
 */
function extractInPage(kind: "news" | "blog"): RawLink[] {
  const NOISE = /광고|로그인|더보기|바로가기|언론사 선정|구독/;
  const BLOG_POST = /blog\.naver\.com\/[^/]+\/\d{6,}/;
  const out: RawLink[] = [];

  for (const a of Array.from(document.querySelectorAll("a[href]"))) {
    const href = (a as HTMLAnchorElement).href || "";
    if (!href) continue;

    // ⚠️ 6-4. href 에 '/news/' 포함 조건에 네이버 고객센터가 부분일치합니다.
    //    https://help.naver.com/alias/news/news_21.naver 가 걸려서
    //    "뉴스 기사와 댓글로 인한 문제 발생시 24시간 센터로 접수해주세요" 가 AI 자료로 들어갑니다.
    //    7-1 / 7-2 와 같은 부분일치 계열입니다.
    if (href.includes("help.naver.com") || href.includes("/alias/")) continue;

    let matches: boolean;
    if (kind === "news") {
      matches = href.includes("news.naver.com") || href.includes("/news/") || href.includes("n.news");
    } else {
      // 블로그는 "게시글 패턴"에 정확히 매칭되어야 합니다(블로그 홈 링크를 걸러내기 위해).
      matches = BLOG_POST.test(href);
    }
    if (!matches) continue;

    // ⚠️ 6-4. '새 창 열림' 은 스크린리더용 보조 텍스트인데 11자라서 길이 필터를 그냥 통과합니다.
    //    ("네이버뉴스새 창 열림" 같은 항목이 남습니다) 반드시 "먼저 제거한 뒤" 길이·노이즈 필터.
    const rawText = (a.textContent || "").replace(/\s+/g, " ").trim();
    const title = rawText.replace(/새 ?창 ?열림/g, "").replace(/\s+/g, " ").trim();

    if (title.length < 8) continue;
    if (NOISE.test(title)) continue;

    // 요약: 링크를 감싼 li/div 의 텍스트에서 링크 텍스트를 뺀 나머지
    const box = a.closest("li, div");
    const boxText = (box?.textContent || "").replace(/\s+/g, " ").trim();
    const summary = boxText.replace(rawText, "").replace(/\s+/g, " ").trim().slice(0, 260);

    out.push({ title, summary, url: href });
  }
  return out;
}

/**
 * ⚠️ 6-4. 같은 기사가 [제목 링크] + [본문 스니펫 링크] 로 두 번 잡힙니다.
 *    URL 당 하나만 남기되 "제목이 더 짧은 쪽"을 고릅니다(스니펫은 길고 문장형).
 *    같은 기사가 두 번 들어가면 AI 프롬프트가 오염됩니다.
 *    그다음 제목 앞 40자를 키로 한 번 더 중복 제거합니다.
 */
export function dedupe(links: RawLink[]): RawLink[] {
  const byUrl = new Map<string, RawLink>();
  for (const l of links) {
    const prev = byUrl.get(l.url);
    if (!prev || l.title.length < prev.title.length) {
      // 요약은 더 긴 쪽을 살립니다(스니펫 쪽에 내용이 있는 경우가 많습니다).
      byUrl.set(l.url, {
        ...l,
        summary: (prev && prev.summary.length > l.summary.length) ? prev.summary : l.summary,
      });
    } else if (l.summary.length > prev.summary.length) {
      byUrl.set(l.url, { ...prev, summary: l.summary });
    }
  }

  const byTitle = new Map<string, RawLink>();
  for (const l of byUrl.values()) {
    const key = l.title.slice(0, 40);
    if (!byTitle.has(key)) byTitle.set(key, l);
  }
  return [...byTitle.values()];
}

async function scrapeOne(page: Page, url: string, kind: "news" | "blog"): Promise<RawLink[]> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1200);
  const raw = await page.evaluate(extractInPage, kind);
  return dedupe(raw);
}

export async function collectSources(
  keyword: string,
  topN: number,
  opts: { headless?: boolean } = {},
): Promise<{ ok: true; items: SourceItem[] } | { ok: false; error: string }> {
  const { browser, context } = await newContext({ headless: opts.headless ?? true });
  try {
    const page = await context.newPage();
    const news = await scrapeOne(page, NAVER.newsSearch(keyword), "news");
    const blogs = await scrapeOne(page, NAVER.blogSearch(keyword), "blog");

    const half = Math.max(2, Math.ceil(topN / 2));
    const items: SourceItem[] = [
      ...news.slice(0, half).map((l) => ({ type: "news" as const, ...l })),
      ...blogs.slice(0, half).map((l) => ({ type: "blog" as const, ...l })),
    ].slice(0, topN);

    if (items.length === 0) {
      return { ok: false, error: "검색 결과에서 읽을 만한 글을 찾지 못했습니다. 키워드를 바꿔보세요." };
    }
    return { ok: true, items };
  } catch (e) {
    return { ok: false, error: `수집 중 문제가 생겼습니다: ${(e as Error).message}` };
  } finally {
    await closeQuietly(browser);
  }
}

/** 테스트용: 저장된 HTML 에 대해 추출기만 돌립니다(네트워크 불필요). */
export async function extractForTest(page: Page, kind: "news" | "blog"): Promise<RawLink[]> {
  return dedupe(await page.evaluate(extractInPage, kind));
}
