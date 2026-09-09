import { runClaudeJson } from "@/lib/claude";
import {
  IdeasSchema, draftSchemaFor,
  type Draft, type Idea, type PhotoSource, type SourceItem, type WriteMode,
} from "@/lib/types";
import { COMMON_RULES, SECTION_SPEC, modePrompt, photoHintFor } from "@/lib/ai/templates";

/**
 * ⚠️ 7-8. 스마트에디터는 입력 중에 마크다운을 서식으로 자동 변환합니다.
 *   한국어 구어체의 물결표(~)가 특히 위험합니다 — "좋아요~" 가 취소선이 됩니다.
 *   AI 에게 "쓰지 마라"고 지시하는 것만으로는 부족합니다. 타이핑 직전에 무력화해야 합니다.
 *   물결표는 지우지 않고 전각(～)으로 바꿔 어감을 보존합니다.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/~+/g, "～")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*>[ \t]+/gm, "")
    .replace(/^[ \t]*[-*+][ \t]+/gm, "");
}

/** 수집 자료를 번호 매긴 텍스트 블록으로 압축합니다(각 400자). */
function sourceBlock(sources: SourceItem[]): string {
  return sources
    .map((s, i) => `[${i + 1}] (${s.type === "news" ? "뉴스" : "블로그"}) ${s.title}\n${s.summary}`.slice(0, 400))
    .join("\n\n");
}

// ── 1단계: 글감 발굴 ──────────────────────────────────────────────

export async function generateIdeas(
  keyword: string,
  sources: SourceItem[],
  n = 5,
): Promise<{ ok: true; ideas: Idea[] } | { ok: false; error: string }> {
  const prompt = `
너는 네이버 블로그 상위 노출을 잘 만드는 한국어 콘텐츠 기획자다.

[관심 키워드] ${keyword}

[방금 수집한 뉴스·인기 블로그 자료]
${sourceBlock(sources)}

위 자료에서 지금 사람들이 무엇을 궁금해하고 무엇이 뜨고 있는지 읽어라.
그리고 "${keyword}" 로 지금 쓰면 좋을 블로그 글감을 ${n}개 만들어라.
좋은 순서대로 정렬해서, 1번이 가장 좋은 글감이 되게 해라.

각 글감마다:
- title: 실제 블로그 글 제목처럼 (검색해서 클릭하고 싶어지는 제목)
- angle: 어떤 관점/각도로 쓸 것인지 한 줄
- rationale: 왜 지금 이 글감이 좋은지, 위 자료의 어느 부분을 근거로 하는지 한 줄

{"ideas": [{"title": "...", "angle": "...", "rationale": "..."}]} 형태로 출력하라.
`.trim();

  const res = await runClaudeJson(prompt, IdeasSchema);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, ideas: res.data.ideas.slice(0, n) };
}

// ── 2단계: 본문 작성 ──────────────────────────────────────────────

export type DraftOpts = {
  mode: WriteMode;
  photoSource: PhotoSource;
  localCount?: number;
  photoDescs?: string[];
  /** 체험단·브랜딩 모드에서 사용자가 준 핵심 내용 */
  userContent?: string;
};

export async function generateDraft(
  keyword: string,
  idea: Idea | null,
  sources: SourceItem[],
  opts: DraftOpts,
): Promise<{ ok: true; draft: Draft; droppedHighlights: number } | { ok: false; error: string }> {
  const schema = draftSchemaFor(opts.photoSource, opts.localCount ?? 0);

  const ideaBlock = idea
    ? `[정한 글감]\n제목: ${idea.title}\n관점: ${idea.angle}\n근거: ${idea.rationale}`
    : `[주제]\n${keyword}`;

  const sourceSection = sources.length
    ? `\n[참고 자료 — 그대로 베끼지 말고 참고만 해라]\n${sourceBlock(sources)}\n`
    : "";

  const userSection = opts.userContent
    ? `\n[사용자가 준 핵심 내용 — 이 안의 사실과 숫자만 써라. 지어내지 마라]\n${opts.userContent}\n`
    : "";

  const prompt = `
너는 네이버 블로그를 오래 운영해 온 한국어 블로거다. 아래 글감으로 블로그 글 한 편을 써라.

${ideaBlock}
${sourceSection}${userSection}
${modePrompt(opts.mode)}

${photoHintFor(opts.photoSource, opts.localCount ?? 0, opts.photoDescs)}

${COMMON_RULES}

${SECTION_SPEC}
`.trim();

  const res = await runClaudeJson(prompt, schema);
  if (!res.ok) return { ok: false, error: res.error };

  const { draft, dropped } = sanitizeDraft(res.data);
  return { ok: true, draft, droppedHighlights: dropped };
}

// ── 초안 정리 ─────────────────────────────────────────────────────

/**
 * ⚠️★ 7-24. AI 는 본문에 없는 highlight 를 지어냅니다 — 실측 5개 중 1개(20%).
 *   형광펜은 text.indexOf(highlight) 로 자리를 찾으므로, 그대로 두면 서식이 엉뚱한 곳에 붙습니다.
 *
 * ⚠️ 그렇다고 highlight 를 Zod .refine() 으로 "초안 전체 반려" 사유로 삼지 마세요.
 *   문단 30개짜리 글을 highlight 하나 때문에 버리는 건 나쁜 거래입니다(생성에 100초).
 *   이미지 자리 개수는 재생성할 가치가 있지만 highlight 는 아닙니다.
 *   → 그 highlight "만" 떨어뜨리고 몇 개 버렸는지 로그에 남깁니다.
 */
export function sanitizeDraft(draft: Draft): { draft: Draft; dropped: number } {
  let dropped = 0;
  const sections = draft.sections.map((s) => {
    if (s.type !== "paragraph" || !s.highlight) return s;
    const h = s.highlight.trim();
    if (!h || !s.text.includes(h)) {
      dropped++;
      const { highlight: _drop, ...rest } = s;
      return rest;
    }
    return { ...s, highlight: h };
  });
  return { draft: { ...draft, sections }, dropped };
}

/** 화면 미리보기와 에디터 입력에 공통으로 쓰는 요약 정보. */
export function draftStats(draft: Draft) {
  const c = { heading: 0, paragraph: 0, quote: 0, divider: 0, image: 0 };
  for (const s of draft.sections) c[s.type]++;
  const chars = draft.sections.reduce(
    (n, s) => n + ("text" in s ? s.text.length : 0), 0,
  );
  return { ...c, chars, total: draft.sections.length };
}
