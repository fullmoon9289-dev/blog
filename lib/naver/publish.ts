import fs from "node:fs";
import path from "node:path";
import type { Browser, FrameLocator, Locator, Page } from "playwright";
import { newContext, closeQuietly } from "@/lib/playwright";
import { EDITOR, NAVER, POST_URL_RE } from "@/lib/scrape/selectors";
import { PATHS, ensureDataDirs } from "@/lib/paths";
import { stripMarkdown } from "@/lib/ai/content";
import type { Draft, Section } from "@/lib/types";
import type { VisibilityKey } from "@/config";

/**
 * ★★ 에디터 자동화 (6-9) — 이 프로젝트의 90%
 *
 * ⚠️ 7장 함정 목록을 먼저 읽으세요. 이 파일의 이상해 보이는 코드는 전부 이유가 있습니다.
 *    "정리"하려다 되살아나는 버그들입니다. 각 함정 옆의 ⚠️ 주석을 지우지 마세요.
 */

/** iframe 안이든 바깥이든 똑같이 다룰 수 있는 범위. */
type Scope = FrameLocator | Page;

// ── 기본 헬퍼 ─────────────────────────────────────────────────────

/**
 * ⚠️ 7-27. boundingBox() 는 요소가 없으면 Playwright 기본 30초를 기다립니다.
 *   탈출 클릭은 인용구·구분선·캡션마다 있으므로 누적되어, 한 사례에서 실행이
 *   44초 → 5분 초과로 늘어났습니다. 모든 boundingBox 에 timeout 을 줍니다.
 */
const BOX_TIMEOUT = 800;

async function boxOf(loc: Locator): Promise<{ x: number; y: number; width: number; height: number } | null> {
  try {
    return await loc.boundingBox({ timeout: BOX_TIMEOUT });
  } catch {
    return null;
  }
}

/** 후보 배열에서 위에서부터 보이는 첫 번째를 돌려줍니다. */
async function firstVisible(scope: Scope, sels: readonly string[]): Promise<Locator | null> {
  for (const sel of sels) {
    const loc = scope.locator(sel).first();
    try {
      if (await loc.isVisible({ timeout: 400 })) return loc;
    } catch { /* 다음 후보 */ }
  }
  return null;
}

async function countAny(scope: Scope, sels: readonly string[]): Promise<number> {
  let n = 0;
  for (const sel of sels) {
    try { n += await scope.locator(sel).count(); } catch { /* 무시 */ }
  }
  return n;
}

/**
 * ⚠️ 6-9. clickAnywhere 는 선택이 아니라 필수입니다.
 *   발행 버튼과 공개 범위 라디오가 iframe 안에 있는지 밖에 있는지는 환경에 따라 다릅니다.
 *   이 문서를 쓴 환경에서는 밖이었고, 구현한 사람의 환경에서는 안이었습니다.
 *   반드시 두 곳을 모두 뒤집니다.
 */
async function findAnywhere(
  page: Page, frame: FrameLocator, sels: readonly string[],
): Promise<{ loc: Locator; where: "frame" | "page" } | null> {
  const inFrame = await firstVisible(frame, sels);
  if (inFrame) return { loc: inFrame, where: "frame" };
  const inPage = await firstVisible(page, sels);
  if (inPage) return { loc: inPage, where: "page" };
  return null;
}

async function clickAnywhere(
  page: Page, frame: FrameLocator, sels: readonly string[],
): Promise<boolean> {
  const found = await findAnywhere(page, frame, sels);
  if (!found) return false;
  try { await found.loc.click({ timeout: 5000 }); return true; } catch { return false; }
}

const sleep = (p: Page, ms: number) => p.waitForTimeout(ms);

// ── 타이핑 (7-8 / 7-25) ──────────────────────────────────────────

const HAS_VS16 = /️/;
/** ⚠️ 7-25. ⚠️ ❤️ ✔️ ☀️ 1️⃣ 처럼 변이 선택자가 붙은 클러스터. */
const VS16_CLUSTER = /([\s\S]️⃣?)/;

/**
 * ⚠️★ 7-25. 변이 선택자(VS16, U+FE0F)가 붙은 이모지는 base 문자가 하나 더 남습니다.
 *   보냄: U+5B U+26A0 U+FE0F U+5D        ("[⚠️]")
 *   받음: U+5B U+26A0 U+26A0 U+FE0F U+5D ("[⚠⚠️]")  ❌
 *
 * ⚠️ 해법의 함정: 고치겠다고 문단 "전체"를 insertText 로 넣으면
 *   이모지 하나만 남고 나머지 글이 통째로 사라집니다(실측).
 *   반드시 VS16 클러스터"만" 잘라서 그 조각만 insertText 하고, 나머지는 type 으로 칩니다.
 */
