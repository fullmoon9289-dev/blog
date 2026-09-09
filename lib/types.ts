import { z } from "zod";

// ── 섹션 모델 (6-5) ────────────────────────────────────────────────
// 글은 문자열이 아니라 섹션 배열입니다. 에디터가 타입마다 다른 서식을 적용합니다.

export const SectionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), text: z.string().min(1) }),
  z.object({
    type: z.literal("paragraph"),
    text: z.string().min(1),
    // highlight: text 안에 "글자 그대로" 있어야 하는 핵심 구절. 형광펜(노랑)+굵게로 처리됩니다.
    // ⚠️ AI 가 본문에 없는 문구를 지어냅니다(실측 5개 중 1개). sanitizeDraft() 가 걸러냅니다. → 7-24
    highlight: z.string().optional(),
  }),
  z.object({ type: z.literal("quote"), text: z.string().min(1) }),
  z.object({ type: z.literal("divider") }),
  z.object({
    type: z.literal("image"),
    query: z.string().min(1),
    caption: z.string().optional(),
  }),
]);

export type Section = z.infer<typeof SectionSchema>;
export type ImageSection = Extract<Section, { type: "image" }>;

export const DraftSchema = z.object({
  title: z.string().min(1),
  sections: z.array(SectionSchema).min(3),
});
export type Draft = z.infer<typeof DraftSchema>;

export type PhotoSource = "local" | "crawl" | "ai" | "none";
export type WriteMode = "auto" | "review" | "branding";
export type ImageStyle = "photo" | "illust";

/**
 * 사진 소스별로 이미지 섹션 개수 요구가 다릅니다.
 * ⚠️ 6개 이상 강제를 모든 모드에 적용하면 안 됩니다. 사진이 4장뿐인 local 모드에서는
 *    6개를 만들 수 없어 재시도만 3번 돌다 실패합니다.
 */
export function draftSchemaFor(photoSource: PhotoSource, localCount = 0): z.ZodType<Draft> {
  if (photoSource === "none") {
    return DraftSchema.refine(
      (d) => d.sections.every((s) => s.type !== "image"),
      { message: "사진 없음 모드에서는 image 섹션을 만들면 안 됩니다." },
    );
  }
  if (photoSource === "local") {
    return DraftSchema.refine(
      (d) => d.sections.filter((s) => s.type === "image").length === localCount,
      { message: `image 섹션이 정확히 ${localCount}개여야 합니다(사진 장수와 같아야 함).` },
    );
  }
  // crawl / ai — 일부 자리는 적합한 사진을 못 찾으므로 넉넉히 받습니다.
  return DraftSchema.refine(
    (d) => d.sections.filter((s) => s.type === "image").length >= 6,
    { message: "image 섹션이 6개 이상이어야 합니다." },
  );
}

// ── 글감 (6-5) ─────────────────────────────────────────────────────

export const IdeaSchema = z.object({
  title: z.string().min(1),
  angle: z.string().min(1),
  rationale: z.string().min(1),
});
export const IdeasSchema = z.object({ ideas: z.array(IdeaSchema).min(1) });
export type Idea = z.infer<typeof IdeaSchema>;

// ── 수집 자료 ──────────────────────────────────────────────────────

export type SourceItem = {
  type: "news" | "blog";
  title: string;
  summary: string;
  url: string;
};

// ── 비전 판정 (6-6) ────────────────────────────────────────────────

/** 크롤링 사진 판정 — 세 축을 따로 묻습니다. */
export const CrawlVerdictSchema = z.object({
  fit: z.boolean(),
  watermark: z.boolean(),
  koreanPerson: z.boolean(),
  reason: z.string(),
});
export type CrawlVerdict = z.infer<typeof CrawlVerdictSchema>;

/**
 * ⚠️ 7-13. 생성 이미지에 크롤링용 판정을 쓰지 마세요.
 * 생성물에는 워터마크도 초상권도 없습니다. koreanPerson 필터를 그대로 돌리면
 * 멀쩡한 생성 이미지가 탈락합니다. 네 가지만 봅니다.
 */
export const GenVerdictSchema = z.object({
  fit: z.boolean(),
  brokenShape: z.boolean(),
  hasText: z.boolean(),
  lowQuality: z.boolean(),
  reason: z.string(),
});
export type GenVerdict = z.infer<typeof GenVerdictSchema>;

export const GenPromptSchema = z.object({ prompt: z.string().min(10) });
export const PhotoDescSchema = z.object({ desc: z.string().min(1) });
