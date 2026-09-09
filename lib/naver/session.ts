import fs from "node:fs";
import path from "node:path";
import { newContext, closeQuietly } from "@/lib/playwright";
import { NAVER } from "@/lib/scrape/selectors";
import { PATHS, ensureDataDirs } from "@/lib/paths";

/** 네이버 로그인 세션 (6-3 / 7-9 / 7-10) */

export type SessionState = {
  valid: boolean;
  blogId?: string;
  /** 읽기는 되는데 글쓰기만 만료된 상태 (7-10) */
  canWrite: boolean;
  reason: string;
};

// ── 로그인 ────────────────────────────────────────────────────────

/** ⚠️ 동시에 로그인 창이 여러 개 뜨는 것을 막습니다. */
let loginInFlight = false;

/**
 * ⚠️ 2-4. 네이버 로그인은 자동화하지 않습니다.
 *   보안문자·2차인증 때문입니다. 창을 띄워 사용자가 직접 로그인하게 하고,
 *   NID_SES 쿠키가 생기면 storageState 를 저장해 재사용합니다.
 *   아이디·비밀번호를 코드가 다루지 않으므로 계정 정보가 앱에 저장되지 않습니다.
 */
export async function loginInteractive(
  onLog?: (msg: string) => void,
): Promise<{ ok: true; blogId?: string } | { ok: false; error: string }> {
  if (loginInFlight) return { ok: false, error: "이미 로그인 창이 열려 있습니다." };
  loginInFlight = true;
  ensureDataDirs();

  /**
   * ⚠️ 브라우저 실행을 반드시 try 안에서 합니다.
   *   전에는 이 줄이 try "밖"에 있어서, 실행이 실패하면 예외가 이 함수를 그대로 빠져나가
   *   API 라우트까지 올라가 500(HTML) 이 되었습니다. 화면은 그 500 을 JSON 으로 읽으려다
   *   또 터져서, 사용자에게는 아무 안내도 뜨지 않고 개발 배지에 "1 Issue" 만 남았습니다.
   *   게다가 finally 가 실행되지 않아 loginInFlight 이 영원히 true 로 남아,
   *   이후 로그인 시도가 전부 "이미 로그인 창이 열려 있습니다" 로 거절되었습니다(앱 재시작 전까지).
   */
  let browser: Awaited<ReturnType<typeof newContext>>["browser"] | null = null;
  try {
    // ⚠️ 반드시 headless:false. 사용자가 직접 입력해야 합니다.
    let context: Awaited<ReturnType<typeof newContext>>["context"];
    try {
      const ctx = await newContext({ headless: false });
      browser = ctx.browser;
      context = ctx.context;
    } catch (e) {
      const raw = (e as Error).message;
      writeLaunchLog(raw);
      return { ok: false, error: launchErrorMessage(raw) };
    }

    const page = await context.newPage();
    await page.goto(NAVER.login, { waitUntil: "domcontentloaded", timeout: 60000 });
    onLog?.("로그인 창을 열었습니다. 창에서 직접 로그인해 주세요.");
    onLog?.("'로그인 상태 유지'를 꼭 켜주세요. 안 하면 몇 시간 뒤 다시 로그인해야 합니다.");

    // 1초 간격으로 NID_SES 쿠키를 확인합니다. 최대 5분.
    const deadline = Date.now() + 5 * 60 * 1000;
    let loggedIn = false;
    while (Date.now() < deadline) {
      if (page.isClosed()) {
        return { ok: false, error: "로그인 창이 닫혔습니다. 다시 시도해 주세요." };
      }
      const cookies = await context.cookies();
      if (cookies.some((c) => c.name === "NID_SES" && c.value)) { loggedIn = true; break; }
      await page.waitForTimeout(1000);
    }
    if (!loggedIn) return { ok: false, error: "5분 안에 로그인이 완료되지 않았습니다." };

    // 쿠키를 안정화하기 위해 naver.com 을 한 번 거칩니다.
    await page.goto(NAVER.home, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(800);
    await context.storageState({ path: PATHS.session });
    onLog?.("로그인 정보를 저장했습니다.");

    invalidateSessionCache();
    // 블로그 주소를 미리 알아둡니다(있으면).
    let blogId: string | undefined;
    try {
      await page.goto(NAVER.myBlog, { waitUntil: "domcontentloaded", timeout: 30000 });
      blogId = extractBlogId(page.url());
    } catch { /* 없어도 진행합니다 */ }

    return { ok: true, blogId };
  } catch (e) {
    return { ok: false, error: `로그인 중 문제가 생겼습니다: ${(e as Error).message}` };
  } finally {
    // ⚠️ 어떤 경로로 빠져나가든 반드시 해제합니다. 안 그러면 다시 로그인할 수 없습니다.
    loginInFlight = false;
    await closeQuietly(browser);
  }
}

/**
 * 브라우저를 못 띄웠을 때, 원문 대신 사람이 읽는 문장으로 바꿉니다.
 *
 * ⚠️ 판별 순서가 중요합니다. 구체적인 원인을 먼저 검사하세요.
 *   전에는 "browser has been closed" 를 먼저 검사해서, 실제 원인이 "화면이 없음"인데도
 *   "창이 예상보다 빨리 닫혔습니다" 라는 엉뚱한 안내가 나갔습니다.
 *   Playwright 는 진짜 원인을 첫 줄이 아니라 "Browser logs:" 아래에 적어두므로
 *   첫 줄만 보지 말고 원문 전체에서 찾아야 합니다.
 */
function launchErrorMessage(raw: string): string {
  if (/Executable doesn'?t exist|please run .*install|npx playwright install/i.test(raw)) {
    return "네이버 로그인 창을 띄울 브라우저가 설치되지 않았습니다. 명령어 창에서 npx playwright install chromium 을 실행한 뒤 다시 눌러주세요.";
  }
  if (/Missing X server|\$DISPLAY|without having a XServer|no display/i.test(raw)) {
    return "화면이 없는 환경이라 로그인 창을 띄울 수 없습니다. 이 앱은 화면이 있는 내 컴퓨터에서 실행해야 합니다.";
  }
  if (/EACCES|EPERM|access is denied|permission denied/i.test(raw)) {
    return "브라우저를 실행할 권한이 없습니다. 백신이나 보안 프로그램이 막고 있는지 확인해 주세요.";
  }
  const first = raw.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return `네이버 로그인 창을 띄우지 못했습니다. 자세한 내용을 data/login-error.log 에 적어두었으니 그 파일을 알려주세요. (${first.slice(0, 120)})`;
}

/** 원문 오류는 화면에 쏟지 않고 파일에 남깁니다. */
function writeLaunchLog(raw: string): void {
  try {
    fs.writeFileSync(
      path.join(PATHS.root, "login-error.log"),
      `${new Date().toISOString()}\n플랫폼: ${process.platform}\n\n${raw}\n`,
    );
  } catch { /* 로그 실패가 로그인 실패를 덮으면 안 됩니다 */ }
}

export function hasSessionFile(): boolean {
  return fs.existsSync(PATHS.session);
}

export function logout(): void {
  try { fs.unlinkSync(PATHS.session); } catch { /* 이미 없을 수 있습니다 */ }
  invalidateSessionCache();
}

export function extractBlogId(url: string): string | undefined {
  const m = url.match(/blog\.naver\.com\/([A-Za-z0-9_-]+)/);
  if (m && !/^(MyBlog|PostList|PostView)/i.test(m[1])) return m[1];
  const q = url.match(/[?&]blogId=([A-Za-z0-9_-]+)/);
  return q?.[1];
}

// ── 세션 검증 ─────────────────────────────────────────────────────

/** ⚠️ 검증은 브라우저를 띄우므로 TTL 5분 캐시를 둡니다. */
let cache: { at: number; state: SessionState } | null = null;
const TTL_MS = 5 * 60 * 1000;

export function invalidateSessionCache(): void {
  cache = null;
}

export async function verifySession(force = false): Promise<SessionState> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.state;

  if (!hasSessionFile()) {
    const state: SessionState = { valid: false, canWrite: false, reason: "아직 로그인하지 않았습니다." };
    cache = { at: Date.now(), state };
    return state;
  }

  const { browser, context } = await newContext({ headless: true, useNaverSession: true });
  try {
    const page = await context.newPage();

    /**
     * ⚠️ 7-9. naver.com 의 로그인 링크로 판정하면 안 됩니다.
     *   로그인 상태에서도 nidlogin 링크가 남아 있어 항상 "만료"로 나옵니다.
     *   blog.naver.com/MyBlog.naver 로 이동해 "로그인 페이지로 튕기는지"로 판정합니다.
     */
    await page.goto(NAVER.myBlog, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (page.url().includes("nid.naver.com")) {
      const state: SessionState = { valid: false, canWrite: false, reason: "로그인이 풀렸습니다. 다시 로그인해 주세요." };
      cache = { at: Date.now(), state };
      return state;
    }

    const blogId = extractBlogId(page.url());
    if (!blogId) {
      const state: SessionState = { valid: true, canWrite: false, reason: "블로그 주소를 확인하지 못했습니다." };
      cache = { at: Date.now(), state };
      return state;
    }

    /**
     * ⚠️★ 7-10. 읽기는 되는데 글쓰기만 만료된 상태가 실제로 존재합니다.
     *   로그인할 때 "로그인 상태 유지"를 체크하지 않으면 NID_AUT/NID_SES 가
     *   만료시각 없는 세션 쿠키가 되어 브라우저 종료와 함께 사라지고,
     *   일부 읽기 경로만 살아남습니다. 그래서 글쓰기 페이지까지 열어봐야 합니다.
     */
    await page.goto(NAVER.write(blogId), { waitUntil: "domcontentloaded", timeout: 40000 });
    if (page.url().includes("nid.naver.com")) {
      const state: SessionState = {
        valid: true, blogId, canWrite: false,
        reason: "글쓰기 권한이 만료됐습니다. 다시 로그인할 때 '로그인 상태 유지'를 켜주세요.",
      };
      cache = { at: Date.now(), state };
      return state;
    }

    const state: SessionState = { valid: true, blogId, canWrite: true, reason: "로그인 유효" };
    cache = { at: Date.now(), state };
    return state;
  } catch (e) {
    // 확인 실패를 "유효"로 보고하지 않습니다 (8-2).
    const state: SessionState = { valid: false, canWrite: false, reason: `로그인 상태를 확인하지 못했습니다: ${(e as Error).message}` };
    cache = { at: Date.now(), state };
    return state;
  } finally {
    await closeQuietly(browser);
  }
}
