import { db } from "@/lib/db";
import { CONFIG } from "@/config";
import { neuronsPerImage, FREE_NEURONS_PER_DAY } from "@/lib/ai/neurons";
import { getSettings } from "@/lib/settings";

/**
 * Cloudflare 사용량 (6-7 / 7-12)
 *
 * ⚠️ 실측을 보려면 API 토큰에 "Account Analytics: Read" 권한이 필요합니다.
 *   권한이 없으면 401 이 아니라 "not authorized" GraphQL 에러로 옵니다.
 *   그때는 자체 생성 로그로 추정치를 계산하고 화면에 "추정치"라고 표시해야 합니다.
 *
 * ⚠️ 토큰 권한을 나중에 추가할 땐 대시보드에서 Edit 를 쓰세요.
 *   Roll 은 키를 재발급해 .env.local 이 무효가 됩니다.
 */

export type Usage = {
  neuronsUsed: number;
  limit: number;
  measured: boolean; // false 면 추정치
  note: string;
};

/** 오늘 생성한 이미지 수로 추정합니다(로컬 날짜 기준). */
function estimateFromLogs(): number {
  const row = db()
    .prepare(
      `SELECT COUNT(*) AS n FROM images
        WHERE source_site = 'ai'
          AND date(created_at, 'localtime') = date('now', 'localtime')`,
    )
    .get() as { n: number };
  return row.n * neuronsPerImage(getSettings().cfImageSteps);
}

async function fetchMeasured(): Promise<number | null> {
  if (!CONFIG.cfAccountId || !CONFIG.cfApiToken) return null;

  const today = new Date().toISOString().slice(0, 10);
  const query = `
    query Usage($accountTag: String!, $date: Date!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          aiInferenceAdaptiveGroups(limit: 100, filter: { date: $date }) {
            sum { totalNeurons }
          }
        }
      }
    }`;

  try {
    const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CONFIG.cfApiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables: { accountTag: CONFIG.cfAccountId, date: today } }),
      signal: AbortSignal.timeout(15000),
    });
    const json = (await res.json()) as {
      data?: { viewer?: { accounts?: { aiInferenceAdaptiveGroups?: { sum?: { totalNeurons?: number } }[] }[] } };
      errors?: { message?: string }[];
    };
    // ⚠️ 권한이 없으면 HTTP 200 에 GraphQL errors 로 옵니다. res.ok 만 보면 안 됩니다.
    if (json.errors?.length) return null;
    const groups = json.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups ?? [];
    return groups.reduce((n, g) => n + (g.sum?.totalNeurons ?? 0), 0);
  } catch {
    return null;
  }
}

export async function getUsage(): Promise<Usage> {
  const measured = await fetchMeasured();
  if (measured !== null) {
    return { neuronsUsed: measured, limit: FREE_NEURONS_PER_DAY, measured: true, note: "실측" };
  }
  return {
    neuronsUsed: estimateFromLogs(),
    limit: FREE_NEURONS_PER_DAY,
    measured: false,
    note: "추정치 — 실측을 보려면 열쇠에 사용량 조회 권한이 필요합니다",
  };
}

/** 오늘 발행한 글 수. ⚠️ 7-22. 양쪽 다 localtime 으로 비교해야 합니다. */
export function publishedToday(): number {
  const row = db()
    .prepare(
      `SELECT COUNT(*) AS n FROM posts
        WHERE status = 'published'
          AND date(published_at, 'localtime') = date('now', 'localtime')`,
    )
    .get() as { n: number };
  return row.n;
}

/** 마지막 발행으로부터 지난 분. 발행 기록이 없으면 null. */
export function minutesSinceLastPublish(): number | null {
  const row = db()
    .prepare(
      `SELECT (julianday('now') - julianday(published_at)) * 24 * 60 AS mins
         FROM posts WHERE status = 'published' AND published_at IS NOT NULL
        ORDER BY published_at DESC LIMIT 1`,
    )
    .get() as { mins: number } | undefined;
  return row ? row.mins : null;
}
