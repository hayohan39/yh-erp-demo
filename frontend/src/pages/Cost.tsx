import { Alert, Button, Card, Col, Descriptions, Empty, Form, InputNumber, Row, Select, Slider, Space, Statistic, Table, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { api, post } from "../api/client";
import { useEvents } from "../api/useEvents";
import { OrderStatus, num, won } from "../status";

interface CostRow { key: string; label: string; std: number; act: number | null; diff: number | null }
interface OrderCost {
  order_no: string; customer_name: string; status: string; order_qty: number; good_qty: number; defect_qty: number;
  paper_kg: number; sales: number; std_cost: number; act_cost: number; variance: number; profit: number;
  cost_rate: number | null; unit_cost: number | null; freight_estimated: boolean; rows: CostRow[];
}

const pct = (v: number | null) => (v == null ? "-" : `${(v * 100).toFixed(1)}%`);

function Bars({ rows }: { rows: CostRow[] }) {
  const max = Math.max(...rows.flatMap((r) => [r.std, r.act ?? 0]), 1);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 90px", gap: "6px 10px", alignItems: "center" }}>
      {rows.map((r) => (
        <div key={r.key} style={{ display: "contents" }}>
          <span style={{ fontSize: 13 }}>{r.label}</span>
          <div>
            <div style={{ height: 9, width: `${(r.std / max) * 100}%`, background: "#cbd5e1", borderRadius: 4, marginBottom: 3 }} title={`표준 ${won(r.std)}`} />
            <div style={{ height: 9, width: `${((r.act ?? 0) / max) * 100}%`, background: (r.diff ?? 0) > 0 ? "#ef4444" : "#3b82f6", borderRadius: 4 }} title={`실제 ${won(r.act)}`} />
          </div>
          <span style={{ fontSize: 12, textAlign: "right", color: r.diff == null ? "#94a3b8" : r.diff > 0 ? "#dc2626" : "#16a34a" }}>
            {r.diff == null ? "예정" : `${r.diff > 0 ? "+" : ""}${num(r.diff)}`}
          </span>
        </div>
      ))}
      <span /><span style={{ fontSize: 11, color: "#64748b" }}><span style={{ display: "inline-block", width: 10, height: 8, background: "#cbd5e1" }} /> 표준 · <span style={{ display: "inline-block", width: 10, height: 8, background: "#3b82f6" }} /> 실제 (빨강 = 표준 초과)</span><span />
    </div>
  );
}

