/**
 * ★ 네이버 셀렉터 중앙 관리 (13장)
 *
 * ⚠️⚠️ 이 파일의 값들은 살아 있는 네이버 에디터에서 클릭까지 확인한 "실측값"입니다.
 *      추론으로 다시 만들 수 없습니다. 리팩터링·정리·통합의 대상이 아닙니다.
 *
 * ⚠️ 네이버 DOM 이 바뀌어 셀렉터가 깨지면 이 파일 "한 개"만 고치면 되도록 유지하세요.
 *    셀렉터를 코드 여기저기에 흩뿌리지 마세요.
 *
 * ⚠️ 새 값을 알아냈을 때: 기존 값을 지우지 말고 후보 배열의 "앞"에 추가하세요.
 *    네이버 에디터는 계정·시점·A/B 에 따라 마크업이 다릅니다. 한 환경에서는 발행 버튼이
 *    iframe 밖이었고, 다른 환경에서는 안이었습니다. 값을 지우면 한쪽이 깨집니다.
 */

export const EDITOR = {
  frame: "iframe#mainFrame",

  // ── 진입 직후 처리 대상 ──────────────────────────────────────────
  restorePopup: [".se-popup-container", ".se-popup-dialog", ".se-popup", "[class*='popup_container']"],

  /**
   * ⚠️★ 7-1. 최악의 함정. button:has-text('취소') 는 툴바의 '취소선' 버튼에 부분일치합니다.
   *   Playwright 의 has-text 는 부분일치이기 때문에, 이걸 쓰면 취소선이 전역으로 켜진 채
   *   글 전체가 타이핑되어 "발행된 글의 모든 텍스트에 취소선"이 그어집니다.
   *
   *   틀린 추측(실제로 한 번 속았음): "한국어 물결표(~~)가 마크다운 취소선으로 변환됐다"
   *   → DB 초안에는 물결표도 결합문자도 0개였습니다. 원인은 셀렉터 부분일치였습니다.
   *
   *   그래서: ① 클래스 기반을 먼저 쓰고 ② 텍스트를 쓸 땐 팝업 안으로 스코프 + :text-is 정확일치.
   *   :text-is('취소') 는 '취소선'에 매칭되지 않습니다.
   */
  restoreCancel: [
    "button.se-popup-button-cancel",
    ".se-popup-button-cancel",
    ".se-popup-container button:text-is('취소')",
    ".se-popup-dialog button:text-is('취소')",
    ".se-popup button:text-is('취소')",
  ],

  /** ⚠️ 7-3. 복원 팝업의 반투명 차단막. 남아 있으면 발행 버튼 클릭이 "조용히" 무시됩니다. */
  popupDim: [".se-popup-dim"],

  /** ⚠️ 7-4. 도움말/온보딩 패널이 발행 버튼을 가립니다. 진입 직후와 발행 직전 각각 닫습니다. */
  helpPanel: [".se-help-container", ".se-help-panel"],
  helpClose: [".se-help-panel-close-button", ".se-help-header button"],

  // ── 입력 영역 ────────────────────────────────────────────────────
  title: [
    ".se-section-documentTitle .se-text-paragraph",
    ".se-documentTitle .se-text-paragraph",
    ".se-title-text",
  ],
  /** ⚠️ 7-26. 이걸 못 찾았을 때 그냥 Enter 로 넘어가면 글 전체가 제목 칸에 들어갑니다. */
  body: [
    ".se-section-text .se-text-paragraph",
    ".se-component-content .se-text-paragraph",
    ".se-main-container",
  ],

  // ── 툴바 ─────────────────────────────────────────────────────────
  imageButton: [
    "button.se-image-toolbar-button",
    "button[data-name='image']",
    "button[data-log='sti.image']",
    "button.se-toolbar-item-image",
  ],
  textFormatOpen: [".se-text-format-toolbar-button"],
  optHeading: [".se-toolbar-option-text-format-sectionTitle-button"],
  optBody: [".se-toolbar-option-text-format-text-button"],
  optQuote: [".se-toolbar-option-text-format-quotation-button"],
  dividerInsert: [".se-insert-horizontal-line-default-toolbar-button"],
  bold: [".se-bold-toolbar-button"],
  bgColorOpen: [".se-background-color-toolbar-button"],
  bgColorYellow: ["button[title='#fff8b2']", ".se-color-palette[title='#fff8b2']"],
  bgColorNone: [".se-color-palette-no-color"],

  contentComponents: [".se-content .se-component"],
  imageComponent: [".se-content .se-component.se-image"],
  /** ⚠️ 7-18. 업로드 직후 0×0 이라 클릭할 수 없습니다. 펼쳐지면 se-is-on 클래스가 붙습니다. */
  caption: [".se-caption"],

  // ── 발행 ─────────────────────────────────────────────────────────
  /** ⚠️ 7-2. :has-text('발행') 은 '예약 발행 0건' 에 부분일치합니다. 데이터 속성을 쓰세요. */
  publishOpen: ["button[data-click-area='tpb.publish']", "button.publish_btn__m9KHH"],
  /** ⚠️ 값 안의 '*' 는 오타가 아닙니다. 실측값 그대로입니다. */
  publishConfirm: ["button[data-click-area='tpb*i.publish']", "button.confirm_btn__WEaBq"],

  /**
   * ⚠️★ 7-19. radio input 은 13×13 이지만 opacity:0 이라 클릭되지 않습니다.
   *   실제로 눌러야 하는 건 label(58×18)입니다.
   *   그리고 네이버 발행 레이어의 기본값은 "전체공개"(value=2, checked=true 실증)입니다.
   *   label 클릭 후 반드시 input.checked 로 확인하고, 확인 안 되면 발행을 중단해야 합니다.
   */
  visibility: {
    public:   { label: 'label[for="open_public"]',        input: "#open_public" },   // value=2 (네이버 기본값)
    neighbor: { label: 'label[for="open_neighbor"]',      input: "#open_neighbor" },
    both:     { label: 'label[for="open_both_neighbor"]', input: "#open_both_neighbor" },
    private:  { label: 'label[for="open_private"]',       input: "#open_private" },  // value=0
  },

  /**
   * ⚠️ 7-21. 사진을 넣으면 우측 "라이브러리" 도크가 자동으로 열려 본문을 덮습니다.
   *   이 도크의 클래스는 환경에 따라 다릅니다 — 한 환경에서는 도움말 패널과 같은 계열이라
   *   .se-help-panel-close-button 으로 함께 닫혔지만, 다른 환경에서는 그게 0개이고
   *   .se-sidebar-close-button 만 있었습니다. 두 계열을 모두 시도하고, 없으면 Escape.
   */
  sidebarClose: [".se-help-panel-close-button", ".se-sidebar-close-button"],
  sidebar: [".se-sidebar", ".se-sidebar-container-library"],

  /**
   * ⚠️ 7-6. 화면 맨 아래 '글감 검색바'. 인용구 탈출 클릭의 y 좌표를 잘못 잡으면 여기를 눌러
   *   이후 캡션이 검색창에 타이핑되고 글감 패널이 열립니다. (실측 y=815)
   */
  bottomToolbar: [".se-flayer-unified-toolbar-wrapper"],
  bottomSearchInput: [".se-flayer-unified-search-input"],

  /** 본문 캔버스 — 탈출 클릭의 하한을 계산할 때 씁니다. */
  contentCanvas: [".se-content", ".se-main-container"],
} as const;