async function typeText(page: Page, text: string): Promise<void> {
  // ⚠️ 7-8. 타이핑 직전에 마크다운을 무력화합니다. AI 에게 지시하는 것만으로는 부족합니다.
  const clean = stripMarkdown(text);
  if (!clean) return;

  /**
   * ⚠️ 앞 공백은 keyboard.type 으로 넣으면 사라집니다 (직접 측정해 확인한 결함).
   *   증상: 형광펜 구절 뒤 문장이 "…섞여있어요" 로 붙어버림(원문은 "…섞여 있어요").
   *   측정: 빈 contenteditable 에서는 안 사라졌지만(가설 기각), 서식 버튼을 눌러
   *        포커스가 오간 뒤 이어 치면 사라졌습니다.
   *          type      → "같은 기호가 섞여있어요"
   *          insertText → "같은 기호가 섞여 있어요"
   *   문단을 [앞부분][강조구절][뒷부분] 으로 쪼개는 형광펜 처리에서 항상 발생합니다.
   *   ⚠️ 문단 "전체"를 insertText 로 넣으면 안 됩니다 — 7-25 의 함정입니다.
   *      앞 공백만 잘라서 그 조각만 insertText 합니다.
   */
  const lead = clean.match(/^\s+/)?.[0] ?? "";
  if (lead) await page.keyboard.insertText(lead);
  const rest = clean.slice(lead.length);
  if (!rest) return;

  if (!HAS_VS16.test(rest)) {
    await page.keyboard.type(rest, { delay: 7 });
    return;
  }
  for (const part of rest.split(VS16_CLUSTER)) {
    if (!part) continue;
    if (HAS_VS16.test(part)) await page.keyboard.insertText(part);
    else await page.keyboard.type(part, { delay: 7 });
  }
}

// ── 오버레이 닫기 (7-3 / 7-4 / 7-21) ─────────────────────────────

/**
 * ⚠️ 7-21. 사진을 넣으면 우측 "라이브러리" 도크가 자동으로 열려 본문을 덮습니다.
 *   이 도크의 클래스는 환경에 따라 다릅니다 — 한 환경에서는 도움말 계열과 같이 닫혔지만,
 *   다른 환경에서는 .se-help-panel-close-button 이 0개이고 .se-sidebar-close-button 만 있었습니다.
 *   두 계열을 모두 닫고, 어느 쪽도 없으면 Escape.
 *
 * ⚠️ 연습 모드의 산출물은 스크린샷 하나뿐입니다. 우측이 가려지면 검증 자체가 불가능합니다.
 *   그래서 스크린샷 "앞뒤로 두 번" 부릅니다.
 */
async function closeOverlays(page: Page, frame: FrameLocator, log: (m: string) => void): Promise<void> {
  let closed = 0;
  for (const sel of EDITOR.sidebarClose) {
    for (let i = 0; i < 3; i++) {
      const loc = await firstVisible(frame, [sel]) ?? await firstVisible(page, [sel]);
      if (!loc) break;
      try { await loc.click({ timeout: 2500 }); closed++; await sleep(page, 250); } catch { break; }
    }
  }
  // 그래도 남아 있으면 Escape
  const stillOpen = (await countAny(frame, EDITOR.sidebar)) + (await countAny(frame, EDITOR.helpPanel));
  if (stillOpen > 0 && closed === 0) {
    await page.keyboard.press("Escape");
    await sleep(page, 250);
    log("도움말/사이드바 닫기 버튼을 못 찾아 Escape 로 닫았습니다.");
  }
}

// ── 탈출 클릭 (7-5 / 7-6) ────────────────────────────────────────

/**
 * ⚠️★ 7-5. 인용구가 다음 문단을 통째로 삼킵니다.
 *   시도했으나 전부 실패한 것들: ArrowDown / Enter 두 번 / Escape / Ctrl+End
 *   — 컴포넌트 안에서는 "어떤 키로도" 탈출되지 않습니다.
 *   더 나쁜 것: 인용구 안에서 '본문' 서식을 적용하면 인용구가 통째로 평범한 텍스트로 환원됩니다.
 *   유일한 해결은 마우스로 마지막 컴포넌트 "아래 빈 영역"을 클릭하는 것입니다.
 *
 * ⚠️ 7-6. y 좌표를 아무렇게나 잡으면 화면 맨 아래 '글감 검색바'를 눌러버립니다.
 *   그러면 이후 캡션이 검색창에 타이핑되고 글감 패널이 열립니다. 실측 y=815.
 *   상수를 추측하지 말고 실제 위치를 재서 클램프합니다.
 */
