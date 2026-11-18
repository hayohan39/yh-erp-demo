import {
  BarChartOutlined, ClusterOutlined, CalculatorOutlined, CarOutlined, DashboardOutlined,
  DatabaseOutlined, ExperimentOutlined, ApiOutlined, ScheduleOutlined, ShoppingCartOutlined,
  ToolOutlined, InboxOutlined, RadarChartOutlined,
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
    key: "monitor", label: "실시간 모니터링", icon: <RadarChartOutlined />,
    children: [
      { key: "/monitor/equipment", label: "설비 모니터링" },
      { key: "/monitor/facility", label: "공장 모니터링" },
    ],
  },
  { key: "/architecture", label: "시스템 구성", icon: <ClusterOutlined /> },
  {
    key: "master", label: "기준정보", icon: <DatabaseOutlined />,
    children: [
      { key: "/master/partners", label: "거래처" },
      { key: "/master/codes", label: "공통항목" },
      { key: "/master/items", label: "상자마스터" },
      { key: "/master/paper", label: "원지·원단 규격" },
      { key: "/master/material-cost", label: "원재료비" },
      { key: "/master/process-cost", label: "가공비·운반비" },
      { key: "/master/prices", label: "단가관리" },
      { key: "/master/equipment", label: "설비" },
      { key: "/master/warehouses", label: "창고·사업장" },
    ],
  },
  {
    key: "sales", label: "영업관리", icon: <ShoppingCartOutlined />,
    children: [
      { key: "/sales/customers", label: "거래처관리" },
      { key: "/sales/orders", label: "수주관리" },
      { key: "/sales/allocation", label: "수주전용" },
      { key: "/sales/ledger", label: "판매관리" },
      { key: "/sales/close", label: "마감관리" },
      { key: "/sales/invoice", label: "전자세금계산서" },
      { key: "/sales/receivables", label: "수금관리" },
      { key: "/sales/claims", label: "크레임 관리" },
    ],
  },
  {
    key: "scheduling", label: "스케쥴링", icon: <ScheduleOutlined />,
    children: [
      { key: "/scheduling/settings", label: "기준정보" },
      { key: "/scheduling/corrugator", label: "원단 스케쥴링" },
      { key: "/scheduling/gantt", label: "상자 스케쥴링" },
      { key: "/scheduling/dispatch", label: "배차 스케쥴링" },
      { key: "/scheduling/auto-order", label: "원지 자동발주" },
    ],
  },
  {
    key: "production", label: "생산관리", icon: <ToolOutlined />,
    children: [
      { key: "/production/work-orders", label: "생산지시" },
      { key: "/production/board", label: "생산진도" },
      { key: "/production/results", label: "생산실적" },
      { key: "/production/outsource", label: "외주·매입관리" },
      { key: "/production/adjust", label: "재고조정" },
      { key: "/production/work-log", label: "작업내역" },
      { key: "/production/processes", label: "공정관리" },
    ],
  },
  {
    key: "quality", label: "품질관리", icon: <ExperimentOutlined />,
    children: [
      { key: "/quality/specs", label: "시방 관리" },
      { key: "/quality/defects", label: "불량대책 관리" },
      { key: "/quality/dev-costs", label: "개발비 관리" },
      { key: "/quality/certs", label: "성적서 관리" },
      { key: "/quality/tooling", label: "조판·목형" },
    ],
  },
  {
    key: "material", label: "자재관리", icon: <InboxOutlined />,
    children: [
      { key: "/material/requirements", label: "원지소요관리" },
      { key: "/material/orders", label: "발주관리" },
      { key: "/material/purchases", label: "구매관리" },
      { key: "/material/paper-stock", label: "재고관리" },
      { key: "/material/transfer-site", label: "원지 사업장 이동" },
      { key: "/material/transfer-wh", label: "원지 창고 이동" },
      { key: "/material/sub", label: "부자재 관리" },
      { key: "/material/expenses", label: "경비관리" },
    ],
  },
  {
    key: "shipping", label: "출하관리", icon: <CarOutlined />,
    children: [
      { key: "/shipping/requests", label: "출하요청" },
      { key: "/shipping/moves", label: "입·출고" },
      { key: "/shipping/stock", label: "재고관리" },
      { key: "/shipping/dispatch", label: "배차상차" },
      { key: "/shipping/transfer-wh", label: "제품 창고 이동" },
      { key: "/shipping/transfer-site", label: "제품 사업장 이동" },
      { key: "/shipping/freight", label: "운반비 관리" },
      { key: "/shipping/pallets", label: "파렛트 관리" },
    ],
  },
  {
    key: "cost", label: "원가분석", icon: <CalculatorOutlined />,
    children: [
      { key: "/cost/settings", label: "기준정보" },
      { key: "/cost/orders", label: "실제원가(수주별)" },
      { key: "/cost/standard", label: "표준원가" },
      { key: "/cost/quote", label: "견적원가" },
      { key: "/cost/analysis", label: "원가분석" },
    ],
  },
  {
    key: "mis", label: "경영정보", icon: <BarChartOutlined />,
    children: [
      { key: "/mis/orders", label: "수주분석" },
      { key: "/mis/sales", label: "매출분석" },
      { key: "/mis/production", label: "생산분석" },
      { key: "/mis/paper", label: "원지매입" },
      { key: "/mis/freight", label: "운반비분석" },
    ],
  },
];

/** 사이드바 하단 '관리자용' 구역: 시연 진행·연동 점검용 도구(업무 메뉴와 분리). */
export const ADMIN_MENU: MenuNode[] = [
  { key: "/system/if-monitor", label: "I/F 모니터", icon: <ApiOutlined /> },
];

export function findLabel(path: string, nodes: MenuNode[] = [...MENU, ...ADMIN_MENU]): string | undefined {
  for (const n of nodes) {
    if (n.key === path) return n.label;
    const c = n.children && findLabel(path, n.children);
    if (c) return c;
  }
  return undefined;
}
