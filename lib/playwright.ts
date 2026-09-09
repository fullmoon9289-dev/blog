import { chromium, type Browser, type BrowserContext } from "playwright";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { PATHS } from "@/lib/paths";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * ⚠️ 설치 Promise 를 모듈 레벨에 캐싱합니다.
 * 여러 잡이 동시에 브라우저를 띄우면 npx playwright install 이 중복 실행됩니다.
 */
let installPromise: Promise<void> | null = null;

function installChromium(): Promise<void> {
  if (installPromise) return installPromise;
  installPromise = new Promise<void>((resolve, reject) => {
    console.log("[playwright] chromium 이 없어 설치합니다. 몇 분 걸릴 수 있습니다…");
    // 윈도우에서는 npx 도 셸 심이라 shell 이 필요합니다.
    const p = spawn("npx", ["playwright", "install", "chromium"], {
      shell: process.platform === "win32",
      stdio: "inherit",
    });
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`chromium 설치 실패 (종료코드 ${code})`)),
    );
  });
  return installPromise;
}

export type ContextOpts = {
  headless?: boolean;
  /** 저장된 네이버 로그인 정보를 입힐지 */
  useNaverSession?: boolean;
};

export async function newContext(
  opts: ContextOpts = {},
): Promise<{ browser: Browser; context: BrowserContext }> {
  const headless = opts.headless ?? true;

  let browser: Browser;
  try {
    browser = await chromium.launch({ headless });
  } catch (e) {
    const msg = (e as Error).message;
    // "Executable doesn't exist" / "please run" / "install" 이면 설치 후 1회 재시도
    if (/Executable doesn'?t exist|please run|install/i.test(msg)) {
      await installChromium();
      browser = await chromium.launch({ headless });
    } else {
      throw e;
    }
  }

  const hasSession = opts.useNaverSession && fs.existsSync(PATHS.session);
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    userAgent: UA,
    ...(hasSession ? { storageState: PATHS.session } : {}),
  });

  return { browser, context };
}

/** 브라우저를 확실히 닫습니다. 실패해도 파이프라인을 죽이지 않습니다. */
export async function closeQuietly(browser?: Browser | null): Promise<void> {
  try { await browser?.close(); } catch { /* 이미 닫혔을 수 있습니다 */ }
}
