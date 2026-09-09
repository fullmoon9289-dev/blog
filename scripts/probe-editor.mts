import fs from "node:fs";
import path from "node:path";
import type { FrameLocator, Page } from "playwright";
import { newContext, closeQuietly } from "@/lib/playwright";
import { EDITOR, NAVER } from "@/lib/scrape/selectors";
import { verifySession } from "@/lib/naver/session";
import { PATHS, ensureDataDirs } from "@/lib/paths";

/**
 * ★★ 살아 있는 에디터 실측 (9장 6.5-b)
 *
 * ⚠️ 진입 직후 한 번만 덤프하면 안 됩니다. 에디터 요소의 절반은 "조건부"로 생깁니다.
 *    한 번만 찍으면 13개가 "안 잡힘"으로 나와 "7장이 전부 틀렸다"고 오판하기 딱 좋습니다.
 *    실제로 그 13개를 다시 열어놓고 재보니 13개 중 13개가 명세 값 그대로 맞았습니다.
 *
 * ⚠️ 이 스크립트는 발행 확인 버튼을 절대 누르지 않습니다.
 * ⚠️ 이 단계를 마치기 전에는 "에디터가 동작한다"고 보고하면 안 됩니다.
 */

type Measure = { sel: string; countInFrame: number; countInPage: number; visible: boolean; where: string };

ensureDataDirs();

async function measure(page: Page, frame: FrameLocator, sels: readonly string[]): Promise<Measure[]> {
  const out: Measure[] = [];
  for (const sel of sels) {
    let cf = 0, cp = 0, vis = false, where = "없음";
    try { cf = await frame.locator(sel).count(); } catch { /* 무시 */ }
    try { cp = await page.locator(sel).count(); } catch { /* 무시 */ }
    if (cf > 0) { try { vis = await frame.locator(sel).first().isVisible({ timeout: 500 }); } catch { /* 무시 */ } }
    if (!vis && cp > 0) { try { vis = await page.locator(sel).first().isVisible({ timeout: 500 }); } catch { /* 무시 */ } }
    // ⚠️ 발행 버튼·공개 범위 라디오가 iframe 안인지 밖인지는 환경마다 다릅니다. 양쪽 다 기록합니다.
    where = cf > 0 && cp > 0 ? "양쪽" : cf > 0 ? "iframe 안" : cp > 0 ? "iframe 밖" : "없음";
    out.push({ sel, countInFrame: cf, countInPage: cp, visible: vis, where });
  }
  return out;
}

function show(title: string, ms: Measure[]): void {
  console.log(`\n  ${title}`);
  for (const m of ms) {
    const mark = m.countInFrame + m.countInPage > 0 ? (m.visible ? "✅" : "🟡") : "❌";
    console.log(`    ${mark} ${m.sel}\n         iframe안 ${m.countInFrame} / iframe밖 ${m.countInPage} · 보임 ${m.visible} · ${m.where}`);
  }
}

const dump: Record<string, unknown> = { at: new Date().toISOString() };

console.log("\n★ 살아 있는 에디터 실측 (9장 6.5-b)\n");
const session = await verifySession(true);
if (!session.canWrite || !session.blogId) {
  console.log(`  ❌ 네이버 로그인이 필요합니다: ${session.reason}`);
  console.log("     앱 화면에서 [네이버 로그인] 을 먼저 눌러주세요.\n");
  process.exit(1);
}
console.log(`  블로그: ${session.blogId}`);

// 테스트용 사진 1장
const probeImg = path.join(PATHS.images, "probe-test.png");
if (!fs.existsSync(probeImg)) fs.copyFileSync(path.join(PATHS.images, "harness-test.png"), probeImg);