async function exitToNewParagraph(page: Page, frame: FrameLocator): Promise<void> {
  const vh = page.viewportSize()?.height ?? 900;

  const attempt = async (): Promise<boolean> => {
    const last = frame.locator(EDITOR.contentComponents[0]).last();
    const lbox = await boxOf(last);
    if (!lbox) return false;

    const canvas = await boxOf(frame.locator(EDITOR.contentCanvas[0]).first());
    const canvasBottom = canvas ? canvas.y + canvas.height : vh;

    // ⚠️ 실측 기반 클램프. vh-150 은 폴백으로만 남깁니다.
    const bar = await boxOf(frame.locator(EDITOR.bottomToolbar[0]).first());
    const maxY = Math.min(bar ? bar.y - 20 : vh - 150, canvasBottom - 20);

    let y = lbox.y + lbox.height + 30;
    y = Math.max(140, Math.min(y, maxY));
    if (y <= lbox.y + lbox.height) return false; // 아래 여백이 없습니다

    const x = lbox.x + Math.min(lbox.width / 2, 300);
    await page.mouse.click(x, y);
    await sleep(page, 200);
    return true;
  };

  if (await attempt()) return;
  // 아래 여백이 없으면 스크롤로 공간을 만든 뒤 다시 계산합니다.
  await page.mouse.wheel(0, 250);
  await sleep(page, 300);
  if (await attempt()) return;
  // 마지막 폴백 — 최소한 커서를 새 줄로 보냅니다.
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
}

// ── 문단 서식 ────────────────────────────────────────────────────

/** ⚠️ 드롭다운 애니메이션이 있습니다. 서식 클릭 사이에 250~450ms 대기가 필요합니다. */
async function applyParagraphFormat(
  page: Page, frame: FrameLocator, kind: "heading" | "body" | "quote",
): Promise<boolean> {
  const opened = await clickAnywhere(page, frame, EDITOR.textFormatOpen);
  if (!opened) return false;
  await sleep(page, 350);
  const target =
    kind === "heading" ? EDITOR.optHeading : kind === "quote" ? EDITOR.optQuote : EDITOR.optBody;
  const clicked = await clickAnywhere(page, frame, target);
  await sleep(page, 350);
  return clicked;
}

/** 인라인 서식은 "클릭 이후 새로 입력되는 글자"에 적용됩니다. 선택 후 적용이 아닙니다(실측). */
async function toggleHighlight(page: Page, frame: FrameLocator, on: boolean): Promise<boolean> {
  if (!(await clickAnywhere(page, frame, EDITOR.bgColorOpen))) return false;
  await sleep(page, 300);
  const ok = await clickAnywhere(page, frame, on ? EDITOR.bgColorYellow : EDITOR.bgColorNone);
  await sleep(page, 300);
  return ok;
}

async function toggleBold(page: Page, frame: FrameLocator): Promise<void> {
  await clickAnywhere(page, frame, EDITOR.bold);
  await sleep(page, 250);
}

// ── 이미지 업로드 (7-7 / 7-18) ───────────────────────────────────

/**
 * ⚠️★ 7-7. 파일 선택창이 브라우저를 영구히 멈춥니다.
 *   증상: 이미지 업로드에서 7분간 정지, CPU 0%, 에러도 타임아웃도 없음.
 *   원인: waitForEvent("filechooser") 같은 "일회성" 리스너가 만료된 뒤 이미지 버튼을 누르면
 *        Playwright 가 가로채지 못해 OS 네이티브 파일 대화상자가 뜹니다.
 *        그 창은 브라우저를 블로킹하고 자동화는 볼 수도 닫을 수도 없습니다.
 *   ⚠️ 플랫폼 무관입니다. 윈도우 네이티브 대화상자도 똑같이 블로킹합니다.
 *   해결: 페이지를 열기 "전에" 영구 핸들러를 등록하고 모듈 스코프 변수로 파일을 넘깁니다.
 */
type PendingUpload = { path: string | null; done: boolean };

function registerFileChooser(page: Page, pending: PendingUpload): void {
  page.on("filechooser", async (chooser) => {
    try {
      if (pending.path) await chooser.setFiles(pending.path);
    } catch {
      // 실패해도 done 을 세워야 폴링이 끝납니다.
    } finally {
      pending.done = true;
    }
  });
}

