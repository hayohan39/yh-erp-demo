import {
  AppstoreOutlined, BarChartOutlined, CalculatorOutlined, CarOutlined, DashboardOutlined,
  DatabaseOutlined, ExperimentOutlined, ApiOutlined, ScheduleOutlined, ShoppingCartOutlined,
  ToolOutlined, InboxOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";

export interface MenuNode {
  key: string;
  label: string;
  icon?: ReactNode;
  children?: MenuNode[];
}

/** ERP 9개 모듈 + 공통. 화면이 아직 없는 메뉴는 '준비 중' 페이지로 연결된다. */
export const MENU: MenuNode[] = [
  { key: "/dashboard", label: "경영 대시보드", icon: <DashboardOutlined /> },
  {
    key: "master", label: "기준정보", icon: <DatabaseOutlined />,
    children: [
      { key: "/master/partners", label: "거래처" },
      { key: "/master/items", label: "상자 품목" },
      { key: "/master/paper", label: "원지·원단 규격" },
      { key: "/master/equipment", label: "설비" },
    ],
  },
  {
    key: "sales", label: "영업관리", icon: <ShoppingCartOutlined />,
    children: [
      { key: "/sales/orders", label: "수주 현황" },
      { key: "/sales/close", label: "매출 마감" },
      { key: "/sales/invoice", label: "세금계산서" },
    ],
  },
  {
    key: "scheduling", label: "스케쥴링", icon: <ScheduleOutlined />,
    children: [
      { key: "/scheduling/corrugator", label: "원단 폭 조합" },
      { key: "/scheduling/gantt", label: "인쇄·가공 간트" },
    ],
  },
  {
    key: "production", label: "생산관리", icon: <ToolOutlined />,
    children: [
      { key: "/production/work-orders", label: "생산지시" },
      { key: "/production/board", label: "공정 진도 보드" },
    ],
  },
  {
    key: "quality", label: "품질관리", icon: <ExperimentOutlined />,
    children: [{ key: "/quality/defects", label: "불량·대책" }],
  },
  {
    key: "material", label: "자재관리", icon: <InboxOutlined />,
    children: [{ key: "/material/paper-stock", label: "원지 재고" }],
  },
  {
    key: "shipping", label: "출하관리", icon: <CarOutlined />,
    children: [
      { key: "/shipping/requests", label: "출하요청" },
      { key: "/shipping/dispatch", label: "배차 현황" },
    ],
  },
  {
    key: "cost", label: "원가분석", icon: <CalculatorOutlined />,
    children: [
      { key: "/cost/orders", label: "수주별 원가" },
      { key: "/cost/quote", label: "견적원가 계산기" },
    ],
  },
  {
    key: "mis", label: "경영정보", icon: <BarChartOutlined />,
    children: [{ key: "/mis/trend", label: "월/년 추이" }],
  },
  {
    key: "common", label: "연동·시스템", icon: <AppstoreOutlined />,
    children: [
      { key: "/system/if-monitor", label: "I/F 모니터", icon: <ApiOutlined /> },
      { key: "/system/simulator", label: "시뮬레이터 제어" },
    ],
  },
];

export function findLabel(path: string, nodes: MenuNode[] = MENU): string | undefined {
  for (const n of nodes) {
    if (n.key === path) return n.label;
    const c = n.children && findLabel(path, n.children);
    if (c) return c;
  }
  return undefined;
}
