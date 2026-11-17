import { Card, Col, Progress, Row, Statistic, Tag } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useEvents } from "../api/useEvents";
import { ORDER_STATUS } from "../status";

interface Summary {
  month: string;
  orders: { count: number; amount: number };
  order_status: Record<string, number>;
  production: { good_qty: number; defect_rate: number; work_orders_open: number; work_orders_done: number };
  scheduling: { saved_amount: number; saved_paper_kg: number };
  defects_open: number;
  interfaces: Record<string, number>;
  sales: { invoiced_amount: number; invoices: number };
  shipping: { shipped: number; freight: number; in_progress: number };
  cost: { orders: number; cost_rate: number | null; profit: number; variance: number };
}

const STAGES = ORDER_STATUS;

export default function Dashboard() {
  const nav = useNavigate();
  const [s, setS] = useState<Summary>();
  const load = useCallback(() => api<Summary>("/api/dashboard/summary").then(setS), []);
  useEffect(() => void load(), [load]);
  useEvents(["sales_order", "if_message", "production", "schedule", "defect", "defect_closed", "shipment", "invoice", "reset"], () => void load());

  const ifTotal = s ? Object.values(s.interfaces).reduce((a, b) => a + b, 0) : 0;
  const ifFailed = s?.interfaces.FAILED ?? 0;
  const woTotal = (s?.production.work_orders_open ?? 0) + (s?.production.work_orders_done ?? 0);
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} sm={12} lg={6}>
        <Card className="kpi-card" hoverable onClick={() => nav("/sales/orders")}>
          <Statistic title={`이번 달 수주 금액 (${s?.month ?? ""})`} value={s?.orders.amount ?? 0} suffix="원" />
          <div style={{ color: "#64748b" }}>{s?.orders.count ?? 0}건</div>
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={6}>
        <Card className="kpi-card" hoverable onClick={() => nav("/production/board")}>
          <Statistic title="생산량 (가공 완료 양품)" value={s?.production.good_qty ?? 0} suffix="매" />
          <Progress percent={woTotal ? Math.round(((s?.production.work_orders_done ?? 0) / woTotal) * 100) : 0} size="small"
            format={() => `지시 ${s?.production.work_orders_done ?? 0}/${woTotal}`} />
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={6}>
        <Card className="kpi-card" hoverable onClick={() => nav("/quality/defects")}>
          <Statistic title="공정 불량률" value={((s?.production.defect_rate ?? 0) * 100).toFixed(2)} suffix="%" />
          <div>{s?.defects_open ? <Tag color="red">조치 필요 {s.defects_open}건</Tag> : <Tag color="green">미조치 없음</Tag>}</div>
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={6}>
        <Card className="kpi-card" hoverable onClick={() => nav("/scheduling/corrugator")}>
          <Statistic title="스케쥴링 원지 절감" value={s?.scheduling.saved_amount ?? 0} suffix="원" valueStyle={{ color: "#16a34a" }} />
          <div style={{ color: "#64748b" }}>{Math.round(s?.scheduling.saved_paper_kg ?? 0).toLocaleString()}kg</div>
        </Card>
      </Col>
      <Col xs={24} lg={16}>
        <Card title="수주 진행 단계" className="kpi-card" extra={<span style={{ color: "#94a3b8", fontSize: 12 }}>단계를 누르면 해당 수주 목록</span>}>
          <div className="stage-grid">
            {STAGES.map(([k, label]) => {
              const n = s?.order_status[k] ?? 0;
              return (
                <div key={k} className={`stage-cell${n ? "" : " zero"}`} role="button" tabIndex={0}
                  onClick={() => nav(`/sales/orders?status=${k}`)} onKeyDown={(e) => e.key === "Enter" && nav(`/sales/orders?status=${k}`)}>
                  <div className="n">{n.toLocaleString()}</div>
                  <div className="l">{label}</div>
                </div>
              );
            })}
          </div>
        </Card>
      </Col>
      <Col xs={24} lg={8}>
        <Card title="레거시 연동" hoverable onClick={() => nav("/system/if-monitor")}>
          <Statistic title="I/F 처리 건수" value={ifTotal} suffix="건" />
          {ifFailed ? <Tag color="red">실패 {ifFailed}건</Tag> : <Tag color="green">전체 정상</Tag>}
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={8}>
        <Card className="kpi-card" hoverable onClick={() => nav("/sales/invoice")}>
          <Statistic title="매출 (세금계산서 발행 공급가액)" value={s?.sales.invoiced_amount ?? 0} suffix="원" />
          <div style={{ color: "#64748b" }}>발행 {s?.sales.invoices ?? 0}건</div>
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={8}>
        <Card className="kpi-card" hoverable onClick={() => nav("/shipping/dispatch")}>
          <Statistic title="출하 완료" value={s?.shipping.shipped ?? 0} suffix="건" />
          <div style={{ color: "#64748b" }}>진행 중 {s?.shipping.in_progress ?? 0}건 · 운반비 {Math.round(s?.shipping.freight ?? 0).toLocaleString()}원</div>
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={8}>
        <Card className="kpi-card" hoverable onClick={() => nav("/cost/orders")}>
          <Statistic title="실제 원가율 (생산 완료 수주)" value={s?.cost.cost_rate == null ? "-" : (s.cost.cost_rate * 100).toFixed(1)}
            suffix={s?.cost.cost_rate == null ? "" : "%"} valueStyle={{ color: (s?.cost.cost_rate ?? 0) > 0.85 ? "#dc2626" : undefined }} />
          <div style={{ color: "#64748b" }}>
            이익 {Math.round(s?.cost.profit ?? 0).toLocaleString()}원 · 표준 대비 {(s?.cost.variance ?? 0) > 0 ? "+" : ""}{Math.round(s?.cost.variance ?? 0).toLocaleString()}원
          </div>
        </Card>
      </Col>
    </Row>
  );
}
