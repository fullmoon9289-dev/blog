import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createJob, runJob, hasRunningJob } from "@/lib/pipeline";
import type { JobInputs } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const jobs = db()
    .prepare(
      `SELECT j.id, j.keyword, j.status, j.stage, j.mode, j.created_at,
              (SELECT status FROM posts WHERE job_id = j.id ORDER BY id DESC LIMIT 1) AS post_status
         FROM jobs j ORDER BY j.id DESC LIMIT 30`,
    )
    .all();
  return NextResponse.json({ jobs });
}

export async function POST(req: Request) {
  // ⚠️ 7-16. 버튼 연타·SSE 재연결로 같은 잡이 두 번 만들어집니다. 진행 중이면 거절합니다.
  if (hasRunningJob()) {
    return NextResponse.json({ error: "이미 진행 중인 작업이 있습니다. 끝난 뒤에 다시 눌러주세요." }, { status: 409 });
  }
  const body = (await req.json()) as Partial<JobInputs>;
  if (!body.keyword?.trim()) {
    return NextResponse.json({ error: "주제를 입력해 주세요." }, { status: 400 });
  }
  const inputs: JobInputs = {
    mode: body.mode ?? "auto",
    keyword: body.keyword.trim(),
    photoSource: body.photoSource ?? "none",
    imageStyle: body.imageStyle ?? "photo",
    photoFolder: body.photoFolder,
    placement: body.placement ?? "order",
    userContent: body.userContent,
  };
  const id = createJob(inputs);
  // ⚠️ 6-10. fire-and-forget. await 하지 않고 즉시 응답합니다.
  runJob(id).catch(console.error);
  return NextResponse.json({ id });
}
