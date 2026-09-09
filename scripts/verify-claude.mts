import { z } from "zod";
import { checkClaude, runClaude, runClaudeJson, extractJson } from "@/lib/claude";

let pass = 0, fail = 0;
const ok = (n: string, extra = "") => { console.log(`  ✅ ${n}${extra ? " — " + extra : ""}`); pass++; };
const no = (n: string, why: string) => { console.log(`  ❌ ${n} — ${why}`); fail++; };

console.log("\n[A] claude 래퍼 검증\n");

// 1. 설치 확인
const chk = await checkClaude();
chk.installed ? ok("claude --version", chk.version) : no("claude --version", chk.error ?? "");

// 2. 긴 한글 프롬프트(2000자 이상)가 깨지지 않는가 — stdin 전달 검증
const filler = "가나다라마바사아자차카타파하 한국어 프롬프트가 길어져도 깨지지 않아야 합니다. ".repeat(60);
const longRes = await runClaude(
  `${filler}\n\n위 글에 "한국어"라는 단어가 몇 번 나오는지는 세지 말고, 정확히 OK 라는 두 글자만 출력하라.`,
);
console.log(`     (프롬프트 길이: ${filler.length + 60}자)`);
if (longRes.ok && longRes.text.includes("OK")) ok("긴 한글 프롬프트 무손상");
else no("긴 한글 프롬프트 무손상", longRes.ok ? `응답: ${longRes.text.slice(0, 60)}` : longRes.error);

// 3. 코드펜스가 붙어도 JSON 이 파싱되는가 (순수 함수 검증 — AI 응답에 의존하지 않음)
const fenced = 'JSON 입니다:\n```json\n{"a": 1, "b": [2,3]}\n```\n이상입니다.';
const bare = '설명입니다 {"a": 1} 끝입니다.';
const arr = '앞말 [1,2,3] 뒷말';
const cases: [string, string, string][] = [
  ["코드펜스", fenced, '{"a": 1, "b": [2,3]}'],
  ["펜스 없음(객체)", bare, '{"a": 1}'],
  ["펜스 없음(배열)", arr, "[1,2,3]"],
];
let extractOk = true;
for (const [label, input, want] of cases) {
  const got = extractJson(input);
  if (got !== want) { extractOk = false; no(`JSON 추출 (${label})`, `기대 ${want} / 실제 ${got}`); }
}
if (extractOk) ok("JSON 추출 3종 (펜스 / 객체 / 배열)");

// 4. Zod 스키마 강제가 실제 AI 응답에 통하는가
const schema = z.object({ items: z.array(z.string()).min(2) });
const jsonRes = await runClaudeJson(
  "한국 블로그 글의 흔한 소제목 3개를 items 배열에 담은 JSON 객체 하나만 출력하라.",
  schema,
);
jsonRes.ok
  ? ok("runClaudeJson + Zod", JSON.stringify(jsonRes.data.items).slice(0, 60))
  : no("runClaudeJson + Zod", jsonRes.error);

console.log(`\n결과: ${pass} 통과 / ${fail} 실패\n`);
process.exit(fail === 0 ? 0 : 1);
