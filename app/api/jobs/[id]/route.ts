import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number(id);
  const conn = db();
  const job = conn.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
  if (!job) return NextResponse.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });

  return NextResponse.json({
    job,
    sources: conn.prepare("SELECT * FROM sources WHERE job_id = ? ORDER BY id").all(jobId),
    ideas: conn.prepare("SELECT * FROM ideas WHERE job_id = ? ORDER BY chosen DESC, id").all(jobId),
    draft: conn.prepare("SELECT * FROM drafts WHERE job_id = ? ORDER BY id DESC LIMIT 1").get(jobId),
    images: conn.prepare("SELECT * FROM images WHERE job_id = ? ORDER BY section_index, id").all(jobId),
    post: conn.prepare("SELECT * FROM posts WHERE job_id = ? ORDER BY id DESC LIMIT 1").get(jobId),
    logs: conn.prepare("SELECT * FROM job_logs WHERE job_id = ? ORDER BY id").all(jobId),
  });
}
