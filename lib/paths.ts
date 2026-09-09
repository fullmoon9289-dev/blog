import fs from "node:fs";
import path from "node:path";

/** 모든 산출물은 ./data 아래에만 둡니다 (2-2. 완전 로컬). */
export const DATA_ROOT = path.resolve(process.cwd(), "data");

export const PATHS = {
  root: DATA_ROOT,
  db: path.join(DATA_ROOT, "app.db"),
  session: path.join(DATA_ROOT, "naver-session.json"),
  images: path.join(DATA_ROOT, "images"),
  shots: path.join(DATA_ROOT, "screenshots"),
  dumps: path.join(DATA_ROOT, "dumps"),
};

export function ensureDataDirs(): void {
  for (const dir of [PATHS.root, PATHS.images, PATHS.shots, PATHS.dumps]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * ⚠️ 경로 비교 전 정규화 (7-23).
 * macOS 의 process.cwd() 는 한글을 NFD(자모 분해)로 주는데 브라우저가 보내는 URL
 * 파라미터는 NFC(완성형)입니다. 정규화하지 않으면 같은 폴더인데 startsWith 가 false 가 되어
 * 한글 경로에서 이미지 미리보기가 전부 403 이 됩니다. 이 앱은 한국 사용자용이라 거의 확실히 밟습니다.
 * 윈도우는 C:\Users 와 c:\users 가 같은 경로이므로 대소문자도 통일합니다.
 */
export function normPath(p: string): string {
  const n = path.resolve(p).normalize("NFC");
  return process.platform === "win32" ? n.toLowerCase() : n;
}

/** data 디렉토리 안의 파일인지 검사 (경로 탈출 방지). */
export function isInsideData(target: string): boolean {
  const root = normPath(DATA_ROOT);
  const t = normPath(target);
  return t === root || t.startsWith(root + path.sep);
}

/** ~ 를 홈 디렉토리로 확장합니다. */
export function expandHome(p: string): string {
  if (p === "~") return process.env.HOME ?? p;
  if (p.startsWith("~/")) return path.join(process.env.HOME ?? "", p.slice(2));
  return p;
}