export type PublishOptions = {
  blogId: string;
  draft: Draft;
  /** 이미지 섹션 순서대로의 로컬 파일 경로. null 이면 그 자리는 건너뜁니다. */
  imagePaths: (string | null)[];
  dryRun: boolean;
  visibility: VisibilityKey;
  headless?: boolean;
  /** 유형별 모드(체험단·브랜딩)는 heading 도 인용구로 처리합니다. */
  headingAsQuote?: boolean;
  /** 테스트 전용 — 로컬 하네스 HTML 로 붙입니다(9장 6.5-a). */
  entryUrl?: string;
  /** 테스트 전용 — 발행 레이어까지 가지 않고 스크린샷에서 멈춥니다. */
  screenshotName?: string;
  /**
   * 테스트 전용 — 브라우저가 닫히기 전에 살아 있는 DOM 을 읽을 기회를 줍니다.
   * 로컬 하네스(9장 6.5-a)와 에디터 실측(6.5-b)이 이 훅으로 계측합니다.
   */
  onInspect?: (page: Page, frame: FrameLocator) => Promise<void>;
  onLog?: (msg: string, level?: "info" | "warn" | "error" | "ok") => void;
};

export type PublishResult = {
  status: "published" | "dry_run" | "failed";
  blogUrl?: string;
  screenshot?: string;
  note: string;
  /** 캡션을 넣지 못한 이미지 수 */
  missingCaptions: number;
  /** 사진이 없어 건너뛴 자리 수 */
  skippedImages: number;
};

// ── 스크린샷 (7-20) ──────────────────────────────────────────────

/**
 * ⚠️★ 7-20. fullPage:true 만으로는 마지막 한 화면(900px)밖에 안 담깁니다.
 *   에디터 iframe 문서는 scrollHeight === clientHeight === 뷰포트 높이라 fullPage 가 무의미합니다.
 *
 *     .se-content boundingBox().height =  761   ← 잘린 높이
 *     .se-content scrollHeight         = 3637   ← 진짜 글 길이   (5배 차이!)
 *
 *   ⚠️ boundingBox().height 로 계산하지 마세요. scrollHeight 를 읽어야 합니다.
 */
async function screenshotFullEditor(
  page: Page, frame: FrameLocator, dest: string, log: (m: string, l?: "info" | "warn") => void,
): Promise<string | null> {
  const original = page.viewportSize() ?? { width: 1366, height: 900 };
  try {
    const content = frame.locator(EDITOR.contentCanvas[0]).first();
    const cbox = await boxOf(content);
    let scrollHeight = 0;
    try {
      scrollHeight = await content.evaluate((el) => (el as HTMLElement).scrollHeight, undefined, { timeout: 3000 });
    } catch { /* 아래 폴백 */ }

    if (scrollHeight > 0 && cbox) {
      const target = Math.min(9000, Math.round(cbox.y + scrollHeight + 160));
      await page.setViewportSize({ width: original.width, height: target });
      await sleep(page, 1200);
      await page.screenshot({ path: dest, fullPage: true });
      await page.setViewportSize(original); // ⚠️ 반드시 되돌립니다
      await sleep(page, 400);
      return dest;
    }

    // 폴백 ② iframe 문서가 자체 스크롤을 갖는 환경 → 한 화면씩 여러 장
    const docScroll = await frame.locator("body").first()
      .evaluate((el) => ({ sh: el.ownerDocument.documentElement.scrollHeight, ch: el.ownerDocument.documentElement.clientHeight }))
      .catch(() => null);

    if (docScroll && docScroll.sh > docScroll.ch) {
      const shots = Math.min(6, Math.ceil(docScroll.sh / docScroll.ch));
      const base = dest.replace(/\.png$/, "");
      for (let i = 0; i < shots; i++) {
        await frame.locator("body").first().evaluate((el, y) => { el.ownerDocument.documentElement.scrollTop = y; }, i * docScroll.ch);
        await sleep(page, 500);
        await page.screenshot({ path: `${base}-${i + 1}.png` });
      }
      log(`스크린샷을 ${shots}장으로 나눠 저장했습니다.`, "warn");
      return `${base}-1.png`;
    }

    // 폴백 ③ 보이는 화면이라도 저장하고 일부만 담겼다고 명시
    await page.screenshot({ path: dest });
    log("스크린샷이 일부만 담겼습니다(글 전체 높이를 잴 수 없었습니다).", "warn");
    return dest;
  } catch (e) {
    try { await page.setViewportSize(original); } catch { /* 무시 */ }
    log(`스크린샷 저장 실패: ${(e as Error).message}`, "warn");
    return null;
  }
}

