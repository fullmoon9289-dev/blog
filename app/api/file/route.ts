import fs from "node:fs";
import path from "node:path";
import { isInsideData } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".heic": "image/heic",
};

/**
 * data 디렉토리 안의 파일만 서빙합니다.
 * ⚠️ 7-23. 경로 비교 전에 양쪽 모두 NFC 정규화가 필요합니다(isInsideData 안에서 처리).
 *   macOS 의 cwd 는 한글을 NFD 로 주는데 URL 파라미터는 NFC 라, 정규화하지 않으면
 *   한글 경로에서 모든 이미지 미리보기가 403 이 됩니다.
 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("path");
  if (!raw) return new Response("path 가 필요합니다.", { status: 400 });

  // ⚠️ 경로 탈출 방지는 그대로 유지하고 정규화만 더합니다.
  if (!isInsideData(raw)) return new Response("허용되지 않은 경로입니다.", { status: 403 });

  /**
   * ⚠️ 7-23 의 같은 계열. 경로 검사는 정규화로 통과시켜도, 실제 파일을 열 때
   *   원본 문자열을 그대로 쓰면 404 가 납니다.
   *   macOS 는 파일시스템이 정규화를 흡수해 드러나지 않지만, 리눅스는 NFC 와 NFD 를
   *   "다른 파일 이름"으로 취급합니다(측정으로 확인: NFC 200 / NFD 404).
   *   그래서 원본 → NFC → NFD 순으로 실제 존재하는 이름을 찾습니다.
   */
  const candidates = [raw, raw.normalize("NFC"), raw.normalize("NFD")];
  const real = candidates.find((c) => { try { return fs.statSync(c).isFile(); } catch { return false; } });
  if (!real) return new Response("파일을 찾을 수 없습니다.", { status: 404 });

  try {
    const buf = fs.readFileSync(real);
    const type = TYPES[path.extname(real).toLowerCase()] ?? "application/octet-stream";
    return new Response(new Uint8Array(buf), {
      headers: { "Content-Type": type, "Cache-Control": "no-store" },
    });
  } catch {
    return new Response("파일을 찾을 수 없습니다.", { status: 404 });
  }
}
