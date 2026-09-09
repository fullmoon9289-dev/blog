import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import type { BrowserContext, Page } from "playwright";
import { newContext, closeQuietly } from "@/lib/playwright";
import { NAVER } from "@/lib/scrape/selectors";
import { PATHS, ensureDataDirs } from "@/lib/paths";
import { judgeCrawlImage, verdictReason } from "@/lib/ai/vision";
import type { CrawlVerdict } from "@/lib/types";

/**
 * 크롤링 사진 (6-6)
 * 한 자리(query)당: 네이버 이미지 검색 → 실패 시 구글 → 후보를 하나씩 다운로드
 *                  → AI 가 직접 보고 판정 → 첫 통과 이미지 채택
 */

/** 브라우저 안에서 실행되는 후보 수집기. */
function collectImgSrcs(limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const img of Array.from(document.querySelectorAll("img"))) {
    const el = img as HTMLImageElement;
    const src = el.currentSrc || el.src;
    if (!src || !/^https?:/.test(src)) continue;
    // 아이콘·스프라이트·로고 제거
    if (el.naturalWidth > 0 && el.naturalWidth < 120) continue;
    if (/sprite|logo|icon|blank|\.svg/i.test(src)) continue;
    if (seen.has(src)) continue;
    seen.add(src);
    out.push(src);
    if (out.length >= limit) break;
  }
  return out;
}

async function candidatesFrom(page: Page, url: string, limit: number): Promise<string[]> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    // lazy 로딩을 유도합니다.
    await page.mouse.wheel(0, 2200);
    await page.waitForTimeout(1500);
    return await page.evaluate(collectImgSrcs, limit);
  } catch {
    return [];
  }
}

/** ⚠️ 3000바이트 미만은 아이콘/깨진 이미지입니다. 버립니다. */
const MIN_BYTES = 3000;

async function download(
  context: BrowserContext,
  url: string,
  destDir: string,
): Promise<string | null> {
  try {
    const res = await context.request.get(url, { timeout: 20000 });
    if (!res.ok()) return null;
    const buf = await res.body();
    if (buf.length < MIN_BYTES) return null;

    const ct = res.headers()["content-type"] ?? "";
    const ext = /png/.test(ct) ? "png" : /webp/.test(ct) ? "webp" : /gif/.test(ct) ? "gif" : "jpg";
    const name = crypto.createHash("sha1").update(url).digest("hex").slice(0, 16) + "." + ext;
    const dest = path.join(destDir, name);
    fs.writeFileSync(dest, buf);
    return dest;
  } catch {
    return null;
  }
}

export type ImageAttempt = {
  srcUrl: string;
  localPath: string | null;
  sourceSite: "naver" | "google";
  verdict: CrawlVerdict;
};

export type SlotResult = {
  accepted: { localPath: string; srcUrl: string; sourceSite: "naver" | "google" } | null;
  attempts: ImageAttempt[];
};

/**
 * 이미지 자리 하나를 채웁니다.
 * ⚠️ 6-6. 크롤링 채택률은 생각보다 훨씬 낮습니다. 한 실측에서 네이버 후보 3장이 전부
 *   워터마크로 탈락했습니다(네이버페이 배너 / 손글씨 서명 / 브랜드 로고 합성 썸네일).
 *   imageCandidates 를 낮추면 그 자리가 그냥 빕니다. 실사용에서는 10 이상 권장.
 */
export async function fillOneSlot(
  jobDir: string,
  ctx: { query: string; title: string; around?: string },
  candidateLimit: number,
  onLog?: (msg: string) => void,
): Promise<SlotResult> {
  ensureDataDirs();
  fs.mkdirSync(jobDir, { recursive: true });

  const { browser, context } = await newContext({ headless: true });
  const attempts: ImageAttempt[] = [];
  try {
    const page = await context.newPage();

    let site: "naver" | "google" = "naver";
    let urls = await candidatesFrom(page, NAVER.imageSearch(ctx.query), candidateLimit);
    if (urls.length === 0) {
      site = "google";
      urls = await candidatesFrom(page, NAVER.googleImageSearch(ctx.query), candidateLimit);
    }
    onLog?.(`"${ctx.query}" 후보 ${urls.length}장 (${site === "naver" ? "네이버" : "구글"})`);

    for (const url of urls) {
      const local = await download(context, url, jobDir);
      if (!local) {
        attempts.push({
          srcUrl: url, localPath: null, sourceSite: site,
          verdict: { fit: false, watermark: false, koreanPerson: false, reason: "내려받기 실패 또는 너무 작은 이미지" },
        });
        continue;
      }
      const verdict = await judgeCrawlImage(local, ctx);
      attempts.push({ srcUrl: url, localPath: local, sourceSite: site, verdict });

      if (verdict.fit) {
        onLog?.(`채택: ${verdict.reason}`);
        return { accepted: { localPath: local, srcUrl: url, sourceSite: site }, attempts };
      }
      onLog?.(`탈락: ${verdictReason(verdict)}`);
      // 탈락한 파일은 지우지 않습니다 — 사용자가 필터 동작을 확인할 수 있어야 합니다.
    }
    return { accepted: null, attempts };
  } finally {
    await closeQuietly(browser);
  }
}

export function jobImageDir(jobId: number): string {
  return path.join(PATHS.images, `job-${jobId}`);
}