/** 원가분석 → 수주별 원가: 표준원가 vs 실제원가(PMS 원지 투입·설비 실적 시간·로지스팟 운임). */
export function OrderCosts() {
  const [rows, setRows] = useState<OrderCost[]>([]);
  const load = useCallback(() => api<OrderCost[]>("/api/cost/orders").then(setRows), []);
  useEffect(() => void load(), [load]);
  useEvents(["sales_order", "shipment", "invoice", "reset"], () => void load());

  const sales = rows.reduce((a, b) => a + b.sales, 0);
  const act = rows.reduce((a, b) => a + b.act_cost, 0);
  const std = rows.reduce((a, b) => a + b.std_cost, 0);
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Row gutter={[16, 16]}>
        <Col xs={12} lg={6}><Card><Statistic title="매출 (분석 대상)" value={sales} suffix="원" /></Card></Col>
        <Col xs={12} lg={6}><Card><Statistic title="실제 원가" value={act} suffix="원" /></Card></Col>
        <Col xs={12} lg={6}><Card><Statistic title="실제 원가율" value={sales ? ((act / sales) * 100).toFixed(1) : "-"} suffix={sales ? "%" : ""} /></Card></Col>
        <Col xs={12} lg={6}><Card><Statistic title="표준 대비 차이" value={act - std} suffix="원" valueStyle={{ color: act > std ? "#dc2626" : "#16a34a" }} prefix={act > std ? "+" : ""} /></Card></Col>
      </Row>
      <Card title="수주별 원가" extra={<Typography.Text type="secondary">행을 펼치면 항목별 표준·실제를 비교합니다</Typography.Text>}>
        <Table rowKey="order_no" dataSource={rows} size="middle" pagination={{ pageSize: 10 }} scroll={{ x: true }}
          locale={{ emptyText: <Empty description="생산이 끝난 수주부터 원가가 계산됩니다" /> }}
          expandable={{
            expandedRowRender: (r) => (
              <Row gutter={24}>
                <Col xs={24} lg={12}><Bars rows={r.rows} /></Col>
                <Col xs={24} lg={12}>
                  <Descriptions size="small" column={2} items={[
                    { label: "주문 수량", children: `${num(r.order_qty)}매` },
                    { label: "양품", children: `${num(r.good_qty)}매` },
                    { label: "불량", children: `${num(r.defect_qty)}매` },
                    { label: "원지 투입", children: `${num(r.paper_kg)}kg` },
                    { label: "매당 실제원가", children: r.unit_cost ? `${r.unit_cost.toLocaleString()}원` : "-" },
                    { label: "이익", children: won(r.profit) },
                  ]} />
                  {r.freight_estimated && <Alert type="info" showIcon style={{ marginTop: 8 }} message="출하 전이라 운반비는 표준 운임으로 넣었습니다" />}
                </Col>
              </Row>
            ),
          }}
          columns={[
            { title: "수주번호", dataIndex: "order_no" },
            { title: "거래처", dataIndex: "customer_name" },
            { title: "상태", dataIndex: "status", render: (s: string) => <OrderStatus s={s} /> },
            { title: "매출", dataIndex: "sales", align: "right", render: won },
            { title: "표준원가", dataIndex: "std_cost", align: "right", render: won },
            { title: "실제원가", dataIndex: "act_cost", align: "right", render: won },
            { title: "차이", dataIndex: "variance", align: "right", render: (v: number) => <span style={{ color: v > 0 ? "#dc2626" : "#16a34a" }}>{v > 0 ? "+" : ""}{num(v)}</span> },
            { title: "원가율", dataIndex: "cost_rate", align: "right", render: (v: number | null) => <Tag color={v == null ? undefined : v > 0.85 ? "red" : v > 0.75 ? "orange" : "green"}>{pct(v)}</Tag> },
            { title: "이익", dataIndex: "profit", align: "right", render: won },
          ]} />
      </Card>
    </Space>
  );
}

interface Item { code: string; name: string; length_mm: number; width_mm: number; height_mm: number; board_spec_code: string; print_colors: number; unit_price: number }
interface Spec { code: string; flute: string }
interface Quote {
  blank_w: number; blank_l: number; area_m2: number; paper_kg: number; rows: { label: string; amount: number }[];
  total_cost: number; unit_cost: number; margin: number; suggested_price: number | null;
}

