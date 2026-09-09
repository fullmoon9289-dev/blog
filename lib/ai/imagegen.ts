import fs from "node:fs";
import path from "node:path";
import { runClaudeJson } from "@/lib/claude";
import { GenPromptSchema, type ImageStyle, type Section } from "@/lib/types";
import { judgeGeneratedImage, genVerdictOk, genVerdictReason } from "@/lib/ai/vision";
import { CONFIG } from "@/config";

/**
 * AI 이미지 생성 — Cloudflare Workers AI (6-7)
 * 저작권·워터마크·초상권 문제가 원천적으로 없고, 크롤링보다 주제 적합도가 높습니다.
 */

const STYLE_TOKENS: Record<ImageStyle, string> = {
  photo: "photorealistic photograph, natural lighting, shallow depth of field, 50mm lens, high detail",
  illust: "clean flat vector illustration, simple shapes, soft muted color palette, minimal, lots of white space",
};

/** ±3섹션에서 문단 2개를 뽑아 400자로 압축합니다(그 자리의 맥락). */
export function contextAround(sections: Section[], index: number): string {
  const near: string[] = [];
  for (let d = 1; d <= 3 && near.length < 2; d++) {
    for (const i of [index - d, index + d]) {
      const s = sections[i];
      if (s && (s.type === "paragraph" || s.type === "quote") && near.length < 2) near.push(s.text);
    }
  }
  return near.join(" ").slice(0, 400);
}

// ── ① claude 가 영문 프롬프트를 설계 ─────────────────────────────

export async function designPrompt(
  title: string,
  query: string,
  caption: string | undefined,
  around: string,
  style: ImageStyle,
  retryReason?: string,
): Promise<{ ok: true; prompt: string } | { ok: false; error: string }> {
  const ask = `
너는 이미지 생성 모델(FLUX)용 영문 프롬프트를 설계한다.

[글 제목] ${title}
[이 자리에 필요한 그림] ${query}
${caption ? `[사진 밑에 들어갈 설명] ${caption}` : ""}
[앞뒤 문단 맥락] ${around}
${retryReason ? `\n[이전 생성물이 반려된 이유 — 이번엔 이걸 피해라]\n${retryReason}` : ""}

[작성 규칙 — 반드시 지켜라]
- 영어로, 한 문단, 40단어 이내.
- 피사체 / 구도 / 조명 / 배경 / 질감을 명시해라.
- 다음 스타일 토큰을 반드시 포함해라: ${STYLE_TOKENS[style]}
- 문장 끝에 반드시 이것을 붙여라: no text, no letters, no words, no watermark, no logo
- 실존 인물·유명인·브랜드 로고를 넣지 마라.
- 사람이 필요하면 얼굴이 크게 나오지 않는 구도로 (손·뒷모습·실루엣).
- 한국적 맥락은 반영하되 한글 간판은 넣지 마라 (생성 모델이 한글을 깨뜨린다).

{"prompt": "영문 프롬프트"} 만 출력하라.
`.trim();

  const res = await runClaudeJson(ask, GenPromptSchema, { retries: 1 });
  return res.ok ? { ok: true, prompt: res.data.prompt } : { ok: false, error: res.error };
}

// ── ② 생성 ───────────────────────────────────────────────────────

const CF_MODEL = "@cf/black-forest-labs/flux-1-schnell";

export function cloudflareConfigured(): boolean {
  return Boolean(CONFIG.cfAccountId && CONFIG.cfApiToken);
}

/** ⚠️ 2000바이트 미만이면 생성 실패로 처리합니다. 타임아웃 90초. */
const MIN_GEN_BYTES = 2000;

export async function generateImage(
  prompt: string,
  steps: number,
  destPath: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  if (!cloudflareConfigured()) {
    return { ok: false, error: "Cloudflare 열쇠가 설정되지 않았습니다." };
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${CONFIG.cfAccountId}/ai/run/${CF_MODEL}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 90_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CONFIG.cfApiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt, steps: Math.min(Math.max(steps, 1), 8) }),
      signal: ac.signal,
    });

    const ct = res.headers.get("content-type") ?? "";
    let buf: Buffer;

    if (ct.includes("application/json")) {
      /**
       * ⚠️ 6-7. flux-1-schnell 의 응답은 바이너리가 아니라 base64 JSON 입니다.
       *   { result: { image: "<base64>" } } → Buffer.from(b64, "base64")
       *   (SDXL 계열은 바이너리를 주므로 content-type 으로 분기해 두면 모델 교체가 쉽습니다)
       */
      const json = (await res.json()) as {
        result?: { image?: string };
        errors?: { message?: string }[];
        success?: boolean;
      };
      if (!res.ok || json.success === false) {
        return { ok: false, error: json.errors?.[0]?.message ?? `생성 요청 실패 (HTTP ${res.status})` };
      }
      const b64 = json.result?.image;
      if (!b64) return { ok: false, error: "응답에 이미지가 없습니다." };
      buf = Buffer.from(b64, "base64");
    } else {
      if (!res.ok) return { ok: false, error: `생성 요청 실패 (HTTP ${res.status})` };
      buf = Buffer.from(await res.arrayBuffer());
    }

    if (buf.length < MIN_GEN_BYTES) {
      return { ok: false, error: `생성 결과가 너무 작습니다(${buf.length}바이트).` };
    }
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, buf);
    return { ok: true, path: destPath };
  } catch (e) {
    const msg = (e as Error).name === "AbortError" ? "생성이 90초 안에 끝나지 않았습니다." : (e as Error).message;
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

// ── ③ 생성 → 검증 → (1회만) 재생성 ──────────────────────────────

export type GenSlotResult = {
  ok: boolean;
  localPath?: string;
  prompt?: string;
  reason: string;
  attempts: number;
};

/**
 * ⚠️ 6-7. 부적합하면 그 이유를 프롬프트 설계에 되먹여 "1회만" 재생성합니다.
 *   무한 루프 금지 — 그래도 실패하면 그 자리는 건너뜁니다.
 */
export async function generateForSlot(
  title: string,
  query: string,
  caption: string | undefined,
  around: string,
  style: ImageStyle,
  steps: number,
  destPathBase: string,
  onLog?: (msg: string) => void,
): Promise<GenSlotResult> {
  let retryReason: string | undefined;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const design = await designPrompt(title, query, caption, around, style, retryReason);
    if (!design.ok) return { ok: false, reason: `프롬프트 설계 실패: ${design.error}`, attempts: attempt };

    const dest = `${destPathBase}-${attempt}.png`;
    const gen = await generateImage(design.prompt, steps, dest);
    if (!gen.ok) return { ok: false, prompt: design.prompt, reason: `생성 실패: ${gen.error}`, attempts: attempt };

    const verdict = await judgeGeneratedImage(dest, { query, title });
    if (genVerdictOk(verdict)) {
      onLog?.(`생성 채택 (${attempt}번째): ${verdict.reason}`);
      return { ok: true, localPath: dest, prompt: design.prompt, reason: verdict.reason, attempts: attempt };
    }

    retryReason = genVerdictReason(verdict);
    onLog?.(`생성 반려 (${attempt}번째): ${retryReason}`);
    if (attempt === 2) {
      return { ok: false, localPath: dest, prompt: design.prompt, reason: retryReason, attempts: attempt };
    }
  }
  return { ok: false, reason: "생성 실패", attempts: 2 };
}