// ── 네이버 URL ────────────────────────────────────────────────────

export const NAVER = {
  login: "https://nid.naver.com/nidlogin.login",
  home: "https://www.naver.com",
  myBlog: "https://blog.naver.com/MyBlog.naver",
  write: (blogId: string) => `https://blog.naver.com/${blogId}?Redirect=Write&categoryNo=0`,
  newsSearch: (q: string) =>
    `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(q)}&sort=1`,
  blogSearch: (q: string) =>
    `https://search.naver.com/search.naver?where=blog&query=${encodeURIComponent(q)}`,
  imageSearch: (q: string) =>
    `https://search.naver.com/search.naver?where=image&query=${encodeURIComponent(q)}`,
  googleImageSearch: (q: string) =>
    `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`,
};

/**
 * ⚠️ 7-11. "발행 버튼을 눌렀다"는 "발행됐다"는 뜻이 아닙니다.
 *   실제로 blog_url 에 글쓰기 URL 이 그대로 기록돼 "발행 완료"로 표시된 적이 있습니다(임시저장이었음).
 *   게시글 주소로 바뀌었는지 이 패턴으로 확인해야 합니다.
 */
export const POST_URL_RE = /blog\.naver\.com\/[^/]+\/\d{6,}/;

/** ⚠️ 6-4. 블로그 "게시글" 링크만 통과시킵니다(블로그 홈 링크를 걸러내기 위해). */
export const BLOG_POST_HREF_RE = /blog\.naver\.com\/[^/]+\/\d{6,}/;
