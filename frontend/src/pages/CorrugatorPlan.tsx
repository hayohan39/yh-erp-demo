import { Alert, Button, Card, Col, Empty, Row, Space, Statistic, Table, Tag, Tooltip, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import { api, post } from "../api/client";
import { useEvents } from "../api/useEvents";

interface Slot { item_code: string; ups: number; blank_w: number; sheets: number; order_no: string; customer_name: string }
interface Run { seq: number; board_spec: string; roll_width: number; cuts: number; length_m: number; trim_mm: number; trim_rate: number; slots: Slot[] }
interface Plan {
  plan_no: string; status: string; order_count: number; area_m2: number; trim_rate: number;
  manual_area_m2: number; manual_trim_rate: number; saved_paper_kg: number; saved_amount: number; runs: Run[];
}
interface Pending { order_no: string; customer_code: string; due_date: string; lines: number; qty: number }

const COLORS = ["#2563eb", "#16a34a", "#9333ea", "#ea580c"];
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** 원지 폭 안에 품목이 몇 장씩 놓였는지와 트림을 막대로 보여준다. */
function WidthBar({ run }: { run: Run }) {
  return (
    <div style={{ display: "flex", height: 26, width: "100%", minWidth: 240, border: "1px solid #cbd5e1", borderRadius: 4, overflow: "hidden" }}>
      {run.slots.flatMap((s, i) =>
        Array.from({ length: s.ups }, (_, k) => (
          <Tooltip key={`${i}-${k}`} title={`${s.item_code} (${s.customer_name}) 폭 ${s.blank_w}mm`}>
            <div style={{
              width: `${(s.blank_w / run.roll_width) * 100}%`, background: COLORS[i % COLORS.length],
              opacity: 0.85, borderRight: "1px solid #fff", color: "#fff", fontSize: 11, textAlign: "center", lineHeight: "24px",
              overflow: "hidden", whiteSpace: "nowrap",
            }}>{k === 0 ? s.item_code : ""}</div>
          </Tooltip>
        )),
      )}
      <Tooltip title={`트림 ${run.trim_mm}mm`}>
        <div style={{ flex: 1, background: "repeating-linear-gradient(45deg,#fecaca,#fecaca 4px,#fee2e2 4px,#fee2e2 8px)" }} />
      </Tooltip>
    </div>
  );
}

export default function CorrugatorPlan() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api<Plan | null>("/api/scheduling/plans/latest").then(setPlan);
    api<Pending[]>("/api/scheduling/pending-orders").then(setPending);
  }, []);
  useEffect(() => void load(), [load]);
  useEvents(["sales_order", "schedule", "reset"], () => void load());

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); message.success(ok); } catch (e) { message.error(String(e)); }
    setBusy(false);
    load();
  };

  const improve = plan ? plan.manual_trim_rate - plan.trim_rate : 0;
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card size="small">
        <Space wrap>
          <span>스케쥴링 대기 수주 <b>{pending.length}</b>건 (품목 {pending.reduce((a, p) => a + p.lines, 0)}개)</span>
          <Button type="primary" loading={busy} disabled={!pending.length}
            onClick={() => act(() => post("/api/scheduling/plans"), "원단 폭 조합을 계산했습니다")}>폭 조합 계산</Button>
          {plan?.status === "DRAFT" && (
            <Button type="primary" danger loading={busy}
              onClick={() => act(() => post(`/api/scheduling/plans/${plan.plan_no}/confirm`), "생산지시를 발행했습니다")}>
              확정 → 생산지시 발행
            </Button>
          )}
        </Space>
      </Card>
      {!plan ? <Card><Empty description="아직 계산된 스케쥴이 없습니다" /></Card> : (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={12} md={6}><Card><Statistic title="트림 손실률 (추천)" value={pct(plan.trim_rate)} valueStyle={{ color: "#16a34a" }} /></Card></Col>
            <Col xs={12} md={6}><Card><Statistic title="트림 손실률 (수작업 기준)" value={pct(plan.manual_trim_rate)} /></Card></Col>
            <Col xs={12} md={6}><Card><Statistic title="원지 절감" value={plan.saved_paper_kg} precision={0} suffix="kg" /></Card></Col>
            <Col xs={12} md={6}><Card><Statistic title="원지 비용 절감" value={plan.saved_amount} suffix="원" valueStyle={{ color: "#16a34a" }} /></Card></Col>
          </Row>
          <Alert type="success" showIcon
            message={`${plan.plan_no} · 수주 ${plan.order_count}건을 런 ${plan.runs.length}개로 묶어 수작업 계획보다 트림 손실을 ${(improve * 100).toFixed(1)}%p 줄였습니다.`}
            description="수작업 계획은 품목마다 단독으로 가장 맞는 원지 폭을 고르는 방식으로 가정했습니다."
            action={<Tag color={plan.status === "CONFIRMED" ? "green" : "gold"}>{plan.status === "CONFIRMED" ? "확정" : "초안"}</Tag>} />
          <Card title="골판지기 런 (원지 폭 조합)" size="small">
            <Table rowKey="seq" dataSource={plan.runs} size="small" pagination={false} scroll={{ x: true }}
              columns={[
                { title: "순서", dataIndex: "seq", width: 60 },
                { title: "원단", dataIndex: "board_spec" },
                { title: "원지 폭", dataIndex: "roll_width", render: (v: number) => `${v}mm` },
                { title: "폭 배치", render: (_, r) => <WidthBar run={r} />, width: 360 },
                { title: "품목 × 장수", render: (_, r) => r.slots.map((s) => `${s.item_code}×${s.ups}`).join(" + ") },
                { title: "컷수", dataIndex: "cuts", align: "right" },
                { title: "길이", dataIndex: "length_m", align: "right", render: (v: number) => `${v.toLocaleString()}m` },
                { title: "트림", dataIndex: "trim_rate", align: "right", render: (v: number) => pct(v) },
              ]} />
          </Card>
        </>
      )}
    </Space>
  );
}
