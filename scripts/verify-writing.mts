import { generateIdeas, generateDraft, sanitizeDraft, stripMarkdown, draftStats } from "@/lib/ai/content";
import type { Draft, SourceItem } from "@/lib/types";

let fail = 0;
const t = (label: string, cond: boolean, detail = "") => {
  if (!cond) fail++;
  console.log(`  ${cond ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
};

console.log("\n[A] 글쓰기 검증 (6-5) — 브라우저 자동화 없이 확인 가능한 범위\n");

// ── 순수 함수부터 (AI 호출 없이) ────────────────────────────────
console.log("  · 마크다운 무력화 (7-8)");
const md = "**굵게** 하고 ~~취소~~ 하고 `코드` 좋아요~~ 진짜~\n# 제목\n> 인용\n- 목록";
const stripped = stripMarkdown(md);
t("마크다운 기호가 전부 사라졌다", !/\*\*|__|`|^#|^>|^[-*+] /m.test(stripped), JSON.stringify(stripped.slice(0, 40)));
t("물결표는 전각으로 보존됐다(어감 유지)", stripped.includes("～"), JSON.stringify(stripped.slice(-20)));

console.log("\n  · 지어낸 highlight 제거 (7-24)");
const fake: Draft = {
  title: "테스트",
  sections: [
    { type: "paragraph", text: "옆 사이트는 한 시간째 폴대와 씨름 중이더라고요. 그때 확신했습니다.",
      highlight: "예쁜 것보다 빨리 펴지는 게 훨씬 중요합니다" },      // 본문에 없음 → 버려야 함
    { type: "paragraph", text: "가격은 생각보다 착했습니다. 재방문 의사 있어요.",
      highlight: "가격은 생각보다 착했습니다" },                      // 본문에 있음 → 유지
    { type: "heading", text: "소제목" },
  ],
};
const { draft: cleaned, dropped } = sanitizeDraft(fake);
t("지어낸 highlight 1개가 버려졌다", dropped === 1, `버린 개수 ${dropped}`);
t("실재하는 highlight 는 유지됐다",
  cleaned.sections[1].type === "paragraph" && cleaned.sections[1].highlight === "가격은 생각보다 착했습니다");
t("버려진 쪽은 highlight 키 자체가 없다",
  cleaned.sections[0].type === "paragraph" && cleaned.sections[0].highlight === undefined);

// ── 실제 AI 호출 ────────────────────────────────────────────────
const sources: SourceItem[] = [
  { type: "news", title: "가을 캠핑 성수기, 예약 경쟁 치열", url: "https://n.news.naver.com/1",
    summary: "9월 들어 국립공원 야영장 예약이 오픈 3분 만에 마감되는 사례가 늘고 있다. 초보 캠퍼 유입이 늘면서 장비 시장도 커지는 추세다." },
  { type: "blog", title: "캠핑 3년차가 정리한 첫 장비 리스트", url: "https://blog.naver.com/a/223456789012",
    summary: "처음부터 다 살 필요 없다. 텐트와 침낭만 제대로 고르면 나머지는 천천히 늘려도 된다는 내용." },
  { type: "news", title: "일교차 커지는 9월, 캠핑 저체온증 주의", url: "https://n.news.naver.com/2",
    summary: "낮과 밤 기온차가 15도 이상 벌어지는 시기로, 침낭 내한온도 확인이 필요하다는 전문가 조언." },
];

console.log("\n  · 글감 발굴 (AI 호출)");
const ideas = await generateIdeas("가을 캠핑", sources, 5);
if (!ideas.ok) { t("글감 5개 생성", false, ideas.error); }
else {
  t("글감이 생성됐다", ideas.ideas.length >= 3, `${ideas.ideas.length}개`);
  t("각 글감에 제목·관점·근거가 있다",
    ideas.ideas.every((i) => i.title && i.angle && i.rationale));
  console.log(`     1등 글감: ${ideas.ideas[0].title}`);
}

console.log("\n  · 본문 작성 (AI 호출, 사진 없음 모드)");
const chosen = ideas.ok ? ideas.ideas[0] : null;
const noneDraft = await generateDraft("가을 캠핑", chosen, sources, { mode: "auto", photoSource: "none" });
if (!noneDraft.ok) { t("본문 생성(none)", false, noneDraft.error); }
else {
  const st = draftStats(noneDraft.draft);
  console.log(`     제목: ${noneDraft.draft.title}`);
  console.log(`     구성: 소제목 ${st.heading} · 문단 ${st.paragraph} · 인용구 ${st.quote} · 구분선 ${st.divider} · 사진 ${st.image} · ${st.chars}자`);
  t("사진 없음 모드에서 image 섹션이 0개다", st.image === 0);
  t("본문에 마크다운 기호 유출이 없다",
    noneDraft.draft.sections.every((s) => !("text" in s) || !/\*\*|~~|^#{1,6} |^> |`/m.test(s.text)));
  t("highlight 가 전부 본문에 글자 그대로 있다",
    noneDraft.draft.sections.every((s) => s.type !== "paragraph" || !s.highlight || s.text.includes(s.highlight)));
  if (noneDraft.droppedHighlights > 0) console.log(`     (지어낸 highlight ${noneDraft.droppedHighlights}개를 버렸습니다 — 7-24 가 실제로 발동)`);
}

console.log("\n  · 본문 작성 (AI 호출, 사진 검색 모드 — 이미지 6개 이상 강제)");
const crawlDraft = await generateDraft("가을 캠핑", chosen, sources, { mode: "auto", photoSource: "crawl" });
if (!crawlDraft.ok) { t("본문 생성(crawl)", false, crawlDraft.error); }
else {
  const st = draftStats(crawlDraft.draft);
  console.log(`     구성: 소제목 ${st.heading} · 문단 ${st.paragraph} · 인용구 ${st.quote} · 사진 ${st.image} · ${st.chars}자`);
  t("사진 검색 모드에서 image 섹션이 6개 이상이다", st.image >= 6, `${st.image}개`);
  t("이미지 검색어가 전부 채워져 있다",
    crawlDraft.draft.sections.every((s) => s.type !== "image" || s.query.length > 0));
}

console.log(`\n  ${fail === 0 ? "→ 글쓰기 검증 전부 통과" : `${fail}건 실패`}\n`);
process.exit(fail === 0 ? 0 : 1);
