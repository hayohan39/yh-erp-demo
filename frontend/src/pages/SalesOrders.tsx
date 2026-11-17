import { Card, Input, Segmented, Space, Table, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ORDER_STATUS, OrderStatus, won } from "../status";
import { api } from "../api/client";
import { useEvents } from "../api/useEvents";

interface Order {
  order_no: string; oms_order_no: string; customer_name: string; order_date: string;
  due_date: string; status: string; total_amount: number; line_count: number;
}

export default function SalesOrders() {
  const [rows, setRows] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "ALL";
  const [q, setQ] = useState("");
  const load = useCallback(() => api<Order[]>("/api/sales/orders").then(setRows).finally(() => setLoading(false)), []);
  useEffect(() => void load(), [load]);
  useEvents(["sales_order", "reset"], () => void load());

  const count = useMemo(() => {
    const c: Record<string, number> = {};
    rows.forEach((r) => { c[r.status] = (c[r.status] ?? 0) + 1; });
    return c;
  }, [rows]);
  const kw = q.trim().toLowerCase();
  const shown = rows.filter((r) => (status === "ALL" || r.status === status)
    && (!kw || [r.order_no, r.oms_order_no, r.customer_name].some((v) => v.toLowerCase().includes(kw))));
  const total = shown.reduce((a, r) => a + r.total_amount, 0);

  return (
    <Card>
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <div style={{ overflowX: "auto" }}>
          <Segmented value={status}
            onChange={(v) => setParams(v === "ALL" ? {} : { status: String(v) }, { replace: true })}
            options={[
              { value: "ALL", label: `전체 ${rows.length}` },
              ...ORDER_STATUS.filter(([k]) => count[k]).map(([k, l]) => ({ value: k, label: `${l} ${count[k]}` })),
            ]} />
        </div>
        <Space wrap style={{ justifyContent: "space-between", width: "100%" }}>
          <Input.Search allowClear placeholder="수주번호·OMS 주문번호·거래처 검색" onChange={(e) => setQ(e.target.value)} style={{ width: 300, maxWidth: "100%" }} />
          <Typography.Text type="secondary">{shown.length}건 · 합계 <b style={{ color: "#0f172a" }}>{won(total)}</b></Typography.Text>
        </Space>
        <Table rowKey="order_no" dataSource={shown} loading={loading} size="middle" pagination={{ pageSize: 20, showSizeChanger: false }} scroll={{ x: "max-content" }}
          columns={[
            { title: "수주번호", dataIndex: "order_no", sorter: (a, b) => a.order_no.localeCompare(b.order_no) },
            { title: "OMS 주문번호", dataIndex: "oms_order_no" },
            { title: "거래처", dataIndex: "customer_name" },
            { title: "수주일", dataIndex: "order_date" },
            { title: "납기", dataIndex: "due_date", sorter: (a, b) => a.due_date.localeCompare(b.due_date) },
            { title: "품목수", dataIndex: "line_count", align: "right" },
            { title: "금액", dataIndex: "total_amount", align: "right", render: won, sorter: (a, b) => a.total_amount - b.total_amount },
            { title: "상태", dataIndex: "status", render: (v: string) => <OrderStatus s={v} /> },
          ]}
        />
      </Space>
    </Card>
  );
}
