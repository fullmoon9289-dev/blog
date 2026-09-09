import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { fillSlots } from "@/lib/scrape/images";
import { PATHS, ensureDataDirs } from "@/lib/paths";

/**
 * 크롤링 경로 검증.
 * ⚠️ 네이버·구글에 접속하지 않고, 같은 구조의 검색 결과 페이지를 로컬에서 띄워 검증합니다.
 *    (실제 네이버 이미지 검색 DOM 자체는 로그인 후 사용자 환경에서만 확인 가능합니다)
 */
ensureDataDirs();
const dir = path.join(PATHS.images, "crawl-test");
fs.mkdirSync(dir, { recursive: true });

// 테스트 이미지 3종을 만듭니다: 정상 / 워터마크 / 아이콘(너무 작음)
const b0 = await chromium.launch({ headless: true });
const pg = await b0.newPage({ viewport: { width: 640, height: 420 } });
const CLEAN = `<body style="margin:0"><div style="width:640px;height:420px;
  background:linear-gradient(160deg,#6b4a2f,#c89b6a 55%,#f0dcc0)"></div></body>`;
await pg.setContent(CLEAN);
await pg.screenshot({ path: path.join(dir, "clean.png") });
await pg.setContent(CLEAN.replace("</div></body>", `<div style="position:absolute;inset:0;
  display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.8);
  font:bold 46px sans-serif;letter-spacing:5px">© STOCKPHOTO</div></div></body>`));
await pg.screenshot({ path: path.join(dir, "marked.png") });
await pg.setViewportSize({ width: 40, height: 40 });
await pg.setContent('<body style="margin:0"><div style="width:40px;height:40px;background:#333"></div></body>');
await pg.screenshot({ path: path.join(dir, "logo.png") });
await b0.close();

// 검색 결과를 흉내 낸 로컬 서버
const server = http.createServer((req, res) => {
  const url = req.url ?? "/";
  if (url.startsWith("/img/")) {
    const f = path.join(dir, path.basename(url));
    if (!fs.existsSync(f)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "Content-Type": "image/png" });
    res.end(fs.readFileSync(f));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<body>
    <img src="/img/logo.png">                       <!-- 40px → naturalWidth 필터로 제외 -->
    <img src="/img/site-logo.svg">                  <!-- .svg → 제외 -->
    <img src="/img/sprite-nav.png">                 <!-- sprite → 제외 -->
    <img src="/img/marked.png">                     <!-- 워터마크 → 판정 탈락 -->
    <img src="/img/marked.png">                     <!-- 중복 → 하나만 -->
    <img src="/img/clean.png">                      <!-- 채택 후보 -->
  </body>`);
});
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as { port: number }).port;

console.log("\n[A] 크롤링 경로 검증 (6-6) — 로컬 검색 결과 페이지 사용\n");
const results = await fillSlots(
  dir,
  [{ query: "따뜻한 갈색 계열의 단순한 그러데이션 배경", title: "가을 홈카페 이야기" }],
  10,
  (m) => console.log(`     ${m}`),
  () => [`http://127.0.0.1:${port}/search`],
);
server.close();

const r = results[0];
let fail = 0;
const t = (label: string, cond: boolean, detail = "") => {
  if (!cond) fail++;
  console.log(`  ${cond ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
};

console.log("");
const tried = r.attempts.map((a) => path.basename(a.localPath ?? a.srcUrl));
console.log(`  시도한 후보: ${tried.join(", ")}\n`);

t("아이콘·스프라이트·svg 후보가 걸러졌다",
  !r.attempts.some((a) => /logo|sprite|\.svg/.test(a.srcUrl)), tried.join(","));
t("같은 이미지가 중복 후보로 들어가지 않았다",
  new Set(r.attempts.map((a) => a.srcUrl)).size === r.attempts.length);
t("워터마크 후보가 탈락했다",
  r.attempts.some((a) => a.srcUrl.includes("marked") && !a.verdict.fit && a.verdict.watermark),
  r.attempts.find((a) => a.srcUrl.includes("marked"))?.verdict.reason ?? "시도 안 됨");
t("탈락한 이미지도 파일과 사유가 남았다",
  r.attempts.every((a) => a.verdict.reason.length > 0));
t("쓸 만한 사진이 채택됐다", r.accepted !== null,
  r.accepted ? path.basename(r.accepted.localPath) : "없음");

console.log(`\n  ${fail === 0 ? "→ 크롤링 경로 검증 통과" : `${fail}건 실패`}`);
console.log("  ⚠️ 실제 네이버 이미지 검색 화면 자체는 이 환경에서 접속할 수 없어 미검증입니다.\n");
process.exit(fail === 0 ? 0 : 1);
