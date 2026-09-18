/*
 * 사이트 설정 — 여기 값만 채우면 자동 반영됩니다. (코드 수정 불필요)
 *
 * 1) telegramUrl    : 텔레그램 채널 공개 링크. 채우면 헤더에 채널 버튼이 켜짐.
 * 2) gaMeasurementId: Google Analytics 4 측정 ID. (비우면 추적 비활성)
 * 3) mddUrl         : MDD 페이지(시즌2) 주소. 상단 탭에서 이동.
 * 4) disparityUrl   : 50일 이격도 페이지(시즌1) 주소. 상단 탭에서 이동.
 *
 * ※ 본 페이지는 자체 파이프라인(scripts/)이 삼성전자 본주·우선주 괴리율을 계산해
 *   docs/data/*.json 으로 저장한 자기 데이터를 읽습니다. (다른 페이지와 완전 독립)
 */
window.SITE_CONFIG = {
  telegramUrl: "https://t.me/andyc14note",
  gaMeasurementId: "G-B8M3849G0G",
  mddUrl: "https://andy-0401.github.io/kr-mdd/",
  disparityUrl: "https://kospi-ma.netlify.app",
  // 공유 버튼이 복사/공유할 '정식 주소'. 뒤에 공유 추적 태그가 붙음.
  shareUrl: "https://kospi-ma.netlify.app/kospipref",
};
