import type { PhotoSource, WriteMode } from "@/lib/types";

/**
 * 유형별 모드 프롬프트 (6-5)
 *
 * 두 유형 공통:
 * - 소제목을 heading 이 아니라 quote 로 만듭니다. 실제 상위 노출 블로그들의 문법이 그렇습니다.
 *   quote 는 짧은 한 줄(15~30자).
 * - 문단은 2~4줄로 짧게.
 */

/** 모든 글에 공통으로 들어가는 규칙. */
export const COMMON_RULES = `
[반드시 지킬 것]
- 수집/제공된 자료를 참고하되 문장을 그대로 베끼지 마라. 네 문장으로 다시 써라.
- 사람이 쓴 듯한 자연스러운 구어체로 써라. AI 티가 나는 표현(“~할 수 있습니다”의 남발,
  “결론적으로”, “종합해보면”, 지나치게 균형 잡힌 서술)을 쓰지 마라.
- 마크다운 기호를 절대 쓰지 마라: ** __ ~~ ~ # > 백틱, 그리고 줄머리의 - * + 목록 기호.
  (에디터가 이 기호들을 서식으로 자동 변환해 글이 망가진다)
- highlight 는 반드시 같은 문단 text 안에 "글자 그대로" 존재하는 구절이어야 한다.
  문단당 최대 1개, 전체 문단의 30% 정도에만 붙여라. 없으면 생략해라.
- 이미지 검색어(query)는 사람 얼굴이 주인공이 아닌 것으로 잡아라.
  사물·풍경·클로즈업·손동작 위주.
`.trim();

/** 섹션 타입 설명 — 모든 글쓰기 프롬프트에 붙습니다. */
export const SECTION_SPEC = `
[출력 형식] 아래 구조의 JSON 객체 하나만 출력하라.
{
  "title": "글 제목",
  "sections": [
    { "type": "heading",   "text": "소제목" },
    { "type": "paragraph", "text": "문단 내용", "highlight": "문단 안에 그대로 있는 핵심 구절(선택)" },
    { "type": "quote",     "text": "짧은 한 줄 강조(15~30자)" },
    { "type": "divider" },
    { "type": "image",     "query": "이미지 검색어 또는 설명", "caption": "사진 밑에 들어갈 한 줄 설명" }
  ]
}
`.trim();

/** 자동 발굴 모드의 본문 지시. */
export function autoModePrompt(): string {
  return `
[글의 구조]
- 도입: 공감 또는 후킹으로 시작한다. 바로 본론으로 들어가지 마라.
- 본문: 소제목(heading)으로 2~4개 구획으로 나눈다.
- 마무리: 요약 + 행동 유도.
`.trim();
}

/** 체험단 모드 (1인칭 방문/사용 후기체). */
export function reviewModePrompt(): string {
  return `
[체험단 후기 글]
- 철저히 1인칭으로 써라. "저희는", "~했어요", "~더라구요", "~하더라고요".
- "ㅎㅎ", "진짜", "생각보다" 같은 표현을 자연스럽게 섞어라. 억지로 넣지는 마라.
- 도입에서 결론을 살짝 흘려라. (예: 결론부터 말하면 재방문 의사 있습니다)
- 실용정보를 구획별로 담아라: 가는 법 / 웨이팅 / 가격 / 언제 가면 좋은지 / 주의할 점.
- 문단 1~2개마다 사진 1장이 오는 리듬으로 배치해라.
- 마무리는 총평 + "다시 간다면 이렇게 하겠다"는 팁.

[중요] 소제목은 heading 이 아니라 quote 로 만들어라. 짧은 한 줄(15~30자)로.
       실제 상위 노출 블로그들의 문법이 그렇다.
[중요] 문단은 2~4줄로 짧게 끊어라.
`.trim();
}

/** 브랜딩·전문성 모드. */
export function brandingModePrompt(): string {
  return `
[브랜딩·전문성 글]
"~입니다" 전문가체로 쓴다. 아래 구조를 그대로 따라라.
① 권위 선점 — 숫자로 된 실적을 앞에 둔다
② 독자가 겪는 문제 / 흔한 오해를 짚는다
③ 왜 기존 방법이 안 통하는지 설명한다
④ 이름을 붙인 자체 프레임워크를 제시한다 (예: "3단계 OOO 법")
⑤ 예상되는 반박을 Q&A 형태로 미리 없앤다
⑥ 정리 + 행동 유도

- 구획이 바뀌는 지점에 divider 를 1~2회 넣어라.
- ⚠️ 숫자를 지어내지 마라. 사용자가 준 내용 안에 있는 숫자만 써라.
  사용자가 실적 숫자를 주지 않았다면 숫자 없이 써라.

[중요] 소제목은 heading 이 아니라 quote 로 만들어라. 짧은 한 줄(15~30자)로.
[중요] 문단은 2~4줄로 짧게 끊어라.
`.trim();
}

export function modePrompt(mode: WriteMode): string {
  if (mode === "review") return reviewModePrompt();
  if (mode === "branding") return brandingModePrompt();
  return autoModePrompt();
}

/** 유형별 모드는 heading 도 인용구로 처리합니다(6-9). */
export function headingAsQuote(mode: WriteMode): boolean {
  return mode === "review" || mode === "branding";
}

/**
 * 사진 소스별 안내문 (6-5).
 * ⚠️ 소스마다 query 에 담아야 하는 내용이 다릅니다. 검색어일 때도 있고 장면 묘사일 때도 있습니다.
 */
export function photoHintFor(source: PhotoSource, count: number, descs?: string[]): string {
  if (source === "none") {
    return "[사진] 이 글에는 사진을 넣지 않는다. image 섹션을 하나도 만들지 마라.";
  }
  if (source === "local") {
    const list = (descs ?? []).map((d, i) => `  ${i + 1}. ${d}`).join("\n");
    return `
[사진] 사용자가 직접 찍은 사진 ${count}장을 쓴다.
- image 섹션을 정확히 ${count}개 만들어라. 더도 덜도 안 된다.
- query 에는 검색어가 아니라 "그 자리에 어떤 사진이 와야 하는지에 대한 설명"을 한국어로 적어라.
- 사용할 수 있는 사진 목록:
${list || "  (설명 없음 — 순서대로 배치된다)"}
`.trim();
  }
  if (source === "ai") {
    return `
[사진] AI 가 그림을 그려 넣는다.
- image 섹션을 6~8개 배치해라.
- query 에는 검색어가 아니라 "어떤 장면을 그려야 하는지"를 한국어로 구체적으로 묘사해라.
  (피사체·구도·분위기가 드러나게. 예: "김이 오르는 머그컵을 두 손으로 감싼 클로즈업, 창가 아침빛")
`.trim();
  }
  return `
[사진] 인터넷에서 사진을 검색해 넣는다.
- image 섹션을 6~8개 배치해라. (일부 자리는 적합한 사진을 못 찾아 비게 되므로 넉넉히)
- query 에는 그 자리에 쓸 "이미지 검색어"를 한국어로 적어라.
`.trim();
}