// ── 본문 입력 ────────────────────────────────────────────────────

async function insertImageWithCaption(
  page: Page, frame: FrameLocator, pending: PendingUpload,
  filePath: string, caption: string | undefined,
  log: (m: string, l?: "info" | "warn") => void,
): Promise<{ captionOk: boolean }> {
  pending.path = filePath;
  pending.done = false;

  if (!(await clickAnywhere(page, frame, EDITOR.imageButton))) {
    log("사진 넣기 버튼을 찾지 못했습니다. 이 자리는 건너뜁니다.", "warn");
    return { captionOk: false };
  }

  // 영구 핸들러가 처리할 때까지 폴링(최대 20초)
  const deadline = Date.now() + 20000;
  while (!pending.done && Date.now() < deadline) await sleep(page, 200);
  if (!pending.done) {
    log("사진 넣기가 20초 안에 끝나지 않았습니다.", "warn");
    return { captionOk: false };
  }
  await sleep(page, 2600);

  if (!caption) return { captionOk: true };

  /**
   * ⚠️★ 7-18. 캡션 칸은 업로드 직후 크기가 0×0 이라 곧바로 클릭할 수 없습니다.
   *   방금 넣은(=마지막) 이미지 컴포넌트를 클릭해야 펼쳐집니다.
   *
   *   ⚠️ 크기 숫자를 판정 기준으로 쓰지 마세요 — 환경에 따라 640×24 이기도 64×63 이기도 합니다.
   *      "se-is-on 클래스가 붙는 것"이 펼쳐졌다는 안정적인 신호입니다.
   *
   *   ⚠️ el.focus() 로 우회하려 하지 마세요. activeElement 가 바뀌지 않아 글자가 사라집니다.
   */
  const comp = frame.locator(EDITOR.imageComponent[0]).last();
  try { await comp.click({ timeout: 5000 }); } catch { /* 아래에서 판정 */ }
  await sleep(page, 600);

  const cap = comp.locator(EDITOR.caption[0]).first();
  let expanded = false;
  for (let i = 0; i < 6; i++) {
    const cls = await cap.getAttribute("class", { timeout: 1000 }).catch(() => null);
    if (cls?.includes("se-is-on")) { expanded = true; break; }
    await sleep(page, 300);
  }

  if (!expanded) {
    /**
     * 폴백 사다리 ②: 캡션을 포기하고 경고 로그를 남깁니다.
     * ⚠️ 본문에 그냥 타이핑하면 사진 설명이 아니라 "본문 줄"이 되고 다음 문단과 합쳐집니다.
     *    넣는 것보다 빼는 게 낫습니다. 이미지 자체는 이미 들어갔으므로 발행은 계속합니다.
     */
    log("사진 밑 설명 칸이 열리지 않아 설명을 건너뜁니다(사진은 들어갔습니다).", "warn");
    await exitToNewParagraph(page, frame);
    return { captionOk: false };
  }

  try { await cap.click({ timeout: 3000 }); } catch { /* 계속 */ }
  await sleep(page, 300);
  await typeText(page, caption);
  await sleep(page, 250);

  // ⚠️ 캡션도 컴포넌트 안입니다 — 7-5 의 마우스 탈출을 여기서도 해야
  //    다음 문단이 캡션에 붙지 않습니다.
  await exitToNewParagraph(page, frame);
  return { captionOk: true };
}

