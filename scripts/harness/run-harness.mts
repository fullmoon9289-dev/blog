import path from "node:path";
import fs from "node:fs";
import { chromium } from "playwright";
import { publishDraft } from "@/lib/naver/publish";
import { PATHS, ensureDataDirs } from "@/lib/paths";
import type { Draft } from "@/lib/types";

/**
 * 로컬 하네스 (9장 6.5-a) — 계정 없이 입력 "순서"를 확정합니다.
 *
 * ⚠️ 이 하네스는 셀렉터를 검증하지 않습니다. 7장 셀렉터는 로그인 전에는 검증할 수 없으므로
 *    그대로 씁니다. 여기서 잡는 것은 순서·포커스·누수·조용한 실패입니다.
 * ⚠️ 형광펜을 흉내 내면 접힌 캐럿에서 실제 에디터와 다르게 동작합니다.
 *    하네스 결과를 실제 에디터의 증거로 쓰지 마세요.
 */

ensureDataDirs();
const harnessDir = path.resolve("scripts/harness");
const fileUrl = (f: string) => "file://" + path.join(harnessDir, f);

const testImg = path.join(PATHS.images, "harness-test.png");
if (!fs.existsSync(testImg)) {
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage({ viewport: { width: 400, height: 300 } });
  await p.setContent('<body style="margin:0"><div style="width:400px;height:300px;background:linear-gradient(45deg,#3a6,#9d5)"></div></body>');
  await p.screenshot({ path: testImg });
  await b.close();
}

const EMOJI_LINE = "주의 [⚠️] 와 하트 [❤️] 가 들어간 문단입니다. 이모지 뒤의 이 한국어 문장이 통째로 사라지면 안 됩니다.";
const AFTER_QUOTE = "인용구 바로 다음 문단입니다. 이 문장이 인용구 안으로 빨려 들어가면 안 됩니다.";
const AFTER_IMAGE = "사진 다음 문단입니다. 이 문장이 사진 설명 칸에 붙으면 안 됩니다.";
const CAPTION = "사진 밑에 들어갈 설명입니다";

const draft: Draft = {
  title: "하네스 테스트 글",
  sections: [
    { type: "paragraph", text: "첫 문단입니다. **굵게** 와 ~~취소~~ 같은 기호가 섞여 있어요~", highlight: "기호가 섞여" },
    { type: "quote", text: "인용구 한 줄입니다" },
    { type: "paragraph", text: AFTER_QUOTE },
    { type: "heading", text: "소제목입니다" },
    { type: "paragraph", text: EMOJI_LINE },
    { type: "divider" },
    { type: "image", query: "테스트 사진", caption: CAPTION },
    { type: "paragraph", text: AFTER_IMAGE },
  ],
};

type Probe = {
  strikeClicks: number;
  uploads: number;
  searchValue: string;
  titleText: string;
  quoteText: string;
  afterQuoteInsideQuote: boolean;
  captionText: string;
  captionIsEmpty: boolean;
  afterImageInsideCaption: boolean;
  bodyAllText: string;
  emojiCounts: { warn: number; heart: number };
  sidebarVisible: boolean;
  helpVisible: boolean;
  dimCount: number;
};

let probe: Probe | null = null;
const logs: string[] = [];

console.log("\n[A] 로컬 하네스 (9장 6.5-a) — 계정 없이 확인 가능한 항목\n");

const res = await publishDraft({
  blogId: "harness",
  draft,
  imagePaths: [testImg],
  dryRun: true,
  visibility: "private",
  headless: true,
  entryUrl: fileUrl("outer.html"),
  screenshotName: "harness.png",
  onLog: (m) => logs.push(m),
  onInspect: async (_page, frame) => {
    /**
     * ⚠️ page.evaluate 안에서 화살표 함수를 const 로 이름 붙여 쓰지 마세요.
     *    esbuild(tsx)가 keepNames 헬퍼 __name() 을 함수 본문에 끼워 넣는데
     *    브라우저에는 그 헬퍼가 없어 "ReferenceError: __name is not defined" 로 죽습니다.
     *    에러가 catch 에 삼켜지면 "계측값을 못 읽었다"로만 보여 원인을 찾기 어렵습니다.
     */
    probe = await frame.locator("body").first().evaluate((body) => {
      const doc = body.ownerDocument;
      const win = doc.defaultView as unknown as { __probe: { strikeClicks: number; uploads: number } };

      const quoteComp = doc.querySelector(".se-component.se-quote");
      const cap = doc.querySelector(".se-caption");
      const capText = cap?.textContent ?? "";
      const searchEl = doc.querySelector(".se-flayer-unified-search-input") as HTMLInputElement | null;

      let bodyAll = "";
      for (const c of Array.from(doc.querySelectorAll(".se-content .se-component"))) {
        if (c.classList.contains("se-documentTitle")) continue;
        bodyAll += (c.textContent ?? "") + "\n";
      }

      return {
        strikeClicks: win.__probe.strikeClicks,
        uploads: win.__probe.uploads,
        searchValue: searchEl?.value ?? "",
        titleText: doc.querySelector(".se-documentTitle .se-text-paragraph")?.textContent ?? "",
        quoteText: quoteComp?.textContent ?? "",
        afterQuoteInsideQuote: Boolean(quoteComp?.textContent?.includes("인용구 안으로 빨려 들어가면")),
        captionText: capText,
        captionIsEmpty: Boolean(cap?.className.includes("se-is-empty")),
        afterImageInsideCaption: capText.includes("사진 설명 칸에 붙으면"),
        bodyAllText: bodyAll,
        emojiCounts: {
          warn: (bodyAll.match(/⚠/g) ?? []).length,
          heart: (bodyAll.match(/❤/g) ?? []).length,
        },
        sidebarVisible: doc.querySelectorAll(".se-sidebar").length > 0,
        helpVisible: doc.querySelectorAll(".se-help-container").length > 0,
        dimCount: doc.querySelectorAll(".se-popup-dim").length,
      };
    });
  },
});

