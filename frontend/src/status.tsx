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
export const dt = (v: string | null | undefined) =>
  v ? new Date(v + (v.endsWith("Z") ? "" : "Z")).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "-";
