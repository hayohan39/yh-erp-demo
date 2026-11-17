import { Alert, Button, Card, Col, Popconfirm, Row, Space, Table, Typography, message } from "antd";
import { post } from "../../api/client";
import { KpiRow, ShareBars, pct, useApi } from "../../components/common";
import { num, won } from "../../status";

interface Std { code: string; name: string; customer_name: string; board_spec: string; print_colors: number; unit_price: number; std_cost: number; recalc: number; diff: number; margin: number | null; rows: { label: string; unit: number }[] }

/** 원가분석 → 표준원가: 품목별 매당 표준원가와 현재 기준으로 다시 계산한 값. */
export function StandardCost() {
  const [data, load] = useApi<{ lot: number; rows: Std[] }>("/api/cost/standard", ["master"]);
  const rows = data?.rows ?? [];
  const changed = rows.filter((r) => Math.abs(r.diff) >= 1);
  const recalc = async () => {
    const r = await post<{ changed: number }>("/api/cost/standard/recalc");
    message.success(`표준원가 ${r.changed}개 품목 갱신`);
    load();
  };
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <KpiRow items={[
        { title: "품목", value: rows.length },
        { title: "평균 표준원가율", value: pct(rows.reduce((a, r) => a + r.std_cost / r.unit_price, 0) / (rows.length || 1)) },
        { title: "재계산 차이 품목", value: changed.length, color: changed.length ? "#c2410c" : "#16a34a" },
        { title: "기준 로트", value: num(data?.lot), suffix: "매" },
      ]} />
      {changed.length > 0 && <Alert type="warning" showIcon message={`원지 단가·가공비 등 기준이 바뀌어 ${changed.length}개 품목의 표준원가가 달라졌습니다.`}
        action={<Popconfirm title="표준원가를 현재 기준으로 갱신할까요?" onConfirm={recalc}><Button size="small" type="primary">표준원가 갱신</Button></Popconfirm>} />}
      <Card title="품목별 표준원가 (매당)">
        <Table rowKey="code" dataSource={rows} size="small" pagination={{ pageSize: 15 }} scroll={{ x: true }}
          expandable={{ expandedRowRender: (r) => (
            <Space size={24} wrap>{r.rows.map((x) => <span key={x.label}>{x.label} <b>{x.unit.toLocaleString()}원</b></span>)}</Space>) }}
          columns={[
            { title: "품목", dataIndex: "name" }, { title: "거래처", dataIndex: "customer_name" }, { title: "원단", dataIndex: "board_spec" },
            { title: "도수", dataIndex: "print_colors", align: "right" },
            { title: "판매단가", dataIndex: "unit_price", align: "right", render: won },
            { title: "표준원가", dataIndex: "std_cost", align: "right", render: won },
            { title: "현재 기준 재계산", dataIndex: "recalc", align: "right", render: (v: number, r) => <span style={{ color: r.diff > 0 ? "#dc2626" : r.diff < 0 ? "#16a34a" : undefined }}>{won(v)}</span> },
            { title: "마진율", dataIndex: "margin", align: "right", render: (v: number | null) => pct(v), sorter: (a, b) => (a.margin ?? 0) - (b.margin ?? 0) },
          ]} />
      </Card>
    </Space>
  );
}

interface Pl { code: string; name: string; sales: number; cost: number; overhead: number; profit: number; margin: number | null; orders?: number; qty?: number }
interface Analysis { overhead_rate: number; total: Pl; customers: Pl[]; items: Pl[]; mix: { label: string; amount: number; share: number }[] }

/** 원가분석 → 원가분석: 거래처·품목별 손익(간접비 배부 후), 원가 구성. */
export function CostAnalysis() {
  const [a] = useApi<Analysis>("/api/cost/analysis", ["sales_order", "shipment", "invoice", "master"]);
  if (!a) return null;
  const cols = (first: string) => [
    { title: first, dataIndex: "name" },
    { title: "매출", dataIndex: "sales", align: "right" as const, render: won },
    { title: "제조원가", dataIndex: "cost", align: "right" as const, render: won },
    { title: "간접비", dataIndex: "overhead", align: "right" as const, render: won },
    { title: "이익", dataIndex: "profit", align: "right" as const, render: (v: number) => <span style={{ color: v < 0 ? "#dc2626" : undefined }}>{won(v)}</span> },
    { title: "이익률", dataIndex: "margin", align: "right" as const, render: (v: number | null) => <b style={{ color: (v ?? 0) < 0.05 ? "#dc2626" : "#16a34a" }}>{pct(v)}</b> },
  ];
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <KpiRow items={[
        { title: "분석 매출", value: won(a.total.sales) },
        { title: "제조원가", value: won(a.total.cost) },
        { title: `간접비 (${pct(a.overhead_rate, 0)})`, value: won(a.total.overhead) },
        { title: "영업이익률", value: pct(a.total.margin), color: (a.total.margin ?? 0) < 0.05 ? "#dc2626" : "#16a34a" },
      ]} />
      {!a.customers.length && <Alert type="info" showIcon message="생산이 끝난 수주부터 실제원가로 손익이 계산됩니다. 시연에서 수주 → 생산을 진행해 보세요." />}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card size="small" title="거래처별 손익"><Table rowKey="code" dataSource={a.customers} size="small" pagination={false} scroll={{ x: true }} columns={cols("거래처")} /></Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card size="small" title="원가 구성"><ShareBars rows={a.mix.map((m) => ({ name: m.label, value: m.amount, share: m.share }))} fmt={won} /></Card>
        </Col>
      </Row>
      <Card size="small" title="품목별 손익" extra={<Typography.Text type="secondary">이익률 낮은 순</Typography.Text>}>
        <Table rowKey="code" dataSource={a.items} size="small" pagination={{ pageSize: 10 }} scroll={{ x: true }} columns={cols("품목")} />
      </Card>
    </Space>
  );
}
