"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import SettingsDrawer, { type Settings } from "./SettingsDrawer";

type Mode = "auto" | "review" | "branding";
type PhotoSource = "local" | "crawl" | "ai" | "none";
type Section =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string; highlight?: string }
  | { type: "quote"; text: string }
  | { type: "divider" }
  | { type: "image"; query: string; caption?: string };

type Status = {
  claude: { installed: boolean; version?: string; error?: string };
  session: { valid: boolean; canWrite: boolean; blogId?: string; reason: string };
  cloudflare: { configured: boolean };
  settings: Settings;
  running: boolean;
};
type Usage = {
  neurons: { neuronsUsed: number; limit: number; measured: boolean; note: string };
  perImage: number; imagesPerDay: number;
  publishedToday: number; dailyLimit: number;
  minutesSinceLastPublish: number | null; minIntervalMin: number;
};
type JobRow = { id: number; keyword: string; status: string; stage: string | null; mode: string; post_status: string | null };
type LogRow = { id: number; level: string; message: string; created_at: string };
type Detail = {
  job: { id: number; status: string; stage: string | null; error: string | null };
  ideas: { id: number; title: string; angle: string; chosen: number }[];
  draft: { title: string; body_json: string } | null;
  images: { id: number; query: string; local_path: string | null; verdict_ok: number; verdict_reason: string; section_index: number; source_site: string }[];
  post: { status: string; blog_url: string | null; screenshot: string | null; note: string | null } | null;
  logs: LogRow[];
};

const MODES: [Mode, string, string][] = [
  ["auto", "자동 발굴", "관심 키워드만 넣으면 요즘 뜨는 이야기를 찾아 글감부터 정합니다"],
  ["review", "체험단", "다녀온 곳·써본 물건을 1인칭 후기로 씁니다"],
  ["branding", "브랜딩·전문성", "전문가 관점으로 신뢰를 쌓는 글을 씁니다"],
];
const PHOTOS: [PhotoSource, string, string][] = [
  ["none", "사진 없음", "글만 씁니다"],
  ["crawl", "검색해서 가져오기", "AI 가 사진을 하나씩 보고 고릅니다"],
  ["ai", "AI 가 그리기", "저작권 걱정이 없습니다"],
  ["local", "내 사진 쓰기", "직접 찍은 사진을 씁니다"],
];

const fileUrl = (p: string) => `/api/file?path=${encodeURIComponent(p)}`;

