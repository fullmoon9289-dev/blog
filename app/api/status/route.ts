import { NextResponse } from "next/server";
import { checkClaude } from "@/lib/claude";
import { verifySession, hasSessionFile } from "@/lib/naver/session";
import { cloudflareConfigured } from "@/lib/ai/imagegen";
import { getSettings, LIMITS } from "@/lib/settings";
import { hasRunningJob } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  const [claude, session] = await Promise.all([
    checkClaude(),
    hasSessionFile() ? verifySession(refresh) : Promise.resolve({ valid: false, canWrite: false, reason: "아직 로그인하지 않았습니다." }),
  ]);
  return NextResponse.json({
    claude,
    session,
    cloudflare: { configured: cloudflareConfigured() },
    settings: getSettings(),
    limits: LIMITS,
    running: hasRunningJob(),
  });
}
