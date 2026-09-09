import path from "node:path";
import fs from "node:fs";
import { newContext, closeQuietly } from "@/lib/playwright";
import { judgeCrawlImage, verdictReason } from "@/lib/ai/vision";
import { PATHS, ensureDataDirs } from "@/lib/paths";

ensureDataDirs();
const dir = path.join(PATHS.root, "test-images");
fs.mkdirSync(dir, { recursive: true });

// Playwright 로 테스트용 이미지를 그려 저장합니다(외부 다운로드 불필요).
const CLEAN = `<body style="margin:0"><div style="width:640px;height:420px;
  background:linear-gradient(160deg,#2f4f3a,#7fa86b 55%,#cfe0b8);position:relative">
  <div style="position:absolute;left:180px;top:150px;width:280px;height:150px;
    background:#6b4a2f;clip-path:polygon(50% 0,100% 100%,0 100%)"></div>
  <div style="position:absolute;left:60px;top:230px;width:180px;height:110px;
    background:#4a3524;clip-path:polygon(50% 0,100% 100%,0 100%)"></div>
</div></body>`;

const MARKED = CLEAN.replace("</div></body>", `
  <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
    color:rgba(255,255,255,.72);font:bold 44px sans-serif;letter-spacing:4px;
    text-shadow:0 2px 6px rgba(0,0,0,.5)">© STOCKPHOTO</div>
  <div style="position:absolute;right:12px;bottom:10px;color:#fff;font:600 18px sans-serif;
    background:rgba(0,0,0,.45);padding:4px 10px">www.somestock.co.kr</div>
</div></body>`);

const { browser, context } = await newContext({ headless: true });
const page = await context.newPage();
await page.setViewportSize({ width: 640, height: 420 });

const shots: Record<string, string> = {};
for (const [name, html] of Object.entries({ clean: CLEAN, watermarked: MARKED })) {
  await page.setContent(html);
  const p = path.join(dir, `${name}.png`);
  await page.screenshot({ path: p });
  shots[name] = p;
}
await closeQuietly(browser);

console.log("\n[A] 비전 판정 검증 (6-6) — 워터마크 / 초상권 필터\n");
let fail = 0;
const ctx = { query: "가을 산속 캠핑 텐트 풍경", title: "가을 캠핑 준비물 정리" };

const clean = await judgeCrawlImage(shots.clean, ctx);
console.log(`  · 깨끗한 이미지 → fit=${clean.fit} watermark=${clean.watermark} 인물=${clean.koreanPerson}`);
console.log(`      사유: ${clean.reason}`);
if (clean.watermark) { fail++; console.log("  ❌ 워터마크가 없는데 있다고 판정"); }
else console.log("  ✅ 워터마크 없음으로 올바르게 판정");

const marked = await judgeCrawlImage(shots.watermarked, ctx);
console.log(`\n  · 워터마크 있는 이미지 → fit=${marked.fit} watermark=${marked.watermark}`);
console.log(`      사유: ${marked.reason}`);
if (!marked.watermark) { fail++; console.log("  ❌ 워터마크를 못 잡음"); }
else console.log("  ✅ 워터마크를 잡아냈다");
if (marked.fit) { fail++; console.log("  ❌ 워터마크인데 fit=true 로 통과됨 (강제 false 가 동작 안 함)"); }
else console.log("  ✅ 워터마크면 fit 이 강제로 false 로 덮어써졌다");
console.log(`      DB 기록용 사유: "${verdictReason(marked)}"`);

// 판정 호출이 실패했을 때 채택되지 않는지 (없는 파일로 강제 실패)
const broken = await judgeCrawlImage(path.join(dir, "존재하지-않는-파일.png"), ctx);
console.log(`\n  · 판정 호출 실패 시 → fit=${broken.fit}`);
console.log(`      사유: ${broken.reason.slice(0, 90)}`);
if (broken.fit) { fail++; console.log("  ❌ 판정 실패인데 채택됨"); }
else console.log("  ✅ 판정 실패한 이미지는 채택되지 않는다");

console.log(`\n  ${fail === 0 ? "→ 비전 판정 검증 통과" : `${fail}건 실패`}\n`);
process.exit(fail === 0 ? 0 : 1);