const { browser, context } = await newContext({ headless: false, useNaverSession: true });
try {
  const page = await context.newPage();
  const pending = { path: probeImg as string | null, done: false };
  // ⚠️ 7-7. 페이지를 열기 전에 영구 핸들러를 등록합니다.
  page.on("filechooser", async (c) => {
    try { if (pending.path) await c.setFiles(pending.path); } finally { pending.done = true; }
  });

  await page.goto(NAVER.write(session.blogId), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);
  const frame = page.frameLocator(EDITOR.frame);

  // ── ① 진입 직후, "닫기 전에" 잰다 ──────────────────────────
  console.log("\n── ① 진입 직후 (아직 아무것도 닫지 않음) ──");
  const stage1 = {
    restorePopup: await measure(page, frame, EDITOR.restorePopup),
    restoreCancel: await measure(page, frame, EDITOR.restoreCancel),
    popupDim: await measure(page, frame, EDITOR.popupDim),
    helpPanel: await measure(page, frame, EDITOR.helpPanel),
    helpClose: await measure(page, frame, EDITOR.helpClose),
    title: await measure(page, frame, EDITOR.title),
    body: await measure(page, frame, EDITOR.body),
    imageButton: await measure(page, frame, EDITOR.imageButton),
    textFormatOpen: await measure(page, frame, EDITOR.textFormatOpen),
    bold: await measure(page, frame, EDITOR.bold),
    bgColorOpen: await measure(page, frame, EDITOR.bgColorOpen),
    dividerInsert: await measure(page, frame, EDITOR.dividerInsert),
    publishOpen: await measure(page, frame, EDITOR.publishOpen),
    bottomToolbar: await measure(page, frame, EDITOR.bottomToolbar),
    bottomSearchInput: await measure(page, frame, EDITOR.bottomSearchInput),
  };
  for (const [k, v] of Object.entries(stage1)) show(k, v);
  dump.stage1 = stage1;
  await page.screenshot({ path: path.join(PATHS.dumps, "probe-1-entry.png") }).catch(() => {});

  // 팝업/도움말 닫기
  for (const sel of EDITOR.restoreCancel) {
    try { const l = frame.locator(sel).first(); if (await l.isVisible({ timeout: 400 })) { await l.click(); break; } } catch { /* 다음 */ }
  }
  await page.waitForTimeout(600);
  for (const sel of EDITOR.sidebarClose) {
    try { const l = frame.locator(sel).first(); if (await l.isVisible({ timeout: 400 })) await l.click(); } catch { /* 다음 */ }
    try { const l = page.locator(sel).first(); if (await l.isVisible({ timeout: 400 })) await l.click(); } catch { /* 다음 */ }
  }
  await page.waitForTimeout(500);

  // 제목·본문에 표시용 글자
  for (const sel of EDITOR.title) {
    try { const l = frame.locator(sel).first(); if (await l.isVisible({ timeout: 500 })) { await l.click(); break; } } catch { /* 다음 */ }
  }
  await page.keyboard.type("[실측용] 지워도 되는 글", { delay: 8 });
  for (const sel of EDITOR.body) {
    try { const l = frame.locator(sel).first(); if (await l.isVisible({ timeout: 500 })) { await l.click(); break; } } catch { /* 다음 */ }
  }
  await page.keyboard.type("실측용 본문입니다.", { delay: 8 });
  await page.waitForTimeout(400);

  // ── ② 각각 "열어놓고" 잰다 ────────────────────────────────
  console.log("\n── ② 조건부 요소를 각각 열어놓고 측정 ──");
  const stage2: Record<string, Measure[]> = {};

  // 문단서식 드롭다운
  for (const sel of EDITOR.textFormatOpen) {
    try { const l = frame.locator(sel).first(); if (await l.isVisible({ timeout: 500 })) { await l.click(); break; } } catch { /* 다음 */ }
  }
  await page.waitForTimeout(500);
  stage2.optHeading = await measure(page, frame, EDITOR.optHeading);
  stage2.optBody = await measure(page, frame, EDITOR.optBody);
  stage2.optQuote = await measure(page, frame, EDITOR.optQuote);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // 배경색 팔레트
  for (const sel of EDITOR.bgColorOpen) {
    try { const l = frame.locator(sel).first(); if (await l.isVisible({ timeout: 500 })) { await l.click(); break; } } catch { /* 다음 */ }
  }
  await page.waitForTimeout(500);
  stage2.bgColorYellow = await measure(page, frame, EDITOR.bgColorYellow);
  stage2.bgColorNone = await measure(page, frame, EDITOR.bgColorNone);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // 사진 1장 삽입 → 캡션 0×0 → 컴포넌트 클릭 → se-is-on
  for (const sel of EDITOR.body) {
    try { const l = frame.locator(sel).first(); if (await l.isVisible({ timeout: 500 })) { await l.click(); break; } } catch { /* 다음 */ }
  }
  pending.done = false;
  for (const sel of EDITOR.imageButton) {
    try { const l = frame.locator(sel).first(); if (await l.isVisible({ timeout: 500 })) { await l.click(); break; } } catch { /* 다음 */ }
  }
  const dl = Date.now() + 20000;
  while (!pending.done && Date.now() < dl) await page.waitForTimeout(200);
  await page.waitForTimeout(2600);

  stage2.imageComponent = await measure(page, frame, EDITOR.imageComponent);
  const capBefore = await frame.locator(EDITOR.caption[0]).first()
    .evaluate((el) => ({ cls: el.className, w: (el as HTMLElement).offsetWidth, h: (el as HTMLElement).offsetHeight }))
    .catch(() => null);
  console.log(`\n    캡션 — 사진 넣은 직후: ${JSON.stringify(capBefore)}`);

  try { await frame.locator(EDITOR.imageComponent[0]).last().click({ timeout: 5000 }); } catch { /* 무시 */ }
  await page.waitForTimeout(800);
  const capAfter = await frame.locator(EDITOR.caption[0]).first()
    .evaluate((el) => ({ cls: el.className, w: (el as HTMLElement).offsetWidth, h: (el as HTMLElement).offsetHeight }))
    .catch(() => null);
  console.log(`    캡션 — 컴포넌트 클릭 후: ${JSON.stringify(capAfter)}`);
  console.log(`    → se-is-on 이 붙었는가: ${capAfter?.cls.includes("se-is-on") ? "예 ✅" : "아니오 ❌"}`);
  dump.caption = { before: capBefore, after: capAfter };

  // 우측 도크가 어느 계열인지
  const dock = {
    helpClose: await measure(page, frame, [".se-help-panel-close-button"]),
    helpHeaderBtn: await measure(page, frame, [".se-help-header button"]),
    sidebarClose: await measure(page, frame, [".se-sidebar-close-button"]),
    sidebar: await measure(page, frame, EDITOR.sidebar),
  };
  console.log("\n    사진 삽입 직후 우측 도크 계열:");
  for (const [k, v] of Object.entries(dock)) {
    console.log(`      ${k}: iframe안 ${v[0].countInFrame} / iframe밖 ${v[0].countInPage}`);
  }
  dump.dock = dock;
  stage2.captionSel = await measure(page, frame, EDITOR.caption);

  // 스크롤 높이 (7-20)
  const scroll = await frame.locator(EDITOR.contentCanvas[0]).first().evaluate((el) => ({
    boundingHeight: Math.round(el.getBoundingClientRect().height),
    scrollHeight: (el as HTMLElement).scrollHeight,
    docScrollHeight: el.ownerDocument.documentElement.scrollHeight,
    docClientHeight: el.ownerDocument.documentElement.clientHeight,
  })).catch(() => null);
  console.log(`\n    스크롤 높이 (7-20): ${JSON.stringify(scroll)}`);
  console.log("      → boundingHeight 와 scrollHeight 가 크게 다르면 명세대로입니다(실측 761 vs 3637).");
  dump.scroll = scroll;

  // 발행 레이어 — ⚠️ 확정 버튼은 절대 누르지 않습니다
  console.log("\n    발행 레이어를 엽니다 (⚠️ 확정 버튼은 누르지 않습니다)");
  let opened = false;
  for (const sel of EDITOR.publishOpen) {
    try { const l = frame.locator(sel).first(); if (await l.isVisible({ timeout: 700 })) { await l.click(); opened = true; break; } } catch { /* 다음 */ }
    try { const l = page.locator(sel).first(); if (await l.isVisible({ timeout: 700 })) { await l.click(); opened = true; break; } } catch { /* 다음 */ }
  }
  await page.waitForTimeout(1800);
  console.log(`    발행 레이어 열림: ${opened}`);

  stage2.publishConfirm = await measure(page, frame, EDITOR.publishConfirm);
  for (const [k, v] of Object.entries(EDITOR.visibility)) {
    stage2[`visibility.${k}.label`] = await measure(page, frame, [v.label]);
    stage2[`visibility.${k}.input`] = await measure(page, frame, [v.input]);
  }

  // 네이버 기본값이 정말 전체공개인지 확인 (7-19)
  const defaults: Record<string, boolean | null> = {};
  for (const [k, v] of Object.entries(EDITOR.visibility)) {
    let checked: boolean | null = null;
    try { checked = await frame.locator(v.input).first().isChecked({ timeout: 800 }); } catch { /* 다음 */ }
    if (checked === null) { try { checked = await page.locator(v.input).first().isChecked({ timeout: 800 }); } catch { /* 무시 */ } }
    defaults[k] = checked;
  }
  console.log(`\n    발행 레이어의 공개 범위 기본값 (7-19): ${JSON.stringify(defaults)}`);
  console.log("      → public 이 true 면 명세대로입니다. 그래서 label 클릭 + checked 확인이 필수입니다.");
  dump.visibilityDefaults = defaults;

  for (const [k, v] of Object.entries(stage2)) show(k, v);
  dump.stage2 = stage2;
  await page.screenshot({ path: path.join(PATHS.dumps, "probe-2-publish-layer.png") }).catch(() => {});

  // ── ③ 일반 덤프 ───────────────────────────────────────────
  const general = await frame.locator("body").first().evaluate((b) => {
    const doc = b.ownerDocument;
    const comps: string[] = [];
    for (const c of Array.from(doc.querySelectorAll(".se-content .se-component"))) comps.push(c.className);
    const tb: string[] = [];
    for (const x of Array.from(doc.querySelectorAll(".se-toolbar button"))) tb.push(x.className);
    const ov: string[] = [];
    for (const e of Array.from(doc.querySelectorAll("[class*='panel'],[class*='layer'],[class*='sidebar']"))) {
      if (e.getBoundingClientRect().width > 100) ov.push(e.tagName + "." + e.className);
    }
    return { components: comps, toolbar: tb, overlays: ov };
  }).catch(() => null);
  dump.general = general;
  console.log(`\n── ③ 일반 덤프 ──`);
  console.log(`    컴포넌트 ${general?.components.length ?? 0}개 / 툴바 버튼 ${general?.toolbar.length ?? 0}개 / 큰 오버레이 ${general?.overlays.length ?? 0}개`);

  const out = path.join(PATHS.dumps, `probe-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify(dump, null, 2));

  const missing = Object.entries({ ...stage1, ...stage2 })
    .filter(([, v]) => (v as Measure[]).every((m) => m.countInFrame + m.countInPage === 0))
    .map(([k]) => k);

  console.log(`\n── 정리 ──`);
  console.log(`  덤프 파일: ${out}`);
  console.log(`  스크린샷: ${PATHS.dumps}/probe-1-entry.png, probe-2-publish-layer.png`);
  if (missing.length) {
    console.log(`\n  ⚠️ 하나도 안 잡힌 항목 (${missing.length}개): ${missing.join(", ")}`);
    console.log(`     → 이것만 보고 "명세가 틀렸다"고 단정하지 마세요.`);
    console.log(`       조건부 요소는 열어놓지 않으면 DOM 에 없습니다. 위 ①②③ 결과와 스크린샷을 함께 보세요.`);
    console.log(`       실제로 달랐다면, 새 값을 selectors.ts 후보 배열의 "앞"에 추가하고 기존 값은 남겨두세요.`);
  } else {
    console.log(`\n  ✅ 측정한 항목이 전부 잡혔습니다.`);
  }
  console.log(`\n  ⚠️ 이 글은 임시저장으로 남습니다. 블로그에서 지우셔도 됩니다.\n`);
} finally {
  await closeQuietly(browser);
}
