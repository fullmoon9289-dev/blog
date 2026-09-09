import path from "node:path";
import { newContext, closeQuietly } from "@/lib/playwright";

console.log("\n[A] 최소 재현: 부분일치 셀렉터 함정 (7-1 / 7-2)\n");
const { browser, context } = await newContext({ headless: true });
const page = await context.newPage();
await page.goto("file://" + path.resolve("scripts/harness/minimal-repro.html"));

let fail = 0;
const check = async (label: string, sel: string, want: number) => {
  const got = await page.locator(sel).count();
  const ok = got === want;
  if (!ok) fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}\n       ${sel}\n       매칭 ${got}개 (기대 ${want}개)`);
};

// 7-1: '취소' 로 팝업을 닫으려다 '취소선' 버튼을 누르는 함정
await check("옛 셀렉터 — '취소선'까지 잡힘(버그)", "button:has-text('취소')", 2);
await check("수정 — 팝업 안 + 정확일치", ".se-popup-container button:text-is('취소')", 1);
await check("수정 — 클래스 기반(1순위)", "button.se-popup-button-cancel", 1);

// 7-2: '발행' 이 '예약 발행 0건' 을 누르는 함정
await check("옛 셀렉터 — '예약 발행 0건'까지 잡힘(버그)", "button:has-text('발행')", 2);
await check("수정 — 데이터 속성", "button[data-click-area='tpb.publish']", 1);

await closeQuietly(browser);
console.log(fail === 0 ? "\n  → 함정 재현 및 수정 확인 완료\n" : `\n  ${fail}건 불일치\n`);
process.exit(fail === 0 ? 0 : 1);
