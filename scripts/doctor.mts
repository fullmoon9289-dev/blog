import fs from "node:fs";
import path from "node:path";
import { checkClaude, runClaude } from "@/lib/claude";
import { newContext, closeQuietly } from "@/lib/playwright";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { PATHS, ensureDataDirs } from "@/lib/paths";

/**
 * 준비물 점검 (npm run doctor)
 *
 * ⚠️ 말로만 확인하지 않고 "앱이 실제로 쓰는 함수"를 그대로 호출합니다.
 *    새로 흉내 낸 코드로 검사하면 "점검은 되는데 앱은 안 되는" 상황이 생깁니다.
 *
 * ⚠️ 특히 claude 왕복 검사는 윈도우의 spawn(shell:true) + stdin 경로를 그대로 태웁니다.
 *    이 경로는 리눅스에서만 확인됐고 윈도우에서는 미검증이라, 여기서 진짜로 돌려봐야 합니다.
 *
 * 사용자에게는 "무슨 뜻인지 한 줄 + 어떻게 하면 되는지 한 줄"만 보여주고,
 * 에러 원문은 data/doctor.log 에 남깁니다.
 */

ensureDataDirs();
const LOG = path.join(PATHS.root, "doctor.log");
const detail: string[] = [`점검 시각: ${new Date().toISOString()}`, `플랫폼: ${process.platform}`, ""];

let bad = 0;
const ok = (name: string, note = "") => console.log(`  ✅ ${name}${note ? "  — " + note : ""}`);
const no = (name: string, meaning: string, fix: string, raw?: string) => {
  bad++;
  console.log(`  ❌ ${name}`);
  console.log(`       ${meaning}`);
  console.log(`       → ${fix}`);
  if (raw) detail.push(`[${name}] ${raw}`, "");
};

console.log("\n준비물을 하나씩 확인합니다. 1~2분쯤 걸립니다.\n");

// 1. Node
const major = Number(process.versions.node.split(".")[0]);
if (major >= 20) ok("프로그램 실행기(Node.js)", `버전 ${process.versions.node}`);
else no("프로그램 실행기(Node.js)",
  `버전이 너무 낮습니다(${process.versions.node}). 20 이상이 필요합니다.`,
  "nodejs.org 에서 LTS 버전을 내려받아 설치한 뒤 이 창을 닫고 다시 실행해 주세요.");

// 2. claude 설치
const c = await checkClaude();
if (c.installed) ok("AI 프로그램(Claude) 설치", c.version);
else no("AI 프로그램(Claude) 설치",
  "AI 를 실행할 프로그램을 찾지 못했습니다.",
  "명령어 창에 npm install -g @anthropic-ai/claude-code 를 붙여넣어 설치해 주세요.",
  c.error);

// 3. ★ claude 왕복 — 윈도우의 미검증 경로를 실제로 태웁니다
if (c.installed) {
  const probe = await runClaude("정확히 준비완료 라는 네 글자만 출력하라. 다른 말은 하지 마라.");
  if (probe.ok && probe.text.includes("준비완료")) {
    ok("AI 에게 말 걸기", "실제로 물어보고 답을 받았습니다");
  } else if (probe.ok) {
    ok("AI 에게 말 걸기", `답은 받았습니다: ${probe.text.trim().slice(0, 30)}`);
  } else {
    const loginish = /login|auth|로그인|credit|limit|한도/i.test(probe.error);
    no("AI 에게 말 걸기",
      loginish ? "AI 에 로그인이 안 되어 있거나 사용 한도에 걸렸습니다."
               : "AI 를 실행했지만 답을 받지 못했습니다.",
      loginish ? "명령어 창에 claude 라고만 쳐서 한 번 실행하고, 안내에 따라 로그인한 뒤 다시 해보세요."
               : "잠시 뒤 다시 실행해 보시고, 계속 안 되면 이 줄을 알려주세요.",
      probe.error);
  }
} else {
  no("AI 에게 말 걸기", "앞 단계가 안 되어 건너뛰었습니다.", "위의 설치를 먼저 끝내주세요.");
}

// 4. 브라우저 — 두 모드를 따로 확인합니다
/**
 * ⚠️ headless:true 만 확인하면 안 됩니다.
 *   Playwright 는 "화면 없는 모드"와 "창을 띄우는 모드"가 서로 다른 실행 파일입니다
 *   (chromium_headless_shell / chromium). 설치할 때도 따로 내려받습니다.
 *   네이버 로그인은 "창을 띄우는 모드"를 쓰므로, 그쪽을 확인하지 않으면
 *   점검은 통과하는데 로그인만 안 되는 일이 생깁니다 — 실제로 그렇게 됐습니다.
 */
try {
  const { browser } = await newContext({ headless: true });
  const v = browser.version();
  await closeQuietly(browser);
  ok("자동 브라우저 (화면 없이)", v);
} catch (e) {
  no("자동 브라우저 (화면 없이)",
    "네이버를 대신 다녀올 브라우저를 준비하지 못했습니다.",
    "명령어 창에 npx playwright install chromium 을 붙여넣어 설치해 주세요.",
    (e as Error).message);
}

console.log("     (다음 검사에서 빈 창이 잠깐 떴다 닫힙니다. 정상입니다)");
try {
  const { browser } = await newContext({ headless: false });
  const v = browser.version();
  await closeQuietly(browser);
  ok("로그인 창 띄우기", v);
} catch (e) {
  const raw = (e as Error).message;
  const missing = /Executable doesn'?t exist|please run|install/i.test(raw);
  no("로그인 창 띄우기",
    missing ? "네이버 로그인 창을 띄울 브라우저가 설치되지 않았습니다."
            : "네이버 로그인 창을 띄우지 못했습니다.",
    "명령어 창에 npx playwright install chromium 을 붙여넣어 실행한 뒤 다시 해보세요.",
    raw);
}

// 5. 저장소
try {
  const conn = db();
  conn.prepare("SELECT 1").get();
  const s = getSettings();
  ok("기록 저장소", `설정 ${Object.keys(s).length}개 확인`);

  // 6. 안전장치 기본값
  if (s.dryRun && s.visibility === "private") {
    ok("안전장치", "연습 모드 켜짐 · 공개 범위 비공개");
  } else {
    console.log(`  ⚠️  안전장치 — 연습 모드 ${s.dryRun ? "켜짐" : "꺼짐"} · 공개 범위 ${s.visibility}`);
    console.log("       실제로 블로그에 글이 올라가는 설정입니다. 의도한 게 맞는지 확인해 주세요.");
  }
} catch (e) {
  no("기록 저장소",
    "글과 설정을 저장할 곳을 준비하지 못했습니다.",
    "명령어 창에 npm install 을 다시 한 번 실행해 주세요.",
    (e as Error).message);
  no("안전장치", "앞 단계가 안 되어 건너뛰었습니다.", "위 문제를 먼저 해결해 주세요.");
}

fs.writeFileSync(LOG, detail.join("\n"));

console.log("");
if (bad === 0) {
  console.log("  준비가 전부 끝났습니다.");
  console.log("  이제 실행.bat 을 더블클릭하면 앱이 켜집니다.\n");
} else {
  console.log(`  ${bad}가지가 아직 준비되지 않았습니다. 위의 → 표시를 따라 해주세요.`);
  console.log(`  자세한 내용은 이 파일에 있습니다: ${LOG}\n`);
}
process.exit(bad === 0 ? 0 : 1);
