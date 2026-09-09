import { NextResponse } from "next/server";
import { execFile } from "node:child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ⚠️ 7-14. 브라우저는 폴더의 절대경로를 주지 않습니다.
 *   <input webkitdirectory> 는 보안상 상대 경로만 주므로 Playwright 업로드에 쓸 수 없습니다.
 *   로컬 전용 앱이므로 백엔드에서 OS 네이티브 대화상자를 띄웁니다.
 *
 * ⚠️ 취소 판정이 플랫폼마다 다릅니다:
 *   macOS  — stderr 의 "User canceled"
 *   윈도우 — stdout 이 비어 있는 것
 */
function run(cmd: string, args: string[]): Promise<{ out: string; err: string; code: number }> {
  return new Promise((resolve) => {
    // ⚠️ 2분 타임아웃 필수. 사용자가 대화상자를 방치하면 요청이 영원히 안 끝납니다.
    execFile(cmd, args, { timeout: 120_000, maxBuffer: 1 << 20 }, (e, stdout, stderr) => {
      resolve({ out: String(stdout ?? ""), err: String(stderr ?? ""), code: e ? 1 : 0 });
    });
  });
}

/** 경로 끝의 구분자를 제거합니다(양쪽 플랫폼 공통). */
function trimSep(p: string): string {
  return p.trim().replace(/[/\\]+$/, "");
}

export async function POST() {
  const platform = process.platform;

  if (platform === "darwin") {
    const r = await run("osascript", ["-e", 'POSIX path of (choose folder with prompt "사진이 들어 있는 폴더를 골라주세요")']);
    if (/User canceled/i.test(r.err)) return NextResponse.json({ canceled: true });
    const p = trimSep(r.out);
    if (!p) return NextResponse.json({ error: "폴더를 고르지 못했습니다. 경로를 직접 입력해 주세요." }, { status: 400 });
    return NextResponse.json({ path: p });
  }

  if (platform === "win32") {
    // ⚠️ -STA 가 반드시 필요합니다. WinForms 대화상자는 STA 아파트먼트에서만 뜹니다.
    const script =
      "Add-Type -AssemblyName System.Windows.Forms; " +
      "$f = New-Object System.Windows.Forms.FolderBrowserDialog; " +
      "if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath }";
    const r = await run("powershell", ["-NoProfile", "-STA", "-Command", script]);
    const p = trimSep(r.out);
    // 윈도우는 stdout 이 비어 있는 것이 취소입니다.
    if (!p) return NextResponse.json({ canceled: true });
    return NextResponse.json({ path: p });
  }

  return NextResponse.json(
    { error: "이 컴퓨터에서는 폴더 고르기 창을 띄울 수 없습니다. 경로를 직접 입력해 주세요." },
    { status: 400 },
  );
}
