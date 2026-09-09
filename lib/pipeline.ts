import path from "node:path";
import { db } from "@/lib/db";
import { jobLog, setJobStage, setJobError } from "@/lib/log";
import { getSettings } from "@/lib/settings";
import { collectSources } from "@/lib/scrape/trends";
import { generateIdeas, generateDraft, draftStats } from "@/lib/ai/content";
import { headingAsQuote } from "@/lib/ai/templates";
import { fillSlots, jobImageDir } from "@/lib/scrape/images";
import { generateForSlot, contextAround, cloudflareConfigured } from "@/lib/ai/imagegen";
import { verdictReason } from "@/lib/ai/vision";
import { listPhotos, describePhotos, placePhotos, type PlacementMode } from "@/lib/localPhotos";
import { publishDraft } from "@/lib/naver/publish";
import { verifySession } from "@/lib/naver/session";
import { publishedToday, minutesSinceLastPublish } from "@/lib/ai/cfUsage";
import type { Draft, ImageStyle, PhotoSource, SourceItem, WriteMode } from "@/lib/types";

export type JobInputs = {
  mode: WriteMode;
  keyword: string;
  photoSource: PhotoSource;
  imageStyle?: ImageStyle;
  photoFolder?: string;
  placement?: PlacementMode;
  userContent?: string;
};

export function createJob(inputs: JobInputs): number {
  const info = db()
    .prepare("INSERT INTO jobs (keyword, status, mode, auto, inputs) VALUES (?, 'pending', ?, ?, ?)")
    .run(inputs.keyword, inputs.mode, inputs.mode === "auto" ? 1 : 0, JSON.stringify(inputs));
  return Number(info.lastInsertRowid);
}

export function hasRunningJob(): boolean {
  const row = db()
    .prepare(
      `SELECT COUNT(*) n FROM jobs
        WHERE status IN ('pending','scraping','writing','imaging','publishing')`,
    )
    .get() as { n: number };
  return row.n > 0;
}

// ── 발행 가드 (6-9) ──────────────────────────────────────────────

export type Guard = { blocked: true; reason: string } | { blocked: false };

/** ⚠️ 연습 모드가 아닐 때만 검사합니다. 연습 모드는 발행하지 않으므로 막을 이유가 없습니다. */
export function checkPublishGuards(): Guard {
  const s = getSettings();
  if (s.dryRun) return { blocked: false };
  if (s.killSwitch) return { blocked: true, reason: "전체 중단이 켜져 있어 발행하지 않았습니다." };

  const today = publishedToday();
  if (today >= s.dailyPublishLimit) {
    return { blocked: true, reason: `오늘 발행 한도(${s.dailyPublishLimit}편)에 도달해 발행하지 않았습니다.` };
  }
  const mins = minutesSinceLastPublish();
  if (mins !== null && mins < s.minPublishIntervalMin) {
    const wait = Math.ceil(s.minPublishIntervalMin - mins);
    return { blocked: true, reason: `마지막 발행 후 ${wait}분 더 기다려야 합니다(최소 간격 ${s.minPublishIntervalMin}분).` };
  }
  return { blocked: false };
}

// ── 이미지 채우기 ────────────────────────────────────────────────

/**
 * ⚠️ 6-10. photoDescs 를 "인자로" 받습니다. 내부에서 만들지 마세요.
 *   본문 생성 단계에서 만든 사진 설명을 그대로 넘겨 재사용해야 합니다.
 *   인자로 받지 않으면 이미지 단계에서 다시 만들게 되고 claude 호출이 배로 듭니다.
 */
