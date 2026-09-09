import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { setSettings, resetSettings, getSettings } from "@/lib/settings";
import { checkPublishGuards } from "@/lib/pipeline";
import { PATHS, ensureDataDirs, isInsideData } from "@/lib/paths";

let fail = 0;
const t = (label: string, cond: boolean, detail = "") => {
  if (!cond) fail++;
  console.log(`  ${cond ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
};

console.log("\n[A] 설정 클램프 · 발행 가드 · 경로 보안\n");
ensureDataDirs();
const conn = db();
conn.exec("DELETE FROM posts; DELETE FROM jobs; DELETE FROM settings;");
conn.prepare("INSERT INTO jobs (id, keyword) VALUES (901, '가드테스트')").run();

// ── 클램프 ─────────────────────────────────────────────────────
console.log("  · 설정 범위 클램프");
let s = setSettings({ dailyPublishLimit: 999, minPublishIntervalMin: -50, imageCandidates: 1, cfImageSteps: 40, claudeConcurrency: 99 });
t("하루 발행 수 999 → 50", s.dailyPublishLimit === 50, String(s.dailyPublishLimit));
t("발행 간격 -50 → 0", s.minPublishIntervalMin === 0, String(s.minPublishIntervalMin));
t("사진 후보 1 → 3", s.imageCandidates === 3, String(s.imageCandidates));
t("생성 스텝 40 → 8", s.cfImageSteps === 8, String(s.cfImageSteps));
t("AI 동시 실행 99 → 6", s.claudeConcurrency === 6, String(s.claudeConcurrency));
s = setSettings({ visibility: "이상한값" as never });
t("잘못된 공개 범위는 기본값(private)으로", s.visibility === "private", s.visibility);

s = resetSettings();
t("되돌리기 후 연습 모드가 켜져 있다", s.dryRun === true);
t("되돌리기 후 공개 범위가 비공개다", s.visibility === "private", s.visibility);

// ── 발행 가드 3종 ──────────────────────────────────────────────
console.log("\n  · 발행 가드 3종");
setSettings({ dryRun: true, killSwitch: true });
t("연습 모드에서는 가드가 발동하지 않는다(발행 자체를 안 하므로)", checkPublishGuards().blocked === false);

setSettings({ dryRun: false, killSwitch: true });
let g = checkPublishGuards();
t("전체 중단 → blocked", g.blocked === true, g.blocked ? g.reason : "");

setSettings({ killSwitch: false, dailyPublishLimit: 1, minPublishIntervalMin: 0 });
conn.prepare("INSERT INTO posts (job_id, status, published_at) VALUES (901,'published', datetime('now'))").run();
g = checkPublishGuards();
t("하루 한도 도달 → blocked", g.blocked === true, g.blocked ? g.reason : "");

setSettings({ dailyPublishLimit: 50, minPublishIntervalMin: 30 });
g = checkPublishGuards();
t("최소 간격 미달 → blocked", g.blocked === true, g.blocked ? g.reason : "");

conn.exec("DELETE FROM posts;");
g = checkPublishGuards();
t("가드가 모두 풀리면 통과", g.blocked === false);

// ── 경로 보안 (7-23) ──────────────────────────────────────────
console.log("\n  · 경로 보안 + 한글 경로");
const koDir = path.join(PATHS.images, "내 사진 폴더");
fs.mkdirSync(koDir, { recursive: true });
const koFile = path.join(koDir, "가을 캠핑.png");
fs.copyFileSync(path.join(PATHS.images, "harness-test.png"), koFile);

t("data 안의 정상 파일은 허용", isInsideData(koFile));
t("/etc/passwd 는 거부", !isInsideData("/etc/passwd"));
t("../ 탈출은 거부", !isInsideData(path.join(PATHS.root, "..", "..", "etc", "passwd")));
t("data 와 이름이 비슷한 형제 폴더는 거부", !isInsideData(PATHS.root + "-evil/x.png"));

// NFD(자모 분해) 로 들어와도 같은 파일로 인식되는가 — macOS 에서 실제로 밟는 지뢰
const nfd = koFile.normalize("NFD");
t("한글 경로가 NFD 로 와도 허용된다 (7-23)", isInsideData(nfd), nfd === koFile ? "이 시스템은 NFC 동일" : "NFD 다름");

// 실제 HTTP 로도 확인
const base = "http://localhost:4123";
const r1 = await fetch(`${base}/api/file?path=${encodeURIComponent(koFile)}`);
t("한글 경로 이미지 미리보기 HTTP 200", r1.status === 200, `HTTP ${r1.status}`);
const r1b = await fetch(`${base}/api/file?path=${encodeURIComponent(nfd)}`);
t("NFD 한글 경로도 HTTP 200", r1b.status === 200, `HTTP ${r1b.status}`);
const r2 = await fetch(`${base}/api/file?path=${encodeURIComponent("/etc/passwd")}`);
t("/etc/passwd 는 HTTP 403", r2.status === 403, `HTTP ${r2.status}`);

// ── 알 수 없는 설정 키 ────────────────────────────────────────
const r3 = await fetch(`${base}/api/settings`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ 이상한키: 1 }),
});
t("알 수 없는 설정 키는 HTTP 400", r3.status === 400, `HTTP ${r3.status}`);

resetSettings();
conn.exec("DELETE FROM posts; DELETE FROM jobs;");
console.log(`\n  ${fail === 0 ? "→ 안전장치·보안 검증 전부 통과" : `${fail}건 실패`}\n`);
process.exit(fail === 0 ? 0 : 1);
