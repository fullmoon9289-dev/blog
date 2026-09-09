/**
 * 전역 기본값. 환경변수로 덮어쓸 수 있습니다.
 * ⚠️ 여기 값은 "최초 기본값"으로만 쓰입니다. 앱이 한 번이라도 설정을 저장하면
 *    이후에는 DB(settings 테이블)의 값이 우선합니다. → lib/settings.ts
 */
export const CONFIG = {
  port: 4123,

  // ── 발행 안전장치 (2-5) ───────────────────────────────
  // ⚠️ dryRun 기본값을 false 로 바꾸지 마세요. 실제 블로그에 글이 올라갑니다.
  dryRun: true,
  killSwitch: false,
  // ⚠️ 반드시 private. 네이버 발행 레이어의 기본값이 "전체공개"라(7-19),
  //    이 값이 public 이면 "첫 실발행은 비공개로"라는 원칙을 지킬 방법이 없습니다.
  visibility: "private" as VisibilityKey,
  dailyPublishLimit: 3,
  minPublishIntervalMin: 30,

  // ── 수집 / 이미지 ─────────────────────────────────────
  scrapeTopN: 8,
  imageCandidates: 10,
  cfImageSteps: 6,

  // ── 실행 방식 ─────────────────────────────────────────
  showBrowser: false,
  claudeTimeoutSec: 180,
  claudeConcurrency: 2,

  // ── 환경변수에서만 오는 값 ────────────────────────────
  cfAccountId: process.env.CF_ACCOUNT_ID ?? "",
  cfApiToken: process.env.CF_API_TOKEN ?? "",
  claudeBin: process.env.CLAUDE_BIN || "claude",
} as const;

export type VisibilityKey = "public" | "neighbor" | "both" | "private";

/** 설정 항목의 허용 범위. 서버가 저장 시 이 범위로 잘라냅니다(클램프). */
export const LIMITS = {
  dailyPublishLimit: { min: 1, max: 50 },
  minPublishIntervalMin: { min: 0, max: 720 },
  scrapeTopN: { min: 3, max: 30 },
  imageCandidates: { min: 3, max: 20 },
  cfImageSteps: { min: 1, max: 8 },
  claudeTimeoutSec: { min: 30, max: 900 },
  claudeConcurrency: { min: 1, max: 6 },
} as const;

export const VISIBILITY_LABELS: Record<VisibilityKey, string> = {
  public: "전체공개",
  neighbor: "이웃공개",
  both: "서로이웃공개",
  private: "비공개",
};