export default function Page() {
  const [status, setStatus] = useState<Status | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [liveLogs, setLiveLogs] = useState<LogRow[]>([]);
  const [drawer, setDrawer] = useState(false);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState("");

  const [mode, setMode] = useState<Mode>("auto");
  const [keyword, setKeyword] = useState("");
  const [userContent, setUserContent] = useState("");
  const [photoSource, setPhotoSource] = useState<PhotoSource>("none");
  const [imageStyle, setImageStyle] = useState<"photo" | "illust">("photo");
  const [photoFolder, setPhotoFolder] = useState("");
  const [placement, setPlacement] = useState<"order" | "ai">("order");

  const esRef = useRef<EventSource | null>(null);
  const logEnd = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async (hard = false) => {
    const [s, u, j] = await Promise.all([
      fetch(`/api/status${hard ? "?refresh=1" : ""}`).then((r) => r.json()),
      fetch("/api/usage").then((r) => r.json()),
      fetch("/api/jobs").then((r) => r.json()),
    ]);
    setStatus(s); setUsage(u); setJobs(j.jobs);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const openJob = useCallback(async (id: number) => {
    setSelected(id);
    const d = await fetch(`/api/jobs/${id}`).then((r) => r.json());
    setDetail(d);
    setLiveLogs(d.logs ?? []);

    esRef.current?.close();
    if (["pending", "scraping", "writing", "imaging", "publishing"].includes(d.job.status)) {
      const es = new EventSource(`/api/jobs/${id}/stream`);
      esRef.current = es;
      es.addEventListener("log", (e) => {
        const row = JSON.parse((e as MessageEvent).data) as LogRow;
        setLiveLogs((prev) => (prev.some((p) => p.id === row.id) ? prev : [...prev, row]));
      });
      es.addEventListener("end", async () => {
        es.close();
        setDetail(await fetch(`/api/jobs/${id}`).then((r) => r.json()));
        void refresh();
      });
    }
  }, [refresh]);

  useEffect(() => () => esRef.current?.close(), []);
  useEffect(() => { logEnd.current?.scrollIntoView({ block: "end" }); }, [liveLogs]);

  const patch = async (p: Partial<Settings>) => {
    const r = await fetch("/api/settings", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p),
    }).then((x) => x.json());
    if (r.settings) { setStatus((s) => (s ? { ...s, settings: r.settings } : s)); void refresh(); }
  };
  const resetAll = async () => {
    const r = await fetch("/api/settings", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reset: true }),
    }).then((x) => x.json());
    setStatus((s) => (s ? { ...s, settings: r.settings } : s));
  };

  const login = async () => {
    setErr("");
    const r = await fetch("/api/naver/login", { method: "POST" }).then((x) => x.json());
    if (r.error) setErr(r.error);
    void refresh(true);
  };

  const pickFolder = async () => {
    const r = await fetch("/api/pick-folder", { method: "POST" }).then((x) => x.json());
    if (r.path) setPhotoFolder(r.path);
    else if (r.error) setErr(r.error);
  };

  const start = async () => {
    if (starting || !keyword.trim()) return;
    setStarting(true); setErr("");
    try {
      const r = await fetch("/api/jobs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, keyword, photoSource, imageStyle, photoFolder, placement, userContent }),
      }).then((x) => x.json());
      if (r.error) { setErr(r.error); return; }
      await refresh();
      await openJob(r.id);
    } finally { setStarting(false); }
  };

  if (!status) return <div className="wrap" style={{ paddingTop: 40 }}>불러오는 중입니다…</div>;

  const s = status.settings;
  const railKind = s.killSwitch ? "armed" : s.dryRun ? "safe" : "armed";
  const railTitle = s.killSwitch ? "전체 중단" : s.dryRun ? "연습 모드" : "실제 발행";
  const railSub = s.killSwitch
    ? "어떤 작업도 발행되지 않습니다"
    : s.dryRun
      ? "발행하지 않고 완성 화면만 저장합니다"
      : `완성되는 글이 블로그에 그대로 올라갑니다 (${{ private: "비공개", neighbor: "이웃공개", both: "서로이웃공개", public: "전체공개" }[s.visibility]})`;
  const runLabel = s.dryRun ? "연습으로 만들기" : "글 만들고 발행하기";

  const pubPct = usage ? Math.min(100, (usage.publishedToday / usage.dailyLimit) * 100) : 0;
  const nrPct = usage ? Math.min(100, (usage.neurons.neuronsUsed / usage.neurons.limit) * 100) : 0;
  const lvl = (p: number) => (p >= 90 ? "armed" : p >= 70 ? "live" : "");

  const sections: Section[] = detail?.draft ? JSON.parse(detail.draft.body_json) : [];
  const imgBySection = new Map<number, Detail["images"][number]>();
  for (const im of detail?.images ?? []) if (im.verdict_ok === 1) imgBySection.set(im.section_index, im);

  const canRun = keyword.trim().length > 0 && !status.running && !starting
    && !(photoSource === "ai" && !status.cloudflare.configured)
    && !(photoSource === "local" && !photoFolder.trim());

  return (
    <>
      <div className={`rail ${railKind}`}>
        <div className="rail-bar" />
        <div>
          <div className="rail-title">{railTitle}</div>
          <div className="rail-sub">{railSub}</div>
        </div>
        <div className="rail-right">
          <div className="dots">
            <span className={`dot ${status.claude.installed ? "on" : "off"}`}>
              <i />Claude
            </span>
            <span className={`dot ${status.session.canWrite ? "on" : status.session.valid ? "warn" : "off"}`}>
              <i />네이버
            </span>
            <span className={`dot ${status.cloudflare.configured ? "on" : ""}`}>
              <i />이미지 생성
            </span>
          </div>
          <button className="btn" onClick={() => setDrawer(true)}>설정</button>
        </div>
      </div>

      <div className="wrap">
        {err && <div className="notice armed" style={{ marginTop: 14 }}>{err}</div>}

        {!status.claude.installed && (
          <div className="notice armed" style={{ marginTop: 14 }}>
            AI 를 실행하는 프로그램이 아직 준비되지 않았습니다. 명령어를 입력하는 창에서 <code>claude --version</code> 이
            나오는지 확인해 주세요.
          </div>
        )}
        {!status.session.canWrite && (
          <div className="notice warn" style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ flex: 1 }}>
              네이버에 대신 글을 올리려면 로그인이 한 번 필요합니다. {status.session.reason}
              <br />
              <b>새 창이 뜨면 “로그인 상태 유지”를 꼭 켜주세요.</b> 안 하면 몇 시간 뒤 다시 로그인해야 합니다.
            </span>
            <button className="btn btn-primary" onClick={login}>네이버 로그인</button>
          </div>
        )}

        {/* ── 계량기 ── */}
        <div className="meters">
          <div className={`card meter ${lvl(pubPct)}`}>
            <div className="muted small">오늘 발행</div>
            <div className="meter-num">{usage?.publishedToday ?? 0} / {usage?.dailyLimit ?? 0}편</div>
            <div className="meter-track"><div className="meter-fill" style={{ width: `${pubPct}%` }} /></div>
            <div className="muted small">
              최소 간격 {usage?.minIntervalMin ?? 0}분
              {pubPct >= 100 && " · 설정에서 늘릴 수 있습니다"}
            </div>
          </div>
          <div className={`card meter ${lvl(nrPct)}`}>
            <div className="muted small">이미지 생성량</div>
            <div className="meter-num">
              {Math.round(usage?.neurons.neuronsUsed ?? 0).toLocaleString()} / {(usage?.neurons.limit ?? 0).toLocaleString()} 뉴런
            </div>
            <div className="meter-track"><div className="meter-fill" style={{ width: `${nrPct}%` }} /></div>
            <div className="muted small">
              {usage?.neurons.note} · 장당 {Math.round(usage?.perImage ?? 0)} 뉴런
            </div>
          </div>
        </div>

        {/* ── 작성 ── */}
        <h2>어떤 글을 쓸까요</h2>
        <div className="types">
          {MODES.map(([m, title, desc]) => (
            <button key={m} className="type" aria-pressed={mode === m} onClick={() => {
              setMode(m);
              if (m === "auto" && photoSource === "local") setPhotoSource("none");
            }}>
              <b>{title}</b><span className="muted small">{desc}</span>
            </button>
          ))}
        </div>

        <div className="card" style={{ marginTop: 14 }}>
          <label className="field">
            <span>{mode === "auto" ? "관심 분야 (예: 제주도 여행, 홈카페)" : "주제 (예: 성수동 OO카페 방문 후기)"}</span>
            <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)}
              placeholder={mode === "auto" ? "한 단어로 넣어보세요" : "무엇에 대한 글인가요"} />
          </label>

          {mode !== "auto" && (
            <label className="field">
              <span>핵심 내용 — 글에 꼭 들어갈 사실을 적어주세요. AI 는 여기 있는 내용만 씁니다.</span>
              <textarea value={userContent} onChange={(e) => setUserContent(e.target.value)}
                placeholder={mode === "review"
                  ? "언제 갔는지, 뭘 먹었는지, 가격, 웨이팅, 좋았던 점과 아쉬운 점…"
                  : "실적 숫자, 다루는 문제, 제안하는 방법…"} />
            </label>
          )}

          <label className="field"><span>사진은 어떻게 할까요</span></label>
          <div className="chips">
            {PHOTOS.filter(([p]) => !(mode === "auto" && p === "local")).map(([p, label, desc]) => (
              <button key={p} className="chip" aria-pressed={photoSource === p} title={desc}
                onClick={() => setPhotoSource(p)}>{label}</button>
            ))}
          </div>

          {photoSource === "ai" && (
            <>
              <label className="field"><span>그림체</span></label>
              <div className="chips">
                <button className="chip" aria-pressed={imageStyle === "photo"} onClick={() => setImageStyle("photo")}>사진처럼</button>
                <button className="chip" aria-pressed={imageStyle === "illust"} onClick={() => setImageStyle("illust")}>일러스트</button>
              </div>
              {!status.cloudflare.configured && (
                <div className="notice warn" style={{ marginTop: 12 }}>
                  AI 로 사진을 만들려면 열쇠가 필요합니다. 지금은 <b>사진 없음</b> 이나 <b>검색해서 가져오기</b> 로
                  바꾸면 바로 쓸 수 있습니다.
                </div>
              )}
            </>
          )}

          {photoSource === "local" && (
            <>
              <label className="field">
                <span>사진이 들어 있는 폴더</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <input type="text" value={photoFolder} onChange={(e) => setPhotoFolder(e.target.value)}
                    placeholder="폴더 고르기를 누르거나 경로를 직접 붙여넣으세요" />
                  <button className="btn" style={{ flex: "none" }} onClick={pickFolder}>폴더 고르기</button>
                </div>
              </label>
              <label className="field"><span>사진 배치</span></label>
              <div className="chips">
                <button className="chip" aria-pressed={placement === "order"} onClick={() => setPlacement("order")}>순서대로</button>
                <button className="chip" aria-pressed={placement === "ai"} onClick={() => setPlacement("ai")}>AI 가 어울리게</button>
              </div>
            </>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18 }}>
            <button className={`btn ${s.dryRun ? "btn-safe" : "btn-armed"}`} disabled={!canRun} onClick={start}>
              {starting ? "시작하는 중…" : runLabel}
            </button>
            <span className="muted small">
              {status.running ? "진행 중인 작업이 끝나야 새로 시작할 수 있습니다."
                : s.dryRun ? "연습 모드라 실제로 올라가지 않습니다. 3~7분쯤 걸립니다."
                  : "실제로 블로그에 올라갑니다. 3~7분쯤 걸립니다."}
            </span>
          </div>
        </div>

        {/* ── 진행 / 결과 ── */}
        <div className="grid cols-2" style={{ marginTop: 26, alignItems: "start" }}>
          <div>
            <h2 style={{ marginTop: 0 }}>최근 작업</h2>
            <div className="joblist">
              {jobs.length === 0 && <div className="muted small">아직 만든 글이 없습니다.</div>}
              {jobs.map((j) => {
                const running = ["pending", "scraping", "writing", "imaging", "publishing"].includes(j.status);
                const cls = running ? "running" : j.status === "failed" ? "failed" : j.status === "done" ? "done" : "";
                return (
                  <button key={j.id} className="jobitem" aria-pressed={selected === j.id} onClick={() => openJob(j.id)}>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {j.keyword}
                    </span>
                    <span className={`badge ${cls}`}>
                      {running ? (j.stage ?? "진행 중") : j.status === "done"
                        ? (j.post_status === "published" ? "발행됨" : j.post_status === "blocked" ? "중단됨" : "연습 완료")
                        : j.status === "failed" ? "실패" : j.status}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <h2 style={{ marginTop: 0 }}>진행 상황</h2>
            <div className="logs">
              {liveLogs.length === 0 && <div className="muted">왼쪽에서 작업을 고르면 여기에 진행 상황이 보입니다.</div>}
              {liveLogs.map((l) => (
                <div key={l.id} className={`log-line log-${l.level}`}>
                  <time>{l.created_at.slice(11, 19)}</time><span>{l.message}</span>
                </div>
              ))}
              <div ref={logEnd} />
            </div>
          </div>
        </div>

        {detail?.post && (
          <div className={`notice ${detail.post.status === "published" ? "info" : detail.post.status === "failed" ? "armed" : "warn"}`}
            style={{ marginTop: 18 }}>
            <b>{{ published: "발행 완료", dry_run: "연습 완료", failed: "실패", blocked: "중단됨", pending: "대기" }[detail.post.status] ?? detail.post.status}</b>
            {" — "}{detail.post.note}
            {detail.post.blog_url && <> · <a href={detail.post.blog_url} target="_blank" rel="noreferrer">올라간 글 보기</a></>}
          </div>
        )}

        {detail?.post?.screenshot && (
          <>
            <h2>완성 화면</h2>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fileUrl(detail.post.screenshot)} alt="발행 직전 에디터 화면"
              style={{ width: "100%", borderRadius: 8, border: "1px solid var(--line)" }} />
          </>
        )}

        {detail?.draft && (
          <>
            <h2>글 미리보기</h2>
            <div className="preview">
              <h1>{detail.draft.title}</h1>
              {sections.map((sec, i) => {
                if (sec.type === "heading") return <h3 key={i}>{sec.text}</h3>;
                if (sec.type === "quote") return <blockquote key={i}>{sec.text}</blockquote>;
                if (sec.type === "divider") return <hr key={i} />;
                if (sec.type === "image") {
                  const im = imgBySection.get(i);
                  return im?.local_path ? (
                    <figure key={i} style={{ margin: 0 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={fileUrl(im.local_path)} alt={sec.caption ?? sec.query} />
                      {sec.caption && <figcaption>{sec.caption}</figcaption>}
                    </figure>
                  ) : (
                    <div key={i} className="imgslot">사진 자리 — {sec.query}</div>
                  );
                }
                if (!sec.highlight) return <p key={i}>{sec.text}</p>;
                const at = sec.text.indexOf(sec.highlight);
                if (at < 0) return <p key={i}>{sec.text}</p>;
                return (
                  <p key={i}>
                    {sec.text.slice(0, at)}
                    <mark>{sec.highlight}</mark>
                    {sec.text.slice(at + sec.highlight.length)}
                  </p>
                );
              })}
            </div>
          </>
        )}

        {detail && detail.images.length > 0 && (
          <>
            <h2>사진 판정 결과</h2>
            <p className="muted small" style={{ marginTop: -4 }}>
              탈락한 사진과 그 이유도 함께 보여줍니다. 워터마크·초상권 걸러내기가 실제로 동작하는지 확인하실 수 있습니다.
            </p>
            <div className="thumbs">
              {detail.images.map((im) => (
                <div key={im.id} className={`thumb ${im.verdict_ok ? "ok" : "no"}`}>
                  {im.local_path
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={fileUrl(im.local_path)} alt={im.query} />
                    : <div style={{ height: 100, display: "grid", placeItems: "center" }} className="muted small">이미지 없음</div>}
                  <div className="why">{im.verdict_ok ? "채택" : "탈락"} · {im.verdict_reason}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {detail && detail.ideas.length > 0 && (
          <>
            <h2>찾아낸 글감</h2>
            <div className="grid">
              {detail.ideas.map((it) => (
                <div key={it.id} className="card" style={it.chosen ? { borderColor: "var(--act)" } : undefined}>
                  <b>{it.chosen ? "★ " : ""}{it.title}</b>
                  <div className="muted small">{it.angle}</div>
                </div>
              ))}
            </div>
          </>
        )}

        <h2>알아두실 점</h2>
        <div className="card muted small">
          <p>· 자동 발행은 네이버 이용약관상 계정 제재 위험이 있습니다. 그래서 연습 모드가 기본이고 하루 발행 수·간격 제한이 있습니다.</p>
          <p>· 하루 발행 수와 간격은 네이버가 정한 값이 아니라 이 앱의 자체 브레이크입니다. 보수적으로 두시길 권합니다.</p>
          <p>· 검색으로 가져온 사진은 저작권 분쟁 소지가 있습니다. 워터마크·인물 걸러내기가 있어도 사용 권리를 보장하지는 않습니다. 상업적으로 쓰신다면 <b>AI 가 그리기</b> 나 <b>내 사진 쓰기</b> 가 안전합니다.</p>
          <p style={{ marginBottom: 0 }}>· 수집한 자료는 참고용입니다. 글은 새로 씁니다.</p>
        </div>
      </div>

      {drawer && (
        <SettingsDrawer settings={s} onPatch={patch} onReset={resetAll} onClose={() => setDrawer(false)}
          perImage={usage?.perImage ?? 0} imagesPerDay={usage?.imagesPerDay ?? 0} />
      )}
    </>
  );
}
