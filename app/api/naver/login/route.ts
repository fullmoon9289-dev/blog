import { NextResponse } from "next/server";
import { loginInteractive, verifySession } from "@/lib/naver/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** ⚠️ 로그인은 사용자가 직접 입력하므로 최대 5분 기다립니다. maxDuration 이 필수입니다. */
export const maxDuration = 600;

export async function POST() {
  const res = await loginInteractive();
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  const session = await verifySession(true);
  return NextResponse.json({ ok: true, session });
}
