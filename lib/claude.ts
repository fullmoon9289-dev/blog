import { spawn } from "node:child_process";
import type { z } from "zod";
import { CONFIG } from "@/config";
import { getSettings } from "@/lib/settings";

export type ClaudeResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

/**
 * ⚠️ 2-1. AI 호출은 반드시 claude CLI 로 (@anthropic-ai/sdk 금지).
 * API 키를 쓰면 종량 과금이 됩니다. 이 앱은 사용자의 Claude 구독요금제로 돌아야 합니다.
 */

// ── 동시성 세마포어 ───────────────────────────────────────────────
// claude 프로세스를 무제한으로 띄우면 머신이 죽습니다.
let running = 0;
const waiters: (() => void)[] = [];

async function acquire(limit: number): Promise<void> {
  if (running < limit) { running++; return; }
  await new Promise<void>((resolve) => waiters.push(resolve));
  running++;
}
function release(): void {
  running--;
  const next = waiters.shift();
  if (next) next();
}

/** 윈도우의 npm 전역 바이너리는 claude.cmd 셸 심이라 spawn 이 직접 실행하지 못합니다(ENOENT). */
const IS_WIN = process.platform === "win32";

/**
 * ⚠️ shell: true 를 써도 안전합니다.
 * 프롬프트를 argv 가 아니라 stdin 으로 넘기기 때문에 argv 에는 고정 플래그밖에 없고,
 * 셸 인용부호 문제가 생길 여지가 없습니다.
 *
 * ⚠️ 윈도우에서는 args 배열을 따로 넘기지 않고 "명령 한 문자열"로 넘깁니다.
 *   args 배열 + shell:true 조합은 Node 24 에서 매 호출마다 경고를 뿜습니다(실제 사용자 화면에서 확인):
 *     [DEP0190] Passing args to a child process with shell option true can lead to
 *     security vulnerabilities, as the arguments are not escaped, only concatenated.
 *   Node 24.20.0 으로 직접 재현·수정 확인했습니다 — 배열로 넘기면 경고, 문자열로 넘기면 경고 없음.
 *   동작(stdin 전달·종료코드)은 양쪽 동일합니다.
 *   여기서 이어붙이는 args 는 전부 코드에 박힌 고정 플래그이고 사용자 입력이 아닙니다.
 *   claudeBin 은 경로에 공백이 있을 수 있어 따옴표로 감쌉니다.
 */
function spawnClaude(args: string[]) {
  const stdio: ["pipe", "pipe", "pipe"] = ["pipe", "pipe", "pipe"];
  if (IS_WIN) {
    return spawn(`"${CONFIG.claudeBin}" ${args.join(" ")}`, { shell: true, stdio, env: process.env });
  }
  return spawn(CONFIG.claudeBin, args, { shell: false, stdio, env: process.env });
}

export async function runClaude(
  prompt: string,
  opts?: { images?: string[]; system?: string },
): Promise<ClaudeResult> {
  const settings = getSettings(); // ⚠️ 호출 시점에 읽습니다(설정 변경이 즉시 반영되도록)
  await acquire(settings.claudeConcurrency);
  try {
    return await once(prompt, opts, settings.claudeTimeoutSec);
  } finally {
    release();
  }
}

