import { Table, Tag } from "antd";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { useEvents } from "../api/useEvents";

export interface RouteRow { seq: number; process: string; equipment_code: string; status: string; good_qty: number; defect_qty: number }
export interface WorkOrder {
  wo_no: string; order_no: string; item_code: string; item_name: string; board_spec: string;
  qty: number; good_qty: number; status: string; routes: RouteRow[];
}

export const PROCESS_NAME: Record<string, string> = { CORRUGATE: "골판지기", PRINT: "인쇄", CONVERT: "가공" };
const ROUTE_COLOR: Record<string, string> = { WAIT: "default", RUN: "processing", DONE: "success" };
const WO_STATUS: Record<string, [string, string]> = {
  ISSUED: ["지시", "default"], IN_PROD: ["생산중", "processing"], DONE: ["완료", "success"],
};

export default function WorkOrders() {
  const [rows, setRows] = useState<WorkOrder[]>([]);
  const load = useCallback(() => api<WorkOrder[]>("/api/production/work-orders").then(setRows), []);
  useEffect(() => void load(), [load]);
  useEvents(["work_order", "production", "reset"], () => void load());

  return (
    <Table rowKey="wo_no" dataSource={rows} size="middle" pagination={{ pageSize: 20 }} scroll={{ x: "max-content" }}
      columns={[
        { title: "지시번호", dataIndex: "wo_no" },
        { title: "수주번호", dataIndex: "order_no" },
        { title: "품목", dataIndex: "item_name" },
        { title: "원단", dataIndex: "board_spec" },
        { title: "지시수량", dataIndex: "qty", align: "right", render: (v: number) => v.toLocaleString() },
        { title: "양품", dataIndex: "good_qty", align: "right", render: (v: number) => v.toLocaleString() },
        {
          title: "공정", render: (_, r) => r.routes.map((rt) => (
            <Tag key={rt.seq} color={ROUTE_COLOR[rt.status]}>{PROCESS_NAME[rt.process]}</Tag>
          )),
        },
        { title: "상태", dataIndex: "status", render: (s: string) => <Tag color={WO_STATUS[s]?.[1]}>{WO_STATUS[s]?.[0] ?? s}</Tag> },
      ]} />
  );
}