let fail = 0;
const t = (label: string, cond: boolean, detail = "") => {
  if (!cond) fail++;
  console.log(`  ${cond ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
};

console.log(`  실행 결과: ${res.status} — ${res.note}\n`);
if (!probe) {
  console.log("  ❌ 계측값을 읽지 못했습니다. 로그:");
  for (const l of logs) console.log(`     · ${l}`);
  process.exit(1);
}
const p: Probe = probe;

// ── 9장 6.5-a 의 8항목 ──────────────────────────────────────────
t("취소선 버튼이 0회 눌렸다 (7-1)", p.strikeClicks === 0, `${p.strikeClicks}회`);
t("팝업 차단막이 제거됐다 (7-3)", p.dimCount === 0, `남은 차단막 ${p.dimCount}개`);
t("글감 검색바에 타이핑이 새지 않았다 (7-6)", p.searchValue === "", JSON.stringify(p.searchValue));
t("파일 선택창이 처리됐다 (7-7)", p.uploads === 1, `업로드 ${p.uploads}건`);
t("인용구 다음 문단이 인용구 밖에 있다 (7-5)", !p.afterQuoteInsideQuote, p.quoteText.slice(0, 40));
t("인용구 안에 인용구 한 줄만 들어 있다 (7-5)",
  p.quoteText.trim() === "인용구 한 줄입니다", JSON.stringify(p.quoteText.trim()));
t("마크다운이 무력화됐다 (7-8)", !/\*\*|~~|`/.test(p.bodyAllText) && p.bodyAllText.includes("～"));
t("형광펜 구절 앞뒤 공백이 보존됐다", p.bodyAllText.includes("기호가 섞여 있어요"),
  JSON.stringify(p.bodyAllText.split("\n")[0]));
t("VS16 이모지가 중복되지 않았다 (7-25)",
  p.emojiCounts.warn === 1 && p.emojiCounts.heart === 1,
  `⚠ ${p.emojiCounts.warn}개 / ❤ ${p.emojiCounts.heart}개 (각 1개여야 함)`);
t("이모지 뒤 한국어가 사라지지 않았다 (7-25 해법의 함정)",
  p.bodyAllText.includes("이모지 뒤의 이 한국어 문장이 통째로 사라지면 안 됩니다"));

// ── 캡션 / 제목 / 오버레이 ──────────────────────────────────────
t("사진 밑 설명이 설명 칸에 들어갔다 (7-18)", p.captionText.includes(CAPTION), JSON.stringify(p.captionText));
t("설명 칸에 se-is-empty 가 남아 있지 않다 (7-18)", !p.captionIsEmpty);
t("사진 다음 문단이 설명 칸에 붙지 않았다 (7-5/7-18)", !p.afterImageInsideCaption);
t("글이 제목 칸으로 새지 않았다 (7-26)",
  p.titleText === "하네스 테스트 글", JSON.stringify(p.titleText.slice(0, 40)));
t("우측 도크가 닫혔다 (7-21)", !p.sidebarVisible);
t("도움말 패널이 닫혔다 (7-4)", !p.helpVisible);
t("연습 모드에서 발행되지 않았다", res.status === "dry_run", res.status);
t("스크린샷이 저장됐다 (7-20)", Boolean(res.screenshot && fs.existsSync(res.screenshot)));

// ── 시나리오 2: 본문 영역이 없을 때 (7-26) ──────────────────────
console.log("\n  · 본문 영역을 못 찾는 상황 (7-26)");
const noBody = await publishDraft({
  blogId: "harness", draft, imagePaths: [testImg],
  dryRun: true, visibility: "private", headless: true,
  entryUrl: fileUrl("outer-no-body.html"),
  screenshotName: "harness-no-body.png",
  onLog: () => {},
});
console.log(`     결과: ${noBody.status} — ${noBody.note}`);
t("본문을 못 찾으면 조용히 진행하지 않고 실패 처리한다", noBody.status === "failed", noBody.status);
t("실패 시 스크린샷을 남긴다", Boolean(noBody.screenshot && fs.existsSync(noBody.screenshot)));

console.log("\n  로그:");
for (const l of logs) console.log(`     · ${l}`);
console.log(`\n  ${fail === 0 ? "→ 하네스 전부 통과" : `${fail}건 실패`}\n`);
process.exit(fail === 0 ? 0 : 1);