function once(
  prompt: string,
  opts: { images?: string[]; system?: string } | undefined,
  timeoutSec: number,
): Promise<ClaudeResult> {
  return new Promise((resolve) => {
    // ⚠️ 이미지 첨부는 프롬프트 끝에 "@절대경로" 로 붙입니다. 프로젝트 밖 절대경로도 동작합니다.
    const imagePart = (opts?.images ?? []).map((p) => `@${p}`).join(" ");
    const full = [opts?.system, prompt, imagePart].filter(Boolean).join("\n\n");

    let p: ReturnType<typeof spawnClaude>;
    try {
      p = spawnClaude(["-p", "--output-format", "json"]);
    } catch (e) {
      resolve({ ok: false, error: `claude 실행 실패: ${(e as Error).message}` });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (r: ClaudeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    const timer = setTimeout(() => {
      try { p.kill("SIGKILL"); } catch { /* 이미 죽었을 수 있습니다 */ }
      finish({ ok: false, error: `AI 응답이 ${timeoutSec}초 안에 오지 않았습니다.` });
    }, timeoutSec * 1000);

    p.stdout.on("data", (d) => { stdout += String(d); });
    p.stderr.on("data", (d) => { stderr += String(d); });

    p.on("error", (e) => {
      const msg = (e as NodeJS.ErrnoException).code === "ENOENT"
        ? "claude 프로그램을 찾을 수 없습니다. 설치되어 있는지 확인해 주세요."
        : `claude 실행 오류: ${e.message}`;
      finish({ ok: false, error: msg });
    });

    p.on("close", (code) => {
      const raw = stdout.trim();
      if (!raw) {
        finish({ ok: false, error: stderr.trim() || `claude 가 빈 응답을 줬습니다 (종료코드 ${code}).` });
        return;
      }
      try {
        // 응답에는 usage / modelUsage / permission_denials 등 필드가 20개 넘게 들어 있습니다.
        // 정상입니다 — .result 만 읽으면 됩니다.
        const parsed = JSON.parse(raw) as { result?: string; is_error?: boolean };
        if (parsed.is_error) {
          finish({ ok: false, error: String(parsed.result ?? "AI 가 오류를 반환했습니다.") });
          return;
        }
        if (typeof parsed.result === "string") {
          finish({ ok: true, text: parsed.result });
          return;
        }
      } catch {
        // JSON 파싱 실패 → raw stdout 을 그대로 텍스트로 반환(폴백)
      }
      finish({ ok: true, text: raw });
    });

    // ⚠️ 반드시 stdin. argv 로 넘기면 긴 한글에서 escaping 이 깨집니다.
    p.stdin.write(full);
    p.stdin.end();
  });
}

// ── 구조화 출력 ───────────────────────────────────────────────────

const JSON_ONLY_SYSTEM =
  "반드시 유효한 JSON 만 출력하라. 설명/마크다운/코드펜스 없이 JSON 객체 또는 배열만 반환하라.";

/**
 * 응답 텍스트에서 JSON 을 뽑아냅니다.
 * ⚠️ AI 는 "JSON만 출력하라"고 지시해도 앞뒤에 말을 붙입니다.
 *   ① ```json ... ``` 펜스를 먼저 찾고
 *   ② 없으면 첫 { 또는 [ 부터 마지막 짝 문자까지 잘라냅니다.
 */
export function extractJson(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]?.trim()) return fence[1].trim();

  const objStart = text.indexOf("{");
  const arrStart = text.indexOf("[");
  const starts = [objStart, arrStart].filter((i) => i >= 0);
  if (starts.length === 0) return null;

  const start = Math.min(...starts);
  const close = text[start] === "{" ? "}" : "]";
  const end = text.lastIndexOf(close);
  if (end <= start) return null;
  return text.slice(start, end + 1);
}

export async function runClaudeJson<T>(
  prompt: string,
  schema: z.ZodType<T>,
  opts?: { images?: string[]; system?: string; retries?: number },
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const retries = opts?.retries ?? 2;
  const system = [JSON_ONLY_SYSTEM, opts?.system].filter(Boolean).join("\n");
  let lastError = "알 수 없는 오류";

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await runClaude(prompt, { images: opts?.images, system });
    if (!res.ok) { lastError = res.error; continue; }

    const jsonText = extractJson(res.text);
    if (!jsonText) { lastError = "AI 응답에서 JSON 을 찾지 못했습니다."; continue; }

    let value: unknown;
    try {
      value = JSON.parse(jsonText);
    } catch (e) {
      lastError = `JSON 형식이 깨졌습니다: ${(e as Error).message}`;
      continue;
    }

    // Zod 검증 실패도 재시도 사유입니다.
    const check = schema.safeParse(value);
    if (check.success) return { ok: true, data: check.data };
    lastError = `AI 응답이 요구한 형식과 다릅니다: ${check.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" / ")}`;
  }
  return { ok: false, error: lastError };
}

// ── 설치 확인 ─────────────────────────────────────────────────────

export type ClaudeCheck = { installed: boolean; version?: string; error?: string };

export function checkClaude(): Promise<ClaudeCheck> {
  return new Promise((resolve) => {
    let p: ReturnType<typeof spawnClaude>;
    try {
      p = spawnClaude(["--version"]);
    } catch (e) {
      resolve({ installed: false, error: (e as Error).message });
      return;
    }
    let out = "";
    let done = false;
    const finish = (r: ClaudeCheck) => { if (!done) { done = true; clearTimeout(t); resolve(r); } };
    const t = setTimeout(() => { try { p.kill("SIGKILL"); } catch { /* noop */ } finish({ installed: false, error: "응답 없음" }); }, 15000);
    p.stdout.on("data", (d) => { out += String(d); });
    p.on("error", () => finish({ installed: false, error: "claude 프로그램을 찾을 수 없습니다." }));
    p.on("close", () => {
      const v = out.trim();
      finish(v ? { installed: true, version: v } : { installed: false, error: "버전을 확인할 수 없습니다." });
    });
  });
}