async function writeSection(
  page: Page, frame: FrameLocator, pending: PendingUpload,
  section: Section, imagePath: string | null, headingAsQuote: boolean,
  log: (m: string, l?: "info" | "warn") => void,
): Promise<{ missingCaption: boolean; skippedImage: boolean }> {
  switch (section.type) {
    case "heading": {
      if (headingAsQuote) {
        await typeText(page, section.text);
        await page.keyboard.press("Shift+Home");
        await sleep(page, 200);
        await applyParagraphFormat(page, frame, "quote");
        await exitToNewParagraph(page, frame);
      } else {
        await applyParagraphFormat(page, frame, "heading");
        await typeText(page, section.text);
        await page.keyboard.press("Enter");
        await sleep(page, 250);
        await applyParagraphFormat(page, frame, "body"); // 본문으로 복귀
      }
      return { missingCaption: false, skippedImage: false };
    }

    case "paragraph": {
      const h = section.highlight;
      // ⚠️ 이중 방어 — 타이핑 직전에 한 번 더 indexOf 로 확인합니다(7-24).
      const idx = h ? section.text.indexOf(h) : -1;
      if (h && idx >= 0) {
        const before = section.text.slice(0, idx);
        const mid = section.text.slice(idx, idx + h.length);
        const after = section.text.slice(idx + h.length);
        if (before) await typeText(page, before);
        await toggleHighlight(page, frame, true);
        await toggleBold(page, frame);
        await typeText(page, mid);
        await toggleHighlight(page, frame, false);
        await toggleBold(page, frame);
        if (after) await typeText(page, after);
      } else {
        if (h) log("강조 구절을 본문에서 못 찾아 형광펜을 생략했습니다.", "warn");
        await typeText(page, section.text);
      }
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
      await sleep(page, 200);
      return { missingCaption: false, skippedImage: false };
    }

    case "quote": {
      // ⚠️ 7-5 덤. 툴바의 인용구 '컴포넌트 삽입' 버튼보다, 텍스트를 먼저 치고
      //    Shift+Home 으로 선택한 뒤 '문단 서식'으로 인용구를 적용하는 편이 훨씬 안정적입니다.
      await typeText(page, section.text);
      await page.keyboard.press("Shift+Home");
      await sleep(page, 200);
      await applyParagraphFormat(page, frame, "quote");
      await exitToNewParagraph(page, frame);
      return { missingCaption: false, skippedImage: false };
    }

    case "divider": {
      await clickAnywhere(page, frame, EDITOR.dividerInsert);
      await sleep(page, 400);
      await exitToNewParagraph(page, frame);
      return { missingCaption: false, skippedImage: false };
    }

    case "image": {
      if (!imagePath) {
        log(`"${section.query}" 자리에 넣을 사진이 없어 건너뜁니다.`, "warn");
        return { missingCaption: false, skippedImage: true };
      }
      const r = await insertImageWithCaption(page, frame, pending, imagePath, section.caption, log);
      return { missingCaption: Boolean(section.caption) && !r.captionOk, skippedImage: false };
    }
  }
}

// ── 공개 범위 (7-19) ─────────────────────────────────────────────

/**
 * ⚠️★ 7-19. radio input 은 opacity:0 이라 클릭되지 않습니다. label 을 눌러야 합니다.
 *   그리고 네이버 발행 레이어의 기본값은 "전체공개"입니다.
 *   label 을 누른 뒤 input.checked 를 직접 읽어 확인하고,
 *   확인되지 않으면 발행하지 말고 중단해야 합니다.
 *
 * ⚠️ 절대 "일단 발행하고 나중에 바꾸자"로 가지 마세요 — 되돌릴 수 없습니다.
 */
async function selectVisibility(
  page: Page, frame: FrameLocator, key: VisibilityKey,
  log: (m: string, l?: "info" | "warn") => void,
): Promise<{ ok: boolean; reason: string }> {
  const target = EDITOR.visibility[key];

  const labelFound = await findAnywhere(page, frame, [target.label]);
  if (!labelFound) {
    return { ok: false, reason: `공개 범위 선택 항목을 찾지 못했습니다(${key}).` };
  }
  try { await labelFound.loc.click({ timeout: 5000 }); } catch {
    return { ok: false, reason: "공개 범위를 클릭하지 못했습니다." };
  }
  await sleep(page, 500);

  // input.checked 를 직접 읽어 확인합니다.
  for (const scope of [frame, page] as Scope[]) {
    const input = scope.locator(target.input).first();
    const checked = await input.isChecked({ timeout: 1500 }).catch(() => null);
    if (checked === true) {
      log(`공개 범위를 확인했습니다: ${key}`, "info");
      return { ok: true, reason: `공개 범위 ${key} 확인됨` };
    }
    if (checked === false) {
      return { ok: false, reason: "공개 범위를 눌렀지만 선택되지 않았습니다." };
    }
  }
  return { ok: false, reason: "공개 범위가 선택됐는지 확인할 수 없었습니다." };
}

// ── 메인 ─────────────────────────────────────────────────────────

