import fs from "node:fs";
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

  // ⚠️ 반드시 headless:false. 사용자가 직접 입력해야 합니다.
  const { browser, context } = await newContext({ headless: false });
  try {
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
    loginInFlight = false;
    await closeQuietly(browser);
  }
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
