import { db } from "@/lib/db";
import { CONFIG, LIMITS, type VisibilityKey } from "@/config";

export type Settings = {
  dryRun: boolean;
  killSwitch: boolean;
  visibility: VisibilityKey;
  dailyPublishLimit: number;
  minPublishIntervalMin: number;
  scrapeTopN: number;
  imageCandidates: number;
  cfImageSteps: number;
  showBrowser: boolean;
  claudeTimeoutSec: number;
  claudeConcurrency: number;
};

const DEFAULTS: Settings = {
  dryRun: CONFIG.dryRun,
  killSwitch: CONFIG.killSwitch,
  visibility: CONFIG.visibility,
  dailyPublishLimit: CONFIG.dailyPublishLimit,
  minPublishIntervalMin: CONFIG.minPublishIntervalMin,
  scrapeTopN: CONFIG.scrapeTopN,
  imageCandidates: CONFIG.imageCandidates,
  cfImageSteps: CONFIG.cfImageSteps,
  showBrowser: CONFIG.showBrowser,
  claudeTimeoutSec: CONFIG.claudeTimeoutSec,
  claudeConcurrency: CONFIG.claudeConcurrency,
};

export const SETTING_KEYS = Object.keys(DEFAULTS) as (keyof Settings)[];
export const VISIBILITY_KEYS: VisibilityKey[] = ["public", "neighbor", "both", "private"];

const BOOL_KEYS = ["dryRun", "killSwitch", "showBrowser"] as const;
const NUM_KEYS = [
  "dailyPublishLimit", "minPublishIntervalMin", "scrapeTopN",
  "imageCandidates", "cfImageSteps", "claudeTimeoutSec", "claudeConcurrency",
] as const;

function clampNum(key: (typeof NUM_KEYS)[number], v: number): number {
  const lim = LIMITS[key];
  if (!Number.isFinite(v)) return DEFAULTS[key];
  return Math.min(lim.max, Math.max(lim.min, Math.round(v)));
}

/** 임의의 입력값을 그 키의 올바른 타입·범위로 보정합니다. UI 에서 막지 말고 여기서 보정합니다. */
export function coerceSetting<K extends keyof Settings>(key: K, raw: unknown): Settings[K] {
  if ((BOOL_KEYS as readonly string[]).includes(key)) {
    if (typeof raw === "boolean") return raw as Settings[K];
    if (raw === "true" || raw === 1 || raw === "1") return true as Settings[K];
    if (raw === "false" || raw === 0 || raw === "0") return false as Settings[K];
    return DEFAULTS[key];
  }
  if ((NUM_KEYS as readonly string[]).includes(key)) {
    return clampNum(key as (typeof NUM_KEYS)[number], Number(raw)) as Settings[K];
  }
  if (key === "visibility") {
    return (VISIBILITY_KEYS.includes(raw as VisibilityKey) ? raw : DEFAULTS.visibility) as Settings[K];
  }
  return DEFAULTS[key];
}

export function getSettings(): Settings {
  const rows = db().prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const out = { ...DEFAULTS };
  for (const r of rows) {
    if (!(r.key in DEFAULTS)) continue;
    const k = r.key as keyof Settings;
    let parsed: unknown = r.value;
    try { parsed = JSON.parse(r.value); } catch { /* 문자열 그대로 */ }
    (out as Record<string, unknown>)[k] = coerceSetting(k, parsed);
  }
  return out;
}

export function setSettings(patch: Partial<Record<keyof Settings, unknown>>): Settings {
  const stmt = db().prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  for (const [k, v] of Object.entries(patch)) {
    if (!SETTING_KEYS.includes(k as keyof Settings)) continue;
    const coerced = coerceSetting(k as keyof Settings, v);
    stmt.run(k, JSON.stringify(coerced));
  }
  return getSettings();
}

/** settings 테이블을 비우면 전부 기본값으로 돌아갑니다. */
export function resetSettings(): Settings {
  db().prepare("DELETE FROM settings").run();
  return getSettings();
}

export { DEFAULTS as SETTING_DEFAULTS, LIMITS };
