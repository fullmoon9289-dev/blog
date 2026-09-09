import fs from "node:fs";
import { z } from "zod";
import path from "node:path";
import { runClaudeJson } from "@/lib/claude";
import { PhotoDescSchema, type Draft } from "@/lib/types";
import { expandHome } from "@/lib/paths";

/** 내 사진 쓰기 (6-8) */

const EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic"]);

export function listPhotos(folder: string): { ok: true; files: string[] } | { ok: false; error: string } {
  const dir = expandHome(folder.trim());
  try {
    if (!fs.statSync(dir).isDirectory()) return { ok: false, error: "폴더가 아닙니다." };
  } catch {
    return { ok: false, error: "폴더를 찾을 수 없습니다." };
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => EXTS.has(path.extname(f).toLowerCase()))
    // ⚠️ 파일명 자연순 정렬 — IMG_2.jpg 가 IMG_10.jpg 보다 앞에 와야 합니다.
    .sort((a, b) => a.localeCompare(b, "ko", { numeric: true }))
    .map((f) => path.join(dir, f));

  if (files.length === 0) return { ok: false, error: "폴더에 사진이 없습니다." };
  return { ok: true, files };
}

/**
 * 사진마다 한 줄 설명(30자)을 만듭니다.
 * ⚠️ 6-8 / 6-10. 이 설명은 "본문 생성 전에 한 번만" 만들고 프롬프트와 배치에 재사용해야 합니다.
 *   두 번 만들면 claude 호출이 배로 듭니다. 그래서 이 함수를 파이프라인에서 한 번만 부르고,
 *   결과를 fillImages 에 인자로 넘깁니다.
 */
export async function describePhotos(
  files: string[],
  onLog?: (msg: string) => void,
): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const res = await runClaudeJson(
      "첨부된 사진에 무엇이 찍혔는지 한국어 30자 이내 한 줄로 설명하라. {\"desc\": \"...\"} 만 출력하라.",
      PhotoDescSchema,
      { images: [files[i]], retries: 1 },
    );
    const desc = res.ok ? res.data.desc : path.basename(files[i]);
    out.push(desc);
    onLog?.(`사진 ${i + 1}/${files.length}: ${desc}`);
  }
  return out;
}

export type PlacementMode = "order" | "ai";

/**
 * 사진을 글의 이미지 자리에 배치합니다.
 * ⚠️ ai 매칭이 실패하거나 누락되면 "순서대로 채우는 폴백"이 반드시 있어야 합니다.
 *   폴백이 없으면 사진이 통째로 빠집니다.
 */
export async function placePhotos(
  draft: Draft,
  files: string[],
  descs: string[],
  mode: PlacementMode,
  onLog?: (msg: string) => void,
): Promise<(string | null)[]> {
  const slots = draft.sections
    .map((s, i) => (s.type === "image" ? { i, query: s.query, caption: s.caption ?? "" } : null))
    .filter((x): x is { i: number; query: string; caption: string } => x !== null);

  const result: (string | null)[] = slots.map(() => null);

  if (mode === "order" || files.length === 0) {
    slots.forEach((_, k) => { result[k] = files[k] ?? null; });
    return result;
  }

  // AI 매칭
  const schema = z.object({
    pairs: z.array(z.object({ slot: z.number(), photo: z.number() })),
  });

  const slotList = slots.map((s, k) => `  자리 ${k}: ${s.query}${s.caption ? ` (설명: ${s.caption})` : ""}`).join("\n");
  const photoList = descs.map((d, k) => `  사진 ${k}: ${d}`).join("\n");

  const res = await runClaudeJson(
    `블로그 글의 사진 자리와, 사용자가 가진 사진을 짝지어라.

[사진이 들어갈 자리]
${slotList}

[가지고 있는 사진]
${photoList}

사진 하나는 자리 하나에만 쓴다. 어울리지 않으면 짝짓지 않아도 된다.
{"pairs": [{"slot": 0, "photo": 2}, ...]} 만 출력하라.`,
    schema,
    { retries: 1 },
  );

  const usedPhotos = new Set<number>();
  if (res.ok) {
    for (const p of res.data.pairs) {
      if (p.slot >= 0 && p.slot < slots.length && p.photo >= 0 && p.photo < files.length && !usedPhotos.has(p.photo)) {
        result[p.slot] = files[p.photo];
        usedPhotos.add(p.photo);
      }
    }
  } else {
    onLog?.(`사진 매칭에 실패해 순서대로 배치합니다: ${res.error}`);
  }

  // ⚠️ 폴백 — 매칭 실패·누락분은 남은 사진을 순서대로 채웁니다.
  const leftovers = files.map((_, k) => k).filter((k) => !usedPhotos.has(k));
  let li = 0;
  for (let k = 0; k < result.length; k++) {
    if (result[k] === null && li < leftovers.length) {
      result[k] = files[leftovers[li++]];
    }
  }
  const filled = result.filter(Boolean).length;
  onLog?.(`사진 배치: ${filled}/${slots.length}자리`);
  return result;
}
