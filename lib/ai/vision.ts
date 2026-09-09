import fs from "node:fs";
import { runClaudeJson } from "@/lib/claude";
import { CrawlVerdictSchema, GenVerdictSchema, type CrawlVerdict, type GenVerdict } from "@/lib/types";

/**
 * 이미지 판정 (6-6 / 7-13)
 *
 * ⚠️ 크롤링 사진과 생성 사진은 "판정 함수를 반드시 분리"합니다.
 *   생성물에는 워터마크도 초상권도 없으므로 koreanPerson 필터를 그대로 돌리면
 *   멀쩡한 생성 이미지가 탈락합니다.
 */

// ── 크롤링 사진 판정 ─────────────────────────────────────────────

/**
 * ⚠️ 조용한 실패 방지 (8-5 진단 루프로 직접 발견한 결함).
 *   증상: 없는 경로를 @첨부로 넘겨도 claude 는 오류를 내지 않고 "그냥 답을 지어냅니다".
 *   측정: 존재하지 않는 파일로 판정을 돌렸더니 응답 이유가
 *        "이미지 파일이 존재하지 않아 확인이 불가능하므로 안전한 쪽으로 판정함" 이었습니다.
 *        즉 AI 는 이미지를 보지 못한 채 답했고, 이번엔 우연히 안전한 쪽이 나왔을 뿐입니다.
 *   그래서 AI 를 부르기 전에 파일을 먼저 확인합니다. AI 호출도 한 번 아낍니다.
 */
function imageReadable(p: string, minBytes: number): string | null {
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return "이미지 파일이 아닙니다";
    if (st.size < minBytes) return `파일이 너무 작습니다(${st.size}바이트)`;
    return null;
  } catch {
    return "이미지 파일을 찾을 수 없습니다";
  }
}

export async function judgeCrawlImage(
  imagePath: string,
  ctx: { query: string; title: string; around?: string },
): Promise<CrawlVerdict> {
  const unreadable = imageReadable(imagePath, 3000);
  if (unreadable) {
    return { fit: false, watermark: false, koreanPerson: false, reason: `판정 실패: ${unreadable}` };
  }

  const prompt = `
첨부된 이미지를 직접 보고, 블로그 글에 넣어도 되는지 판정하라.

[글 제목] ${ctx.title}
[이 자리에 필요한 사진] ${ctx.query}
${ctx.around ? `[앞뒤 문맥] ${ctx.around.slice(0, 300)}` : ""}

세 가지를 각각 따로 판단하라.

1) watermark — 워터마크 / 사이트 로고 / 저작권 표기 / 서명 / 스톡사진 출처표시가
   조금이라도 보이면 true. 화면 구석의 작은 글자, 반투명 로고, 브랜드가 합성된 썸네일도 해당.
   ⚠️ 의심스러우면 true 로 답하라.

2) koreanPerson — 한국인으로 보이는 사람의 얼굴이 식별 가능하면 true (초상권 위험).
   얼굴이 안 보이거나(뒷모습·손·실루엣·멀리 있는 군중) 명백한 외국인 스톡 모델이면 false.
   ⚠️ 애매하면 true 로 답하라 (안전한 쪽).

3) fit — 위 두 가지가 문제없다는 전제에서, 이 사진이 주제와 위치에 어울리는가.

reason 에는 판정 이유를 한국어 한 줄로 적어라.

{"fit": true/false, "watermark": true/false, "koreanPerson": true/false, "reason": "..."} 만 출력하라.
`.trim();

  const res = await runClaudeJson(prompt, CrawlVerdictSchema, { images: [imagePath], retries: 1 });

  /**
   * ⚠️ 6-6. 판정 호출이 실패했을 때 그 이미지를 채택하면 안 됩니다.
   *   claude 구독 한도 초과가 "검증 안 된 이미지 통과"로 이어지면 안 되기 때문입니다.
   */
  if (!res.ok) {
    return { fit: false, watermark: false, koreanPerson: false, reason: `판정 실패: ${res.error}` };
  }

  const v = res.data;
  /**
   * ⚠️ 6-6. AI 가 fit=true 로 답해도 무시하고 코드가 덮어씁니다.
   *   워터마크나 초상권 위험이 있으면 "어울리는지"와 무관하게 쓸 수 없습니다.
   */
  if (v.watermark || v.koreanPerson) {
    const why = v.watermark ? "워터마크" : "국내 인물(초상권)";
    return { ...v, fit: false, reason: `${why} — ${v.reason}` };
  }
  return v.fit ? v : { ...v, reason: `주제 불일치 — ${v.reason}` };
}

/** DB 에 남길 탈락 사유를 짧게 만듭니다(사용자가 필터 동작을 확인하는 유일한 통로). */
export function verdictReason(v: CrawlVerdict): string {
  if (v.watermark) return `워터마크: ${v.reason}`;
  if (v.koreanPerson) return `국내 인물(초상권): ${v.reason}`;
  if (!v.fit) return `주제 불일치: ${v.reason}`;
  return v.reason;
}

// ── 생성 사진 판정 (7-13) ────────────────────────────────────────

export async function judgeGeneratedImage(
  imagePath: string,
  ctx: { query: string; title: string },
): Promise<GenVerdict> {
  const unreadable = imageReadable(imagePath, 2000);
  if (unreadable) {
    return { fit: false, brokenShape: false, hasText: false, lowQuality: false, reason: `판정 실패: ${unreadable}` };
  }

  const prompt = `
첨부된 이미지는 AI 가 생성한 그림이다. 블로그 글에 넣어도 되는지 판정하라.
⚠️ 이 그림에는 워터마크도 실존 인물도 없다. 그 두 가지는 보지 마라. 아래 네 가지만 보라.

[글 제목] ${ctx.title}
[의도한 장면] ${ctx.query}

1) fit         — 의도한 장면·주제와 맞는가
2) brokenShape — 손가락 개수, 사물 구조, 원근이 부자연스럽게 깨졌는가
3) hasText     — 그림 안에 글자/문자가 섞여 들어갔는가 (깨진 글자도 포함)
4) lowQuality  — 뭉개짐, 노이즈, 저해상도로 보이는가

reason 에는 판정 이유를 한국어 한 줄로 적어라. 문제가 있으면 "무엇이" 문제인지 구체적으로.

{"fit": ..., "brokenShape": ..., "hasText": ..., "lowQuality": ..., "reason": "..."} 만 출력하라.
`.trim();

  const res = await runClaudeJson(prompt, GenVerdictSchema, { images: [imagePath], retries: 1 });
  if (!res.ok) {
    return { fit: false, brokenShape: false, hasText: false, lowQuality: false, reason: `판정 실패: ${res.error}` };
  }
  return res.data;
}

export function genVerdictOk(v: GenVerdict): boolean {
  return v.fit && !v.brokenShape && !v.hasText && !v.lowQuality;
}

export function genVerdictReason(v: GenVerdict): string {
  const bad: string[] = [];
  if (!v.fit) bad.push("주제 불일치");
  if (v.brokenShape) bad.push("형태 깨짐");
  if (v.hasText) bad.push("글자 혼입");
  if (v.lowQuality) bad.push("저품질");
  return bad.length ? `${bad.join(" / ")}: ${v.reason}` : v.reason;
}
