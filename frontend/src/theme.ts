import type { ThemeConfig } from "antd";

/**
 * 화면 테마(겉모습)만 바꾼다. 기능·화면 구성은 그대로.
 * - antd: 색·모서리·글꼴·컴포넌트 토큰
 * - shell: 사이드바/헤더 배색(App.tsx)
 * - css: <html data-theme="..."> 로 styles.css 의 테마별 규칙 적용
 */
export type ThemeKey = "navy" | "graphite" | "exec";

export interface AppTheme {
  key: ThemeKey;
  label: string;
  desc: string;
  antd: ThemeConfig;
  siderDark: boolean;
}

const FONT = `"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif`;

export const THEMES: Record<ThemeKey, AppTheme> = {
  // A. 네이비 셸: 남색 상단 셸바 + 밝은 사이드바, 촘촘한 표. 보수적·신뢰감(대형 ERP 정석형)
  navy: {
    key: "navy", label: "A. 네이비 셸", desc: "남색 상단 바 + 밝은 메뉴, 촘촘한 업무형", siderDark: false,
    antd: {
      token: {
        colorPrimary: "#0a5bc4", colorInfo: "#0a5bc4", colorSuccess: "#188a42", colorWarning: "#c87000", colorError: "#c62828",
        colorBgLayout: "#edf0f4", colorBorderSecondary: "#dfe3ea", colorText: "#1b2533", colorTextSecondary: "#556170",
        borderRadius: 4, borderRadiusLG: 6, fontFamily: FONT, fontSize: 13, controlHeight: 30,
      },
      components: {
        Layout: { siderBg: "#ffffff", headerBg: "#0f2a4a", headerHeight: 52 },
        Menu: { itemBg: "#ffffff", subMenuItemBg: "#ffffff", itemSelectedBg: "#e6effb", itemSelectedColor: "#0a5bc4", itemHeight: 36, itemBorderRadius: 4, itemColor: "#2c3a4b" },
        Card: { headerBg: "#ffffff", headerFontSize: 14, headerHeight: 44, paddingLG: 16 },
        Table: { headerBg: "#f3f5f8", headerColor: "#3d4a5c", headerSplitColor: "transparent", rowHoverBg: "#f2f7fe", cellPaddingBlock: 9, borderColor: "#e3e7ed" },
        Statistic: { contentFontSize: 24, titleFontSize: 12 },
        Segmented: { itemSelectedBg: "#0a5bc4", itemSelectedColor: "#ffffff" },
      },
    },
  },
  // B. 그래파이트: 짙은 회색 레일 메뉴 + 흰 헤더, 청록 강조, 각진 평면. 현대적 대기업 업무툴
  graphite: {
    key: "graphite", label: "B. 그래파이트", desc: "짙은 회색 메뉴 + 청록 강조, 각진 평면형", siderDark: true,
    antd: {
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
    },
  },
  // C. 이그제큐티브: 흰 메뉴 + 남보라 강조, 큰 숫자·여백·부드러운 그림자. 경영진 보고형
  exec: {
    key: "exec", label: "C. 이그제큐티브", desc: "흰 바탕 + 남보라 강조, 큰 숫자·여백 중심 보고형", siderDark: false,
    antd: {
      token: {
        colorPrimary: "#4338ca", colorInfo: "#4338ca", colorSuccess: "#059669", colorWarning: "#d97706", colorError: "#dc2626",
        colorBgLayout: "#f5f6fa", colorBorderSecondary: "#eceef4", colorText: "#111827", colorTextSecondary: "#6b7280",
        borderRadius: 8, borderRadiusLG: 14, fontFamily: FONT, fontSize: 14, controlHeight: 34,
        boxShadowTertiary: "0 1px 2px rgba(17,24,39,.04), 0 4px 16px rgba(17,24,39,.05)",
      },
      components: {
        Layout: { siderBg: "#ffffff", headerBg: "#ffffff", headerHeight: 60 },
        Menu: { itemBg: "#ffffff", subMenuItemBg: "#ffffff", itemSelectedBg: "#eef0ff", itemSelectedColor: "#4338ca", itemHeight: 40, itemBorderRadius: 8, itemColor: "#374151" },
        Card: { headerFontSize: 15, headerHeight: 52, paddingLG: 22 },
        Table: { headerBg: "#fafbfd", headerColor: "#6b7280", headerSplitColor: "transparent", rowHoverBg: "#f6f7ff", borderColor: "#f0f1f5", cellPaddingBlock: 13 },
        Statistic: { contentFontSize: 30, titleFontSize: 13 },
        Segmented: { itemSelectedColor: "#4338ca", trackBg: "#eef0f5" },
      },
    },
  },
};

const STORE = "yh-erp-theme";

/** ?theme=navy 로 바로 볼 수 있게 하고, 고른 테마는 브라우저에 기억한다. */
export function initialTheme(): ThemeKey {
  const q = new URLSearchParams(window.location.search).get("theme");
  if (q && q in THEMES) { try { localStorage.setItem(STORE, q); } catch { /* 저장 불가 */ } return q as ThemeKey; }
  try { const s = localStorage.getItem(STORE); if (s && s in THEMES) return s as ThemeKey; } catch { /* 저장 불가 */ }
  return "navy";
}

export function saveTheme(k: ThemeKey) { try { localStorage.setItem(STORE, k); } catch { /* 저장 불가 */ } }

import { createContext, useContext } from "react";
export const ThemeCtx = createContext<{ theme: AppTheme; setTheme: (k: ThemeKey) => void }>({ theme: THEMES.navy, setTheme: () => undefined });
export const useAppTheme = () => useContext(ThemeCtx);