/** 원가분석 → 견적원가 계산기: 규격·원단·도수·수량으로 원가와 제안 단가를 즉시 계산. */
export function QuoteCalculator() {
  const [form] = Form.useForm();
  const [items, setItems] = useState<Item[]>([]);
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [q, setQ] = useState<Quote>();
  const [ref, setRef] = useState<Item>();
  const [err, setErr] = useState<string>();

  useEffect(() => {
    void api<Item[]>("/api/master/items").then(setItems);
    void api<Spec[]>("/api/master/board-specs").then((s) => {
      setSpecs(s);
      form.setFieldsValue({ length_mm: 400, width_mm: 300, height_mm: 250, board_spec_code: s[0]?.code, print_colors: 2, qty: 5000, margin: 15 });
      calc();
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const calc = async () => {
    const v = form.getFieldsValue();
    if (!v.board_spec_code) return;
    try {
      setQ(await post<Quote>("/api/cost/quote", { ...v, margin: (v.margin ?? 15) / 100 }));
      setErr(undefined);
    } catch (e) { setErr(String(e)); }
  };
  const pick = (code: string) => {
    const it = items.find((i) => i.code === code);
    setRef(it);
    if (it) {
      form.setFieldsValue({ length_mm: it.length_mm, width_mm: it.width_mm, height_mm: it.height_mm, board_spec_code: it.board_spec_code, print_colors: it.print_colors });
      void calc();
    }
  };

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={10}>
        <Card title="견적 조건">
          <Form form={form} layout="vertical" onValuesChange={() => void calc()}>
            <Form.Item label="기존 품목에서 불러오기 (선택)">
              <Select allowClear showSearch placeholder="품목 선택" optionFilterProp="label" onChange={pick}
                options={items.map((i) => ({ value: i.code, label: `${i.code} ${i.name}` }))} />
            </Form.Item>
            <Row gutter={8}>
              <Col span={8}><Form.Item name="length_mm" label="장 (mm)"><InputNumber min={50} max={2000} style={{ width: "100%" }} /></Form.Item></Col>
              <Col span={8}><Form.Item name="width_mm" label="폭 (mm)"><InputNumber min={50} max={2000} style={{ width: "100%" }} /></Form.Item></Col>
              <Col span={8}><Form.Item name="height_mm" label="고 (mm)"><InputNumber min={30} max={2000} style={{ width: "100%" }} /></Form.Item></Col>
            </Row>
            <Row gutter={8}>
              <Col span={12}><Form.Item name="board_spec_code" label="원단 규격"><Select options={specs.map((s) => ({ value: s.code, label: `${s.code} (${s.flute}골)` }))} /></Form.Item></Col>
              <Col span={12}><Form.Item name="print_colors" label="인쇄 도수"><Select options={[0, 1, 2, 3, 4].map((n) => ({ value: n, label: n ? `${n}도` : "무인쇄" }))} /></Form.Item></Col>
            </Row>
            <Form.Item name="qty" label="수량 (매)"><InputNumber min={100} max={500000} step={1000} style={{ width: "100%" }} /></Form.Item>
            <Form.Item name="margin" label="목표 이익률 (%)"><Slider min={0} max={40} marks={{ 0: "0", 15: "15", 30: "30", 40: "40" }} /></Form.Item>
          </Form>
          <Button onClick={() => void calc()}>다시 계산</Button>
        </Card>
      </Col>
      <Col xs={24} lg={14}>
        {err && <Alert type="error" message={err} style={{ marginBottom: 12 }} />}
        {q && (
          <Card title="견적 원가">
            <Row gutter={16}>
              <Col span={8}><Statistic title="매당 원가" value={q.unit_cost} precision={1} suffix="원" /></Col>
              <Col span={8}><Statistic title={`제안 단가 (이익률 ${Math.round(q.margin * 100)}%)`} value={q.suggested_price ?? 0} suffix="원" valueStyle={{ color: "#1d4ed8" }} /></Col>
              <Col span={8}><Statistic title="총 원가" value={q.total_cost} suffix="원" /></Col>
            </Row>
            {ref && q.suggested_price && (
              <Alert style={{ marginTop: 12 }} type={ref.unit_price >= q.unit_cost / (1 - q.margin) ? "success" : "warning"} showIcon
                message={`현재 ${ref.name} 판매 단가 ${ref.unit_price.toLocaleString()}원 → 원가율 ${((q.unit_cost / ref.unit_price) * 100).toFixed(1)}%`} />
            )}
            <Table style={{ marginTop: 16 }} size="small" pagination={false} rowKey="label" dataSource={q.rows}
              columns={[
                { title: "항목", dataIndex: "label" },
                { title: "금액", dataIndex: "amount", align: "right", render: won },
                { title: "매당", dataIndex: "amount", align: "right", render: (v: number) => `${(v / (form.getFieldValue("qty") || 1)).toFixed(1)}원` },
                { title: "비중", dataIndex: "amount", align: "right", render: (v: number) => `${((v / q.total_cost) * 100).toFixed(1)}%` },
              ]} />
            <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
              전개 크기 {q.blank_w} × {q.blank_l}mm ({q.area_m2}m²/매), 원지 소요 {num(q.paper_kg)}kg. 재료비는 원지 단가와 표준 손실률 3%, 가공비는 설비 능력과 분당 가공비, 운반비는 표준 운임 기준입니다.
            </Typography.Paragraph>
          </Card>
        )}
      </Col>
    </Row>
  );
}
