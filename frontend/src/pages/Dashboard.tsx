import { Card, Col, Progress, Row, Statistic, Tag } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useEvents } from "../api/useEvents";

interface Summary {
  month: string;
  orders: { count: number; amount: number };
  order_status: Record<string, number>;
  production: { good_qty: number; defect_rate: number; work_orders_open: number; work_orders_done: number };
  scheduling: { saved_amount: number; saved_paper_kg: number };
  defects_open: number;
  interfaces: Record<string, number>;
}

const STAGES: [string, string][] = [
  ["RECEIVED", "수주접수"], ["PLANNED", "계획"], ["IN_PROD", "생산중"], ["PRODUCED", "생산완료"],
  ["SHIPPED", "출하완료"], ["CLOSED", "마감"],
];

export default function Dashboard() {
  const nav = useNavigate();
  const [s, setS] = useState<Summary>();
  const load = useCallback(() => api<Summary>("/api/dashboard/summary").then(setS), []);
  useEffect(() => void load(), [load]);
  useEvents(["sales_order", "if_message", "production", "schedule", "defect", "defect_closed", "reset"], () => void load());

  const ifTotal = s ? Object.values(s.interfaces).reduce((a, b) => a + b, 0) : 0;
  const ifFailed = s?.interfaces.FAILED ?? 0;
  const woTotal = (s?.production.work_orders_open ?? 0) + (s?.production.work_orders_done ?? 0);
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} sm={12} lg={6}>
        <Card hoverable onClick={() => nav("/sales/orders")}>
          <Statistic title={`이번 달 수주 금액 (${s?.month ?? ""})`} value={s?.orders.amount ?? 0} suffix="원" />
          <div style={{ color: "#64748b" }}>{s?.orders.count ?? 0}건</div>
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={6}>
        <Card hoverable onClick={() => nav("/production/board")}>
          <Statistic title="생산량 (가공 완료 양품)" value={s?.production.good_qty ?? 0} suffix="매" />
          <Progress percent={woTotal ? Math.round(((s?.production.work_orders_done ?? 0) / woTotal) * 100) : 0} size="small"
            format={() => `지시 ${s?.production.work_orders_done ?? 0}/${woTotal}`} />
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={6}>
        <Card hoverable onClick={() => nav("/quality/defects")}>
          <Statistic title="공정 불량률" value={((s?.production.defect_rate ?? 0) * 100).toFixed(2)} suffix="%" />
          <div>{s?.defects_open ? <Tag color="red">조치 필요 {s.defects_open}건</Tag> : <Tag color="green">미조치 없음</Tag>}</div>
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={6}>
        <Card hoverable onClick={() => nav("/scheduling/corrugator")}>
          <Statistic title="스케쥴링 원지 절감" value={s?.scheduling.saved_amount ?? 0} suffix="원" valueStyle={{ color: "#16a34a" }} />
          <div style={{ color: "#64748b" }}>{Math.round(s?.scheduling.saved_paper_kg ?? 0).toLocaleString()}kg</div>
        </Card>
      </Col>
      <Col xs={24} lg={16}>
        <Card title="수주 진행 단계">
          <Row gutter={8}>
            {STAGES.map(([k, label]) => (
              <Col key={k} span={4} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 600 }}>{s?.order_status[k] ?? 0}</div>
                <div style={{ color: "#64748b" }}>{label}</div>
              </Col>
            ))}
          </Row>
        </Card>
      </Col>
      <Col xs={24} lg={8}>
        <Card title="레거시 연동" hoverable onClick={() => nav("/system/if-monitor")}>
          <Statistic title="I/F 처리 건수" value={ifTotal} suffix="건" />
          {ifFailed ? <Tag color="red">실패 {ifFailed}건</Tag> : <Tag color="green">전체 정상</Tag>}
        </Card>
      </Col>
      <Col span={24}>
        <Card size="small">출하·매출·원가율 지표는 해당 모듈 개발 후 표시됩니다.</Card>
      </Col>
    </Row>
  );
}
