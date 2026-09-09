import { db } from "@/lib/db";
import { publishedToday, minutesSinceLastPublish } from "@/lib/ai/cfUsage";

console.log("\n[A] 하루 한도 시간대 검증 (7-22)\n");
const conn = db();
conn.exec("DELETE FROM posts; DELETE FROM jobs;");
conn.prepare("INSERT INTO jobs (id, keyword) VALUES (900, '시간대테스트')").run();

const tzOffsetMin = -new Date().getTimezoneOffset();
console.log(`  현재 시간대 오프셋: UTC${tzOffsetMin >= 0 ? "+" : ""}${(tzOffsetMin / 60).toFixed(0)}시간`);

// 로컬 기준 "오늘 새벽 2시"에 발행된 글. 한국시간(UTC+9)이면 UTC 로는 어제 17시로 저장됩니다.
const ins = conn.prepare(
  "INSERT INTO posts (job_id, status, published_at) VALUES (900, 'published', ?)",
);
// 로컬 오늘 02:00 → UTC 로 변환해 저장(SQLite 는 UTC 로 저장하는 것이 관례)
const local2am = new Date();
local2am.setHours(2, 0, 0, 0);
const utcStr = local2am.toISOString().replace("T", " ").slice(0, 19);
ins.run(utcStr);
console.log(`  넣은 기록: 로컬 오늘 02:00 → DB 저장값(UTC) ${utcStr}`);

// 틀린 방식 — UTC 날짜와 로컬 날짜를 비교
const wrong = (conn.prepare(
  `SELECT COUNT(*) n FROM posts WHERE status='published' AND date(published_at) = date('now','localtime')`,
).get() as { n: number }).n;

// 맞는 방식 — 양쪽 다 localtime
const right = publishedToday();

console.log(`\n  틀린 집계(한쪽만 localtime): ${wrong}편`);
console.log(`  맞는 집계(양쪽 localtime):   ${right}편`);

let fail = 0;
if (right !== 1) { fail++; console.log("  ❌ 로컬 날짜 집계가 새벽 기록을 놓쳤다"); }
else console.log("  ✅ 로컬 날짜 집계가 새벽 기록을 잡았다");

if (tzOffsetMin > 120) {
  // UTC+2 이상이면 새벽 2시 기록이 UTC 로는 전날이 되어 틀린 방식은 0편이 나와야 합니다.
  if (wrong === 0) console.log("  ✅ 틀린 방식은 실제로 이 기록을 놓친다(함정 재현됨)");
  else { fail++; console.log("  ❌ 함정이 재현되지 않음 — 검증 자체가 무의미"); }
} else {
  console.log(`  ℹ️  이 컨테이너는 UTC 라 함정이 재현되지 않습니다(한국시간에서는 재현됩니다).`);
  console.log(`      대신 KST 기준을 강제로 확인합니다.`);
  const kstWrong = (conn.prepare(
    `SELECT COUNT(*) n FROM posts WHERE status='published'
       AND date(published_at) = date('now','+9 hours')`).get() as { n: number }).n;
  const kstRight = (conn.prepare(
    `SELECT COUNT(*) n FROM posts WHERE status='published'
       AND date(published_at,'+9 hours') = date('now','+9 hours')`).get() as { n: number }).n;
  // UTC 기준 오늘 02:00 을 KST 로 보면 오늘 11:00 → 양쪽 다 오늘이라 둘 다 1
  // 함정을 확실히 보이려면 UTC 어제 17:00(= KST 오늘 02:00) 기록을 넣습니다.
  const y = new Date(Date.now() - 86400000);
  y.setUTCHours(17, 0, 0, 0);
  ins.run(y.toISOString().replace("T", " ").slice(0, 19));
  const kw = (conn.prepare(
    `SELECT COUNT(*) n FROM posts WHERE status='published'
       AND date(published_at) = date('now','+9 hours')`).get() as { n: number }).n;
  const kr = (conn.prepare(
    `SELECT COUNT(*) n FROM posts WHERE status='published'
       AND date(published_at,'+9 hours') = date('now','+9 hours')`).get() as { n: number }).n;
  console.log(`      KST 기준 — 틀린 방식 ${kw}편 / 맞는 방식 ${kr}편 (기록 2건)`);
  if (kr === 2 && kw < 2) console.log("  ✅ KST 에서 함정 재현 + 수정 확인 (실측 2편인데 틀린 방식은 적게 셈)");
  else { fail++; console.log("  ❌ KST 검증 실패"); }
  console.log(`      (초기 확인: ${kstWrong}/${kstRight})`);
}

const mins = minutesSinceLastPublish();
console.log(`\n  마지막 발행 후 경과: ${mins === null ? "기록 없음" : mins.toFixed(0) + "분"}`);
if (mins === null) { fail++; console.log("  ❌ 경과 시간을 계산하지 못함"); }
else console.log("  ✅ 발행 간격 계산 동작");

conn.exec("DELETE FROM posts; DELETE FROM jobs;");
console.log(`\n  ${fail === 0 ? "→ 시간대 검증 통과" : `${fail}건 실패`}\n`);
process.exit(fail === 0 ? 0 : 1);
