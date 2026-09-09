import { db } from "@/lib/db";

export type LogLevel = "info" | "warn" | "error" | "ok";

/** 진행 상황을 job_logs 에 남깁니다. 화면의 실시간 로그(SSE)가 이걸 읽습니다. */
export function jobLog(jobId: number, message: string, level: LogLevel = "info"): void {
  try {
    db().prepare("INSERT INTO job_logs (job_id, level, message) VALUES (?, ?, ?)")
      .run(jobId, level, message);
  } catch {
    // 로그 실패가 파이프라인을 죽이면 안 됩니다.
  }
  // 터미널에도 남겨둡니다(개발 중 진단용).
  console.log(`[job ${jobId}] ${level.toUpperCase()}: ${message}`);
}

export function setJobStage(jobId: number, status: string, stage?: string): void {
  db().prepare("UPDATE jobs SET status = ?, stage = ?, updated_at = datetime('now') WHERE id = ?")
    .run(status, stage ?? null, jobId);
}

export function setJobError(jobId: number, error: string): void {
  db().prepare("UPDATE jobs SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?")
    .run(error, jobId);
}
