"use client";
import { useEffect } from "react";

export type Settings = {
  dryRun: boolean; killSwitch: boolean; visibility: "public" | "neighbor" | "both" | "private";
  dailyPublishLimit: number; minPublishIntervalMin: number; scrapeTopN: number;
  imageCandidates: number; cfImageSteps: number; showBrowser: boolean;
  claudeTimeoutSec: number; claudeConcurrency: number;
};

const VIS: [Settings["visibility"], string][] = [
  ["private", "비공개"], ["neighbor", "이웃공개"], ["both", "서로이웃공개"], ["public", "전체공개"],
];

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label}
      className="switch" onClick={() => onChange(!on)} />
  );
}

function Row(props: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="row">
      <div className="label">
        <b>{props.title}</b>
        {props.desc && <span className="muted small">{props.desc}</span>}
      </div>
      {props.children}
    </div>
  );
}

export default function SettingsDrawer({
  settings, onPatch, onReset, onClose, perImage, imagesPerDay,
}: {
  settings: Settings;
  onPatch: (p: Partial<Settings>) => void;
  onReset: () => void;
  onClose: () => void;
  perImage: number;
  imagesPerDay: number;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const num = (k: keyof Settings, min: number, max: number) => (
    <input className="num" type="text" inputMode="numeric" value={String(settings[k])}
      onChange={(e) => onPatch({ [k]: Number(e.target.value.replace(/[^\d]/g, "")) || min } as Partial<Settings>)}
      aria-label={`${String(k)} (${min}~${max})`} />
  );

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="설정">
        <div style={{ display: "flex", alignItems: "center" }}>
          <b>설정</b>
          <button className="btn" style={{ marginLeft: "auto" }} onClick={onClose}>닫기</button>
        </div>

        <h3>발행 안전장치</h3>
        <div className="card">
          <Row title="연습 모드" desc="발행하지 않고 완성 화면만 저장합니다">
            <Switch on={settings.dryRun} onChange={(v) => onPatch({ dryRun: v })} label="연습 모드" />
          </Row>
          <Row title="전체 중단" desc="어떤 작업도 발행되지 않습니다">
            <Switch on={settings.killSwitch} onChange={(v) => onPatch({ killSwitch: v })} label="전체 중단" />
          </Row>
          <Row title="공개 범위" desc="글이 누구에게 보일지">
            <select style={{ width: 150 }} value={settings.visibility}
              onChange={(e) => onPatch({ visibility: e.target.value as Settings["visibility"] })}>
              {VIS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Row>
          <Row title="하루 발행 수" desc="1~50편">{num("dailyPublishLimit", 1, 50)}</Row>
          <Row title="발행 간격(분)" desc="0~720분">{num("minPublishIntervalMin", 0, 720)}</Row>
        </div>
        {settings.visibility === "public" && (
          <div className="notice armed" style={{ marginTop: 10 }}>
            지금 설정은 <b>전체공개</b>입니다. 완성된 글이 누구나 볼 수 있게 올라갑니다.
          </div>
        )}

        <h3>글감과 사진</h3>
        <div className="card">
          <Row title="검색 수집량" desc="3~30건">{num("scrapeTopN", 3, 30)}</Row>
          <Row title="사진 후보 수" desc="3~20장. 줄이면 자리가 비게 됩니다">{num("imageCandidates", 3, 20)}</Row>
          <Row title="AI 사진 품질" desc={`지금은 장당 ${Math.round(perImage)} 뉴런 — 무료 한도로 하루 ${imagesPerDay}장`}>
            {num("cfImageSteps", 1, 8)}
          </Row>
        </div>

        <h3>실행 방식</h3>
        <div className="card">
          <Row title="브라우저 보기" desc="작업하는 창을 눈으로 봅니다">
            <Switch on={settings.showBrowser} onChange={(v) => onPatch({ showBrowser: v })} label="브라우저 보기" />
          </Row>
          <Row title="AI 동시 실행" desc="1~6">{num("claudeConcurrency", 1, 6)}</Row>
          <Row title="AI 응답 대기(초)" desc="30~900">{num("claudeTimeoutSec", 30, 900)}</Row>
        </div>

        <button className="btn" style={{ marginTop: 20 }} onClick={onReset}>기본값으로 되돌리기</button>
      </aside>
    </>
  );
}
