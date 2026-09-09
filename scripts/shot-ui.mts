import { chromium } from "playwright";
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 1400 }, locale: "ko-KR" });
await p.goto("http://localhost:4123", { waitUntil: "networkidle" });
await p.waitForTimeout(1500);
await p.screenshot({ path: "data/screenshots/ui-safe.png", fullPage: true });

// 실제 발행 모드로 바꿔 레일 색·문구·버튼이 바뀌는지
await fetch("http://localhost:4123/api/settings", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ dryRun: false }),
});
await p.reload({ waitUntil: "networkidle" });
await p.waitForTimeout(1200);
await p.locator(".rail").screenshot({ path: "data/screenshots/ui-armed-rail.png" });

// 설정 서랍
await p.getByRole("button", { name: "설정" }).click();
await p.waitForTimeout(600);
await p.screenshot({ path: "data/screenshots/ui-drawer.png" });
await fetch("http://localhost:4123/api/settings", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reset: true }),
});
await b.close();
console.log("saved");
