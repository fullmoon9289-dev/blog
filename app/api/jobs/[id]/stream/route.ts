import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 진행 로그를 1초 폴링해 새 줄만 보냅니다. 잡이 끝나면 end 를 보내고 닫습니다. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number(id);
  const conn = db();
  let lastId = 0;

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) =>
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      const tick = () => {
        try {
          const rows = conn
            .prepare("SELECT id, level, message, created_at FROM job_logs WHERE job_id = ? AND id > ? ORDER BY id")
            .all(jobId, lastId) as { id: number; level: string; message: string; created_at: string }[];
          for (const r of rows) { lastId = r.id; send("log", r); }

          const job = conn.prepare("SELECT status, stage FROM jobs WHERE id = ?").get(jobId) as
            | { status: string; stage: string | null } | undefined;
          if (job) send("stage", job);

          if (job && ["done", "failed", "canceled"].includes(job.status)) {
            send("end", job);
            clearInterval(timer);
            controller.close();
          }
        } catch {
          clearInterval(timer);
          try { controller.close(); } catch { /* 이미 닫힘 */ }
        }
      };
      const timer = setInterval(tick, 1000);
      tick();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
