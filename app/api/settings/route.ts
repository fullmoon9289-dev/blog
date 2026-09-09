import { NextResponse } from "next/server";
import { getSettings, setSettings, resetSettings, SETTING_KEYS, LIMITS } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ settings: getSettings(), limits: LIMITS });
}

export async function POST(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  if (body.reset === true) return NextResponse.json({ settings: resetSettings(), limits: LIMITS });

  const unknown = Object.keys(body).filter((k) => !SETTING_KEYS.includes(k as never));
  if (unknown.length) {
    return NextResponse.json({ error: `알 수 없는 설정: ${unknown.join(", ")}` }, { status: 400 });
  }
  // ⚠️ 범위를 벗어난 값은 UI 에서 막지 말고 서버가 잘라냅니다(클램프).
  return NextResponse.json({ settings: setSettings(body), limits: LIMITS });
}
