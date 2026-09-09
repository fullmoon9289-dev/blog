/**
 * Cloudflare Workers AI 단가 계산 (6-7 / 7-12)
 * ⚠️ 서버·클라이언트 공용 순수 함수입니다. 여기에 import 를 추가하지 마세요.
 */

/** Workers AI 무료 한도 (하루). */
export const FREE_NEURONS_PER_DAY = 10_000;

/**
 * ⚠️★ 7-12. 문서만 보면 `타일 × 4.8 + 스텝 × 9.6` 처럼 읽히지만 틀립니다.
 *   스텝 요금은 이미지 1장이 아니라 "타일마다" 붙습니다.
 *
 *     잘못:  4×4.8 + 6×9.6   =  76.8/장
 *     맞음:  4×(4.8 + 6×9.6) = 249.6/장   ← 실측 7,738 ÷ 31장 = 249.6 (오차 0.4)
 *
 *   잘못된 공식을 쓰면 사용량을 3.4배 과소평가합니다.
 *
 * ⚠️ 반환값은 정수가 아닙니다(6스텝 = 249.6). 계산은 실수로 하고
 *   화면에 표시할 때만 Math.round() 하세요. 안 그러면 계량기에 소수점이 뜹니다.
 */
export function neuronsPerImage(steps: number, size = 1024): number {
  const tiles = Math.max(1, Math.round((size / 512) * (size / 512)));
  return tiles * (4.8 + Math.min(Math.max(steps, 1), 8) * 9.6);
}

/** 무료 한도로 하루에 몇 장 만들 수 있는지. */
export function imagesPerFreeDay(steps: number, size = 1024): number {
  return Math.floor(FREE_NEURONS_PER_DAY / neuronsPerImage(steps, size));
}

/** 한 편에 사진 N장을 쓴다고 할 때 하루 몇 편인지. */
export function postsPerFreeDay(steps: number, imagesPerPost = 5, size = 1024): number {
  return Math.floor(imagesPerFreeDay(steps, size) / imagesPerPost);
}
