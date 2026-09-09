import { neuronsPerImage, imagesPerFreeDay, postsPerFreeDay } from "@/lib/ai/neurons";

console.log("\n[A] 뉴런 단가 공식 검증 (7-12) — 문서의 표와 대조\n");
// 스텝 | 장당 | 하루 | 5장짜리 글
const TABLE: [number, number, number, number][] = [
  [2, 96, 104, 20],
  [4, 173, 57, 11],
  [6, 250, 40, 8],
  [8, 326, 30, 6],
];
let fail = 0;
console.log("   스텝 | 장당(반올림) | 하루 장수 | 5장짜리 글");
for (const [steps, per, perDay, posts] of TABLE) {
  const gotPer = Math.round(neuronsPerImage(steps));
  const gotDay = imagesPerFreeDay(steps);
  const gotPosts = postsPerFreeDay(steps, 5);
  const ok = gotPer === per && gotDay === perDay && gotPosts === posts;
  if (!ok) fail++;
  console.log(`  ${ok ? "✅" : "❌"}  ${steps}  |  ${gotPer} (기대 ${per})  |  ${gotDay} (기대 ${perDay})  |  ${gotPosts} (기대 ${posts})`);
}

// 실측 대조: 7,738 뉴런 ÷ 31장 = 249.6
const measured = 7738 / 31;
const formula = neuronsPerImage(6);
const diff = Math.abs(measured - formula);
const ok = diff < 0.5;
if (!ok) fail++;
console.log(`\n  ${ok ? "✅" : "❌"} 실측 대조: 7738 ÷ 31 = ${measured.toFixed(2)} vs 공식 ${formula} (오차 ${diff.toFixed(2)})`);

// 잘못된 공식과의 차이(과소평가 배수)
const wrong = 4 * 4.8 + 6 * 9.6;
console.log(`  ℹ️  잘못된 공식이면 ${wrong}/장 — 실제의 1/${(formula / wrong).toFixed(1)} 로 과소평가됨`);
console.log(`\n  ${fail === 0 ? "→ 표 전부 일치" : `${fail}건 불일치`}\n`);
process.exit(fail === 0 ? 0 : 1);