export async function publishDraft(opts: PublishOptions): Promise<PublishResult> {
  ensureDataDirs();
  const log = (m: string, l: "info" | "warn" | "error" | "ok" = "info") => opts.onLog?.(m, l);
  const shotName = opts.screenshotName ?? `post-${Date.now()}.png`;
  const shotPath = path.join(PATHS.shots, shotName);

  let browser: Browser | null = null;
  let missingCaptions = 0;
  let skippedImages = 0;
  let livePage: Page | null = null;
  let liveFrame: FrameLocator | null = null;

  /** 결과를 돌려주기 전에 검사 훅에 살아 있는 DOM 을 넘깁니다(테스트 전용). */
  const finish = async (r: PublishResult): Promise<PublishResult> => {
    if (opts.onInspect && livePage && liveFrame) {
      try {
        await opts.onInspect(livePage, liveFrame);
      } catch (e) {
        // 검사 실패가 결과를 바꾸면 안 되지만, 조용히 삼키면 원인을 못 찾습니다(8-5).
        log(`검사 훅 실패: ${(e as Error).message}`, "warn");
      }
    }
    return r;
  };

  try {
    const ctx = await newContext({ headless: opts.headless ?? true, useNaverSession: !opts.entryUrl });
    browser = ctx.browser;
    const page = await ctx.context.newPage();
    livePage = page;

    // ── 1. 파일 선택 영구 핸들러를 "페이지 열기 전에" 등록 (7-7) ──
    const pending: PendingUpload = { path: null, done: false };
    registerFileChooser(page, pending);

    // ── 2. 에디터 진입 ──
    const entry = opts.entryUrl ?? NAVER.write(opts.blogId);
    await page.goto(entry, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(page, 2500);

    const frame = page.frameLocator(EDITOR.frame);
    liveFrame = frame;

    // ── 3. '작성 중인 글이 있습니다' 복원 팝업 처리 ──
    // ⚠️ 팝업이 떠 있으면 입력 자체가 안 됩니다. 못 닫으면 명확히 실패 처리합니다.
    const popup = await firstVisible(frame, EDITOR.restorePopup);
    if (popup) {
      log("작성 중이던 글 안내가 떠 있어 닫고 새 글로 시작합니다.");
      const closed = await clickAnywhere(page, frame, EDITOR.restoreCancel);
      await sleep(page, 800);
      const stillDim = await countAny(frame, EDITOR.popupDim);
      const stillPopup = await firstVisible(frame, EDITOR.restorePopup);
      if (!closed || stillPopup || stillDim > 0) {
        await page.screenshot({ path: shotPath }).catch(() => {});
        return await finish({
          status: "failed", screenshot: shotPath, missingCaptions, skippedImages,
          note: "작성 중이던 글 안내 창을 닫지 못해 글을 쓸 수 없었습니다.",
        });
      }
    }

    // ── 4. 도움말/온보딩 패널 닫기 (7-4) ──
    await closeOverlays(page, frame, log);

    // ── 5. 제목 → 본문 → 섹션 ──
    const titleEl = await firstVisible(frame, EDITOR.title);
    if (!titleEl) {
      await page.screenshot({ path: shotPath }).catch(() => {});
      return await finish({
        status: "failed", screenshot: shotPath, missingCaptions, skippedImages,
        note: "글 제목을 넣을 자리를 찾지 못했습니다.",
      });
    }
    await titleEl.click({ timeout: 5000 });
    await sleep(page, 300);
    await typeText(page, opts.draft.title);
    await sleep(page, 400);

    /**
     * ⚠️★ 7-26. 본문 영역을 못 찾으면 글 전체가 제목 칸에 들어갑니다.
     *   에러도 안 나고 스크린샷을 봐야만 압니다. 조용히 진행하는 것이 최악입니다.
     *   Enter 로 한 번 더 시도하고, 그래도 본문 포커스가 확인되지 않으면 즉시 실패 처리합니다.
     */
    let bodyEl = await firstVisible(frame, EDITOR.body);
    if (bodyEl) {
      await bodyEl.click({ timeout: 5000 });
    } else {
      await page.keyboard.press("Enter");
      await sleep(page, 800);
      bodyEl = await firstVisible(frame, EDITOR.body);
      if (bodyEl) await bodyEl.click({ timeout: 5000 });
    }
    await sleep(page, 300);

    // 포커스가 정말 본문에 있는지 확인합니다(제목 칸에 남아 있으면 안 됩니다).
    const focus = await frame.locator("body").first().evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      const inTitle = Boolean(a?.closest(".se-section-documentTitle, .se-documentTitle"));
      return { tag: a?.tagName ?? "", cls: a?.className ?? "", editable: a?.isContentEditable ?? false, inTitle };
    }).catch(() => null);

    if (!bodyEl || !focus || focus.inTitle || !focus.editable) {
      await page.screenshot({ path: shotPath }).catch(() => {});
      return await finish({
        status: "failed", screenshot: shotPath, missingCaptions, skippedImages,
        note: "글 본문을 넣을 자리로 넘어가지 못했습니다. 그대로 진행하면 글 전체가 제목 칸에 들어가므로 중단했습니다.",
      });
    }

    let imgIdx = 0;
    for (let i = 0; i < opts.draft.sections.length; i++) {
      const s = opts.draft.sections[i];
      const imgPath = s.type === "image" ? (opts.imagePaths[imgIdx++] ?? null) : null;
      const r = await writeSection(page, frame, pending, s, imgPath, Boolean(opts.headingAsQuote), log);
      if (r.missingCaption) missingCaptions++;
      if (r.skippedImage) skippedImages++;
      if ((i + 1) % 5 === 0) log(`${i + 1}/${opts.draft.sections.length} 단락 입력`);
    }
    log("글 입력을 마쳤습니다.", "ok");

    // ── 6. 오버레이 닫기 (스크린샷 앞) ──
    await closeOverlays(page, frame, log);
    await sleep(page, 500);

    // ── 7. 발행 직전 전체 스크린샷 ──
    const shot = await screenshotFullEditor(page, frame, shotPath, log);

    // ── 8. 연습 모드면 여기서 종료 ──
    if (opts.dryRun) {
      return await finish({
        status: "dry_run", screenshot: shot ?? undefined, missingCaptions, skippedImages,
        note: "연습 모드입니다. 실제로 발행하지 않고 완성 화면만 저장했습니다.",
      });
    }

    // ── 9. 다시 한 번 닫기 (스크린샷 뒤 — 재차 열렸을 수 있습니다) ──
    await closeOverlays(page, frame, log);
    await sleep(page, 400);

    // ── 10. 발행 버튼 ──
    if (!(await clickAnywhere(page, frame, EDITOR.publishOpen))) {
      return await finish({
        status: "failed", screenshot: shot ?? undefined, missingCaptions, skippedImages,
        note: "발행 버튼을 찾지 못했습니다. 글은 임시저장 상태로 남아 있습니다.",
      });
    }
    await sleep(page, 1500);

    // ── 11. 공개 범위 선택 + 확인 (7-19) ──
    const vis = await selectVisibility(page, frame, opts.visibility, log);
    if (!vis.ok) {
      // ⚠️ 확인되지 않으면 발행하지 않습니다. 네이버 기본값이 전체공개이기 때문입니다.
      await page.screenshot({ path: shotPath.replace(/\.png$/, "-visibility.png") }).catch(() => {});
      return await finish({
        status: "failed", screenshot: shot ?? undefined, missingCaptions, skippedImages,
        note: `공개 범위를 확인할 수 없어 발행을 중단했습니다 (${vis.reason}). 글은 임시저장 상태로 남아 있습니다.`,
      });
    }

    // ── 12. 최종 확인 ──
    if (!(await clickAnywhere(page, frame, EDITOR.publishConfirm))) {
      return await finish({
        status: "failed", screenshot: shot ?? undefined, missingCaptions, skippedImages,
        note: "발행 확인 버튼을 찾지 못했습니다. 글은 임시저장 상태로 남아 있습니다.",
      });
    }

    // ── 13. 실제 발행 검증 (7-11) ──
    // ⚠️ "발행 버튼을 눌렀다"는 "발행됐다"는 뜻이 아닙니다.
    //    한 번은 blog_url 에 글쓰기 URL 이 그대로 기록돼 "발행 완료"로 표시된 적이 있습니다(임시저장이었음).
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (POST_URL_RE.test(page.url())) {
        log("발행이 확인됐습니다.", "ok");
        return await finish({
          status: "published", blogUrl: page.url(), screenshot: shot ?? undefined,
          missingCaptions, skippedImages, note: "발행 완료",
        });
      }
      await sleep(page, 1000);
    }

    return await finish({
      status: "failed", screenshot: shot ?? undefined, missingCaptions, skippedImages,
      note: "발행 버튼은 눌렀지만 글 주소가 확인되지 않았습니다. 글은 임시저장 상태로 남아 있습니다.",
    });
  } catch (e) {
    return await finish({
      status: "failed", missingCaptions, skippedImages,
      note: `에디터 작업 중 문제가 생겼습니다: ${(e as Error).message}`,
    });
  } finally {
    await closeQuietly(browser);
  }
}
