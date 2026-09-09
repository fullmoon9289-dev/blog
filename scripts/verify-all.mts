import { spawn } from "node:child_process";

/** 계정 없이 확인 가능한 검증(10장 A)을 전부 돌립니다. */
const STEPS: [string, string][] = [
  ["뉴런 단가 공식 (7-12)", "scripts/verify-neurons.mts"],
  ["부분일치 셀렉터 최소 재현 (7-1/7-2)", "scripts/verify-minimal-repro.mts"],
  ["수집 필터 (6-4)", "scripts/verify-trends.mts"],
  ["시간대 집계 (7-22)", "scripts/verify-timezone.mts"],
  ["안전장치·경로 보안 (7-23)", "scripts/verify-guards.mts"],
  ["로컬 하네스 (9장 6.5-a)", "scripts/harness/run-harness.mts"],
  ["claude 래퍼", "scripts/verify-claude.mts"],
  ["이미지 판독(비전)", "scripts/verify-vision.mts"],
  ["비전 판정 필터 (6-6)", "scripts/verify-vision-judge.mts"],
  ["크롤링 경로 (6-6)", "scripts/verify-crawl.mts"],
  ["글쓰기 (6-5)", "scripts/verify-writing.mts"],
];

const only = process.argv[2];
const results: [string, boolean][] = [];

for (const [name, file] of STEPS) {
  if (only && !file.includes(only)) continue;
  process.stdout.write(`\n══ ${name} ${"═".repeat(Math.max(0, 54 - name.length))}\n`);
  const code = await new Promise<number>((res) => {
    const p = spawn("npx", ["tsx", file], { stdio: "inherit", shell: process.platform === "win32" });
    p.on("close", (c) => res(c ?? 1));
  });
  results.push([name, code === 0]);
}

console.log("\n\n══ 요약 ══════════════════════════════════════════════════\n");
for (const [n, ok] of results) console.log(`  ${ok ? "✅" : "❌"} ${n}`);
const bad = results.filter(([, ok]) => !ok).length;
console.log(`\n  ${bad === 0 ? "전부 통과" : `${bad}건 실패`}\n`);
process.exit(bad === 0 ? 0 : 1);
