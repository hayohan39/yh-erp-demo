import type { ThemeConfig } from "antd";

/**
 * 화면 테마: 그래파이트(짙은 회색 메뉴 + 청록 강조, 각진 평면형). 2026-11-18 시안 3종 중 선택.
 * 색·모서리·글꼴·컴포넌트는 antd 토큰으로, 셸(사이드바·헤더)과 카드 세부는 styles.css 에서.
 */
const FONT = `"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif`;

export const THEME: ThemeConfig = {
  token: {
    colorPrimary: "#0b7285", colorInfo: "#0b7285", colorSuccess: "#2b8a3e", colorWarning: "#d9480f", colorError: "#c92a2a",
    colorBgLayout: "#f3f4f5", colorBorderSecondary: "#e2e4e7", colorText: "#1e2226", colorTextSecondary: "#5c636b",
    borderRadius: 2, borderRadiusLG: 3, fontFamily: FONT, fontSize: 13, controlHeight: 32,
  },
  components: {
    Layout: { siderBg: "#22262b", headerBg: "#ffffff", headerHeight: 56 },
    Menu: {
      darkItemBg: "#22262b", darkSubMenuItemBg: "#1b1e22", darkItemSelectedBg: "#2f363d", darkItemSelectedColor: "#ffffff",
      darkItemColor: "rgba(255,255,255,.72)", darkItemHoverBg: "#2b3036", itemHeight: 38, itemBorderRadius: 0, itemMarginInline: 0,
    },
    Card: { headerFontSize: 14, headerHeight: 46 },
    Table: { headerBg: "#ffffff", headerColor: "#5c636b", headerSplitColor: "transparent", rowHoverBg: "#eef7f8", borderColor: "#e8eaec", cellPaddingBlock: 10 },
    Statistic: { contentFontSize: 26, titleFontSize: 12 },
    Segmented: { itemSelectedBg: "#22262b", itemSelectedColor: "#ffffff", trackBg: "#e9ebed" },
  },
};
