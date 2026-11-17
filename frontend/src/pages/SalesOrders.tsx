import { Table, Tag } from "antd";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { useEvents } from "../api/useEvents";

interface Order {
  order_no: string; oms_order_no: string; customer_name: string; order_date: string;
  due_date: string; status: string; total_amount: number; line_count: number;
}

export default function SalesOrders() {
  const [rows, setRows] = useState<Order[]>([]);
  const load = useCallback(() => api<Order[]>("/api/sales/orders").then(setRows), []);
  useEffect(() => void load(), [load]);
  useEvents(["sales_order", "reset"], () => void load());

  return (
    <Table rowKey="order_no" dataSource={rows} size="middle" pagination={{ pageSize: 20 }} scroll={{ x: true }}
      columns={[
        { title: "수주번호", dataIndex: "order_no" },
        { title: "OMS 주문번호", dataIndex: "oms_order_no" },
        { title: "거래처", dataIndex: "customer_name" },
        { title: "수주일", dataIndex: "order_date" },
        { title: "납기", dataIndex: "due_date" },
        { title: "품목수", dataIndex: "line_count", align: "right" },
        { title: "금액", dataIndex: "total_amount", align: "right", render: (v: number) => v.toLocaleString() },
        { title: "상태", dataIndex: "status", render: (v: string) => <Tag color="blue">{v}</Tag> },
      ]}
    />
  );
}
