import { Button, Card, Empty, Space, Steps, Table, Tag, Typography, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import { api, post } from "../api/client";
import { useEvents } from "../api/useEvents";
import { dt, num, won } from "../status";

interface ReadyOrder {
  order_no: string; customer_name: string; due_date: string; total_amount: number; total_qty: number;
  items: { item_code: string; item_name: string; qty: number }[];
}
export interface ShipmentRow {
  shipment_no: string; order_no: string; customer_name: string; status: string; carrier_name: string | null;
  vehicle_no: string | null; driver_name: string | null; driver_phone: string | null; freight_amount: number;
  requested_at: string; dispatched_at: string | null; shipped_at: string | null; total_qty: number;
  lines: { item_code: string; item_name: string; qty: number }[];
}

const STEP = { REQUESTED: 0, DISPATCHED: 1, SHIPPED: 2 } as Record<string, number>;
const STATUS_TAG: Record<string, [string, string]> = {
  REQUESTED: ["배차 대기", "orange"], DISPATCHED: ["배차 확정", "blue"], SHIPPED: ["출발", "green"],
};

function useShipments() {
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const load = useCallback(() => api<ShipmentRow[]>("/api/shipping/shipments").then(setRows), []);
  useEffect(() => void load(), [load]);
  useEvents(["shipment", "reset"], () => void load());
  return rows;
}

function ShipmentTable({ rows, compact }: { rows: ShipmentRow[]; compact?: boolean }) {
  return (
    <Table rowKey="shipment_no" dataSource={rows} size="middle" pagination={{ pageSize: 10 }} scroll={{ x: true }}
      locale={{ emptyText: "출하 내역이 없습니다" }}
      columns={[
        { title: "출하번호", dataIndex: "shipment_no" },
        { title: "수주번호", dataIndex: "order_no" },
        { title: "거래처", dataIndex: "customer_name" },
        { title: "수량(매)", dataIndex: "total_qty", align: "right", render: num },
        { title: "진행", dataIndex: "status", width: 260, render: (s: string) => (
          <Steps size="small" current={STEP[s]} status={s === "SHIPPED" ? "finish" : "process"}
            items={[{ title: "요청" }, { title: "배차" }, { title: "출발" }]} />
        ) },
        ...(compact ? [] : [
          { title: "운송사", dataIndex: "carrier_name", render: (v: string | null) => v ?? "-" },
          { title: "차량", dataIndex: "vehicle_no", render: (v: string | null, r: ShipmentRow) => v ? <span>{v}<br /><small style={{ color: "#64748b" }}>{r.driver_name} {r.driver_phone}</small></span> : "-" },
          { title: "운임", dataIndex: "freight_amount", align: "right" as const, render: (v: number) => (v ? won(v) : "-") },
          { title: "요청", dataIndex: "requested_at", render: dt },
          { title: "배차", dataIndex: "dispatched_at", render: dt },
          { title: "출발", dataIndex: "shipped_at", render: dt },
        ]),
        { title: "상태", dataIndex: "status", render: (s: string) => <Tag color={STATUS_TAG[s]?.[1]}>{STATUS_TAG[s]?.[0] ?? s}</Tag> },
      ]} />
  );
}

/** 출하관리 → 출하요청: 생산완료 수주를 골라 로지스팟에 배차를 요청한다. */
export function ShippingRequests() {
  const [ready, setReady] = useState<ReadyOrder[]>([]);
  const [busy, setBusy] = useState<string>();
  const shipments = useShipments();
  const load = useCallback(() => api<ReadyOrder[]>("/api/shipping/ready").then(setReady), []);
  useEffect(() => void load(), [load]);
  useEvents(["sales_order", "shipment", "reset"], () => void load());

  const request = async (order_no: string) => {
    setBusy(order_no);
    try {
      const r = await post<{ shipment_no: string }>("/api/shipping/requests", { order_no });
      message.success(`${r.shipment_no} 출하요청 → 로지스팟 배차요청 전송`);
    } catch (e) { message.error(String(e)); }
    setBusy(undefined);
    void load();
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="출하 대기 (생산완료 수주)" extra={<Typography.Text type="secondary">출하요청을 누르면 상차정보가 로지스팟으로 전송됩니다</Typography.Text>}>
        {ready.length === 0 ? <Empty description="생산이 끝난 수주가 없습니다" /> : (
          <Table rowKey="order_no" dataSource={ready} pagination={false} size="middle" scroll={{ x: true }}
            columns={[
              { title: "수주번호", dataIndex: "order_no" },
              { title: "거래처", dataIndex: "customer_name" },
              { title: "납기", dataIndex: "due_date" },
              { title: "품목", dataIndex: "items", render: (its: ReadyOrder["items"]) => its.map((i) => <div key={i.item_code}>{i.item_name} <b>{num(i.qty)}</b>매</div>) },
              { title: "출하 수량(양품)", dataIndex: "total_qty", align: "right", render: num },
              { title: "", key: "act", render: (_, r) => <Button type="primary" loading={busy === r.order_no} onClick={() => request(r.order_no)}>출하요청</Button> },
            ]} />
        )}
      </Card>
      <Card title="최근 출하" size="small"><ShipmentTable rows={shipments.slice(0, 5)} compact /></Card>
    </Space>
  );
}

/** 출하관리 → 배차 현황: 로지스팟 배차 결과(차량·기사·운임)와 출발 여부. */
export function DispatchBoard() {
  const shipments = useShipments();
  const cnt = (s: string) => shipments.filter((x) => x.status === s).length;
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Space size={12} wrap>
        <Tag color="orange" style={{ fontSize: 14, padding: "4px 10px" }}>배차 대기 {cnt("REQUESTED")}</Tag>
        <Tag color="blue" style={{ fontSize: 14, padding: "4px 10px" }}>배차 확정 {cnt("DISPATCHED")}</Tag>
        <Tag color="green" style={{ fontSize: 14, padding: "4px 10px" }}>출발 {cnt("SHIPPED")}</Tag>
        <Typography.Text type="secondary">로지스팟 연동: 배차요청(IF-EXT-02) → 배차결과·상차완료 콜백</Typography.Text>
      </Space>
      <Card><ShipmentTable rows={shipments} /></Card>
    </Space>
  );
}