async function fillImages(
  jobId: number,
  draftId: number,
  draft: Draft,
  opts: { photoSource: PhotoSource; imageStyle: ImageStyle; photos: string[]; photoDescs: string[]; placement: PlacementMode },
): Promise<(string | null)[]> {
  const s = getSettings();
  const slots = draft.sections
    .map((sec, i) => (sec.type === "image" ? { i, sec } : null))
    .filter((x): x is { i: number; sec: Extract<Draft["sections"][number], { type: "image" }> } => x !== null);

  const record = db().prepare(
    `INSERT INTO images (job_id, draft_id, query, src_url, local_path, source_site,
                         verdict_ok, verdict_reason, section_index, gen_prompt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  if (opts.photoSource === "none" || slots.length === 0) return [];

  if (opts.photoSource === "local") {
    const placed = await placePhotos(draft, opts.photos, opts.photoDescs, opts.placement, (m) => jobLog(jobId, m));
    placed.forEach((p, k) => {
      // ⚠️ 6-8. 사용자가 직접 찍은 사진이므로 워터마크·초상권 필터를 적용하지 않습니다.
      record.run(jobId, draftId, slots[k].sec.query, null, p, "local", p ? 1 : 0,
        p ? "내 사진" : "배치할 사진 부족", slots[k].i, null);
    });
    return placed;
  }

  const dir = jobImageDir(jobId);

  if (opts.photoSource === "ai") {
    const out: (string | null)[] = [];
    for (let k = 0; k < slots.length; k++) {
      const { i, sec } = slots[k];
      jobLog(jobId, `사진 ${k + 1}/${slots.length}: ${sec.query}`);
      const around = contextAround(draft.sections, i);
      const r = await generateForSlot(
        draft.title, sec.query, sec.caption, around, opts.imageStyle, s.cfImageSteps,
        path.join(dir, `gen-${k}`), (m) => jobLog(jobId, m),
      );
      record.run(jobId, draftId, sec.query, null, r.localPath ?? null, "ai",
        r.ok ? 1 : 0, r.reason, i, r.prompt ?? null);
      out.push(r.ok ? (r.localPath ?? null) : null);
      if (!r.ok) jobLog(jobId, `사진을 못 만들어 이 자리는 비웁니다: ${r.reason}`, "warn");
    }
    return out;
  }

  // crawl — 브라우저를 한 번만 띄워 자리 전부를 처리합니다.
  const results = await fillSlots(
    dir,
    slots.map(({ i, sec }) => ({ query: sec.query, title: draft.title, around: contextAround(draft.sections, i) })),
    s.imageCandidates,
    (m) => jobLog(jobId, m),
  );

  return results.map((res, k) => {
    const { i, sec } = slots[k];
    // ⚠️ 6-6. 탈락한 이미지도 사유와 함께 기록합니다.
    //    워터마크·초상권 필터가 실제로 동작하는지 사용자가 확인할 유일한 통로입니다.
    for (const a of res.attempts) {
      const ok = a.verdict.fit && a.localPath === res.accepted?.localPath;
      record.run(jobId, draftId, sec.query, a.srcUrl, a.localPath, a.sourceSite,
        ok ? 1 : 0, verdictReason(a.verdict), i, null);
    }
    if (!res.accepted) jobLog(jobId, `"${sec.query}" 자리에 쓸 만한 사진을 못 찾아 비웁니다.`, "warn");
    return res.accepted?.localPath ?? null;
  });
}

// ── 메인 오케스트레이션 ──────────────────────────────────────────

/**
 * ⚠️ 6-10. runJob 은 fire-and-forget 입니다.
 *   API 라우트에서 await 하지 말고 .catch(console.error) 만 붙여 즉시 응답하세요.
 *   진행 상황은 SSE 로 봅니다.
 */
export async function runJob(jobId: number): Promise<void> {
  const conn = db();
  const row = conn.prepare("SELECT keyword, inputs FROM jobs WHERE id = ?").get(jobId) as
    | { keyword: string; inputs: string }
    | undefined;
  if (!row) return;

  const inputs = JSON.parse(row.inputs) as JobInputs;
  const s = getSettings();

  try {
    // ── 수집 (자동 발굴만) ──
    let sources: SourceItem[] = [];
    if (inputs.mode === "auto") {
      setJobStage(jobId, "scraping", "뉴스·블로그 수집");
      jobLog(jobId, `"${inputs.keyword}" 로 뜨는 글을 모으는 중입니다.`);
      const col = await collectSources(inputs.keyword, s.scrapeTopN, { headless: !s.showBrowser });
      if (!col.ok) { setJobError(jobId, col.error); jobLog(jobId, col.error, "error"); return; }
      sources = col.items;
      const ins = conn.prepare("INSERT INTO sources (job_id, type, title, summary, url) VALUES (?,?,?,?,?)");
      for (const it of sources) ins.run(jobId, it.type, it.title, it.summary, it.url);
      jobLog(jobId, `자료 ${sources.length}건을 모았습니다.`, "ok");
    }

    // ── 내 사진: 설명은 여기서 "한 번만" 만듭니다 ──
    let photos: string[] = [];
    let photoDescs: string[] = [];
    if (inputs.photoSource === "local") {
      const l = listPhotos(inputs.photoFolder ?? "");
      if (!l.ok) { setJobError(jobId, l.error); jobLog(jobId, l.error, "error"); return; }
      photos = l.files;
      jobLog(jobId, `사진 ${photos.length}장을 찾았습니다. 어떤 사진인지 살펴봅니다.`);
      photoDescs = await describePhotos(photos, (m) => jobLog(jobId, m));
    }

    // ── 글감 ──
    setJobStage(jobId, "writing", "글감과 본문");
    let chosen = null;
    if (inputs.mode === "auto") {
      jobLog(jobId, "글감을 찾는 중입니다.");
      const ideas = await generateIdeas(inputs.keyword, sources, 5);
      if (!ideas.ok) { setJobError(jobId, ideas.error); jobLog(jobId, ideas.error, "error"); return; }
      const insIdea = conn.prepare("INSERT INTO ideas (job_id, title, angle, rationale, chosen) VALUES (?,?,?,?,?)");
      ideas.ideas.forEach((it, i) => insIdea.run(jobId, it.title, it.angle, it.rationale, i === 0 ? 1 : 0));
      chosen = ideas.ideas[0];
      jobLog(jobId, `글감 ${ideas.ideas.length}개 중 "${chosen.title}" 로 씁니다.`, "ok");
    }

    // ── 본문 ──
    jobLog(jobId, "글을 쓰는 중입니다. 1~3분쯤 걸립니다.");
    const d = await generateDraft(inputs.keyword, chosen, sources, {
      mode: inputs.mode,
      photoSource: inputs.photoSource,
      localCount: photos.length,
      photoDescs,
      userContent: inputs.userContent,
    });
    if (!d.ok) { setJobError(jobId, d.error); jobLog(jobId, d.error, "error"); return; }
    if (d.note) jobLog(jobId, d.note, "warn");
    if (d.droppedHighlights > 0) {
      jobLog(jobId, `본문에 없는 강조 구절 ${d.droppedHighlights}개를 걸러냈습니다.`, "warn");
    }
    const draftId = Number(
      conn.prepare("INSERT INTO drafts (job_id, idea_id, title, body_json) VALUES (?,?,?,?)")
        .run(jobId, null, d.draft.title, JSON.stringify(d.draft.sections)).lastInsertRowid,
    );
    const st = draftStats(d.draft);
    jobLog(jobId, `글을 다 썼습니다. ${st.chars}자, 사진 자리 ${st.image}개.`, "ok");

    // ── 사진 ──
    setJobStage(jobId, "imaging", "사진 준비");
    if (inputs.photoSource === "ai" && !cloudflareConfigured()) {
      jobLog(jobId, "AI 사진을 만들려면 열쇠가 필요합니다. 사진 없이 진행합니다.", "warn");
    }
    const imagePaths = await fillImages(jobId, draftId, d.draft, {
      photoSource: inputs.photoSource,
      imageStyle: inputs.imageStyle ?? "photo",
      photos,
      photoDescs,
      placement: inputs.placement ?? "order",
    });
    const got = imagePaths.filter(Boolean).length;
    if (st.image > 0) jobLog(jobId, `사진 ${got}/${st.image}자리를 채웠습니다.`, got > 0 ? "ok" : "warn");

    // ── 발행 ──
    setJobStage(jobId, "publishing", "네이버 에디터");
    const guard = checkPublishGuards();
    if (guard.blocked) {
      conn.prepare("INSERT INTO posts (job_id, draft_id, status, note) VALUES (?,?,'blocked',?)")
        .run(jobId, draftId, guard.reason);
      jobLog(jobId, guard.reason, "warn");
      setJobStage(jobId, "done", "중단됨");
      return;
    }

    const session = await verifySession();
    if (!session.canWrite || !session.blogId) {
      const note = session.reason;
      conn.prepare("INSERT INTO posts (job_id, draft_id, status, note) VALUES (?,?,'failed',?)")
        .run(jobId, draftId, note);
      setJobError(jobId, note);
      jobLog(jobId, note, "error");
      return;
    }

    jobLog(jobId, s.dryRun
      ? "연습 모드입니다. 글을 에디터에 넣어보고 완성 화면만 저장합니다."
      : "네이버 에디터에 글을 씁니다.");

    /**
     * ⚠️ 6-10. 발행 단계에 15분 상한을 겁니다.
     *   에디터가 멈추면 잡이 영원히 publishing 으로 남습니다.
     */
    const result = await Promise.race([
      publishDraft({
        blogId: session.blogId,
        draft: d.draft,
        imagePaths,
        dryRun: s.dryRun,
        visibility: s.visibility,
        headless: !s.showBrowser,
        headingAsQuote: headingAsQuote(inputs.mode),
        screenshotName: `job-${jobId}.png`,
        onLog: (m, l) => jobLog(jobId, m, l),
      }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("에디터 작업이 15분을 넘겨 중단했습니다.")), 15 * 60 * 1000)),
    ]);

    // ⚠️ published 일 때만 published_at 을 채웁니다(발행 한도 계산의 근거).
    conn.prepare(
      `INSERT INTO posts (job_id, draft_id, status, blog_url, screenshot, note, published_at)
       VALUES (?,?,?,?,?,?, CASE WHEN ? = 'published' THEN datetime('now') ELSE NULL END)`,
    ).run(jobId, draftId, result.status, result.blogUrl ?? null, result.screenshot ?? null,
      result.note, result.status);

    if (result.missingCaptions > 0) jobLog(jobId, `사진 설명 ${result.missingCaptions}개를 넣지 못했습니다.`, "warn");
    if (result.skippedImages > 0) jobLog(jobId, `사진이 없어 ${result.skippedImages}자리를 비웠습니다.`, "warn");

    if (result.status === "failed") {
      setJobError(jobId, result.note);
      jobLog(jobId, result.note, "error");
    } else {
      setJobStage(jobId, "done", result.status === "published" ? "발행 완료" : "연습 완료");
      jobLog(jobId, result.note, "ok");
    }
  } catch (e) {
    const msg = (e as Error).message;
    setJobError(jobId, msg);
    jobLog(jobId, msg, "error");
  }
}
