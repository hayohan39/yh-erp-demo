import { Card, Col, Row, Statistic } from "antd";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { useEvents } from "../api/useEvents";

interface Summary {
  month: string;
  orders: { count: number; amount: number };
  interfaces: Record<string, number>;
  equipment_count: number;
}

export default function Dashboard() {
  const [s, setS] = useState<Summary>();
  const load = useCallback(() => api<Summary>("/api/dashboard/summary").then(setS), []);
  useEffect(() => void load(), [load]);
  useEvents(["sales_order", "if_message", "reset"], () => void load());

  const ifTotal = s ? Object.values(s.interfaces).reduce((a, b) => a + b, 0) : 0;
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} md={8}>
        <Card><Statistic title={`이번 달 수주 금액 (${s?.month ?? ""})`} value={s?.orders.amount ?? 0} suffix="원" /></Card>
      </Col>
      <Col xs={24} md={8}>
        <Card><Statistic title="이번 달 수주 건수" value={s?.orders.count ?? 0} suffix="건" /></Card>
      </Col>
      <Col xs={24} md={8}>
        <Card>
          <Statistic title="I/F 처리 (성공/실패)" value={ifTotal - (s?.interfaces.FAILED ?? 0)}
            suffix={`/ ${s?.interfaces.FAILED ?? 0}`} />
        </Card>
      </Col>
      <Col span={24}>
        <Card title="생산·출하·원가율">매출·생산·설비 가동률·원가율 지표는 해당 모듈 개발 후 표시됩니다.</Card>
      </Col>
    </Row>
  );
}
