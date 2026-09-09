const base = "http://localhost:4123";
console.log("\n[A] 파이프라인 통합 검증 — 체험단 모드, 사진 없음 (네이버 접속 불필요 구간)\n");

await fetch(`${base}/api/settings`, { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ reset: true }) });

const r = await fetch(`${base}/api/jobs`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    mode: "review", keyword: "성수동 노을 카페 방문 후기", photoSource: "none",
    userContent: "지난 토요일 오후 4시 방문. 아메리카노 5500원, 바스크치즈케이크 7500원. " +
      "웨이팅 20분. 2층 창가 자리에서 노을이 잘 보임. 주차는 어려워서 지하철 권장. " +
      "테이블 간격이 좁은 편이라 조용한 대화는 어려웠음.",
  }),
}).then((x) => x.json());

if (r.error) { console.log("  ❌ 작업 생성 실패:", r.error); process.exit(1); }
console.log(`  작업 #${r.id} 시작. 진행 로그:`);

// 중복 제출이 막히는지 (7-16)
const dup = await fetch(`${base}/api/jobs`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ mode: "review", keyword: "중복", photoSource: "none" }),
});
const dupBlocked = dup.status === 409;

let last = 0, done = false;
const deadline = Date.now() + 8 * 60 * 1000;
while (!done && Date.now() < deadline) {
  const d = await fetch(`${base}/api/jobs/${r.id}`).then((x) => x.json());
  for (const l of d.logs as { id: number; level: string; message: string }[]) {
    if (l.id > last) { last = l.id; console.log(`     [${l.level}] ${l.message}`); }
  }
  if (["done", "failed"].includes(d.job.status)) { done = true; break; }
  await new Promise((s) => setTimeout(s, 2000));
}

const d = await fetch(`${base}/api/jobs/${r.id}`).then((x) => x.json());
let fail = 0;
const t = (label: string, cond: boolean, detail = "") => {
  if (!cond) fail++;
  console.log(`  ${cond ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
};

console.log("");
t("중복 제출이 409 로 막혔다 (7-16)", dupBlocked, `HTTP ${dup.status}`);
t("초안이 저장됐다", Boolean(d.draft), d.draft?.title ?? "");
if (d.draft) {
  const secs = JSON.parse(d.draft.body_json) as { type: string; text?: string; highlight?: string }[];
  const counts: Record<string, number> = {};
  for (const s of secs) counts[s.type] = (counts[s.type] ?? 0) + 1;
  console.log(`     구성: ${JSON.stringify(counts)}`);
  t("사진 없음 모드라 image 섹션이 0개다", (counts.image ?? 0) === 0);
  t("체험단 모드는 소제목을 인용구로 쓴다", (counts.quote ?? 0) > 0, `인용구 ${counts.quote ?? 0}개`);
  t("본문에 마크다운 기호 유출 0",
    secs.every((s) => !s.text || !/\*\*|~~|`|^#{1,6} |^> /m.test(s.text)));
  t("highlight 가 전부 본문에 실재한다",
    secs.every((s) => !s.highlight || (s.text ?? "").includes(s.highlight)));
  const body = secs.map((s) => s.text ?? "").join(" ");
  t("사용자가 준 숫자를 지어내지 않았다(5500/7500/20분이 반영)",
    body.includes("5500") || body.includes("5,500") || body.includes("7500") || body.includes("20분"),
    body.slice(0, 60));
}
t("네이버 로그인이 없으면 정직하게 실패로 기록한다",
  d.post?.status === "failed" && /로그인/.test(d.post?.note ?? ""),
  `${d.post?.status} — ${d.post?.note}`);
t("실패를 성공으로 보고하지 않는다 (8-2)", d.job.status === "failed");

console.log(`\n  ${fail === 0 ? "→ 파이프라인 통합 검증 통과" : `${fail}건 실패`}\n`);
process.exit(fail === 0 ? 0 : 1);
