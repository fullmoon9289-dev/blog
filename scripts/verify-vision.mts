import { runClaude } from "@/lib/claude";

// ⚠️ 체크리스트 A: "프로젝트 밖 절대경로" 이미지도 읽히는지 확인해야 합니다.
const outside = "/usr/share/icons/hicolor/512x512/mimetypes/libreoffice-oasis-web-template.png";
console.log("\n[A] 이미지 판독(@절대경로) 검증 — 프로젝트 밖 경로\n  대상:", outside);

const res = await runClaude(
  "첨부된 이미지를 실제로 보고, 무엇이 그려져 있는지 한국어 한 문장으로만 답하라. 파일 이름에서 추측하지 말고 그림 자체를 묘사하라.",
  { images: [outside] },
);

if (!res.ok) { console.log("  ❌ 실패 —", res.error); process.exit(1); }
console.log("  응답:", res.text.trim());

// 파일명(web-template)만 보고 답한 게 아니라 그림의 시각적 특징을 말했는지 확인
const visual = /파랑|파란|blue|문서|아이콘|지구|globe|모서리|접힌|줄|선|흰/i.test(res.text);
console.log(visual ? "  ✅ 이미지를 실제로 보고 묘사함" : "  ⚠️ 시각적 묘사인지 불확실 — 응답을 직접 확인하세요");
process.exit(visual ? 0 : 1);
