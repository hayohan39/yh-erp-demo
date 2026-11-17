import { Tag } from "antd";

/** 수주 상태: 접수 → 계획 → 생산중 → 생산완료 → 출하중 → 출하완료 → 마감중(세금계산서) → 마감 */
export const ORDER_STATUS: [string, string, string][] = [
  ["RECEIVED", "수주접수", "default"], ["PLANNED", "계획", "cyan"], ["IN_PROD", "생산중", "blue"],
  ["PRODUCED", "생산완료", "geekblue"], ["SHIPPING", "출하중", "orange"], ["SHIPPED", "출하완료", "gold"],
  ["INVOICING", "계산서 발행중", "purple"], ["CLOSED", "마감", "green"],
];
const BY = Object.fromEntries(ORDER_STATUS.map(([k, l, c]) => [k, { l, c }]));
export const OrderStatus = ({ s }: { s: string }) => <Tag color={BY[s]?.c}>{BY[s]?.l ?? s}</Tag>;

export const won = (v: number | null | undefined) => (v == null ? "-" : `${Math.round(v).toLocaleString()}원`);
export const num = (v: number | null | undefined) => (v == null ? "-" : Math.round(v).toLocaleString());
/** 서버 시각(UTC, 시간대 표기 없음)을 한국 시간 "MM. DD. HH:mm:ss"로. 시간대가 붙어 오면 그대로 해석한다. */
export const dt = (v: string | null | undefined) =>
  v ? new Date(/(Z|[+-]\d\d:?\d\d)$/.test(v) ? v : v + "Z").toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "-";

/** 기준정보·연동 코드값의 한글 표기. */
export const CODE_LABEL: Record<string, string> = {
  CUSTOMER: "고객사", SUPPLIER: "원지 공급사", CARRIER: "운송사",
  LINER: "라이너", MEDIUM: "골심지",
  CORRUGATE: "골판지기", PRINT: "인쇄", CONVERT: "가공",
};
export const codeLabel = (v: string | null | undefined) => (v == null ? "-" : CODE_LABEL[v] ?? v);

/** I/F 메시지 상태. */
export const IF_STATUS: Record<string, [string, string]> = {
  PROCESSED: ["처리 완료", "green"], SENT: ["송신 완료", "green"], RECEIVED: ["수신", "gold"], FAILED: ["실패", "red"],
};
export const IfStatus = ({ s }: { s: string }) => <Tag color={IF_STATUS[s]?.[1]}>{IF_STATUS[s]?.[0] ?? s}</Tag>;
