import { Alert, Button, Card, Form, Input, InputNumber, Select, Space, Table, Tag, Typography, message } from "antd";
import { useMemo, useState } from "react";
import { post } from "../../api/client";
import { KpiRow, useApi } from "../../components/common";
import { dt, num } from "../../status";

export type Kind = "PAPER" | "PRODUCT" | "SUB";
const KIND_KO: Record<Kind, string> = { PAPER: "원지", PRODUCT: "제품", SUB: "부자재" };
const UNIT: Record<Kind, string> = { PAPER: "kg", PRODUCT: "매", SUB: "" };

interface Wh { code: string; name: string; site: string }
interface BalRow { item_code: string; item_name: string; by_wh: Record<string, number>; total: number; unit: string; safety: number | null; short: boolean }
interface Balances { warehouses: Wh[]; rows: BalRow[] }
interface Move {
  move_no: string; kind: Kind; move_type: string; move_type_name: string; item_code: string; item_name: string; qty: number;
  from_wh: string | null; to_wh: string | null; ref_no: string | null; reason: string | null; created_at: string;
}

const TYPE_COLOR: Record<string, string> = { IN: "green", OUT: "volcano", TRANSFER: "blue", ADJUST: "purple" };

function useBalances(kind: Kind) {
  return useApi<Balances>(`/api/inventory/balances?kind=${kind}`, ["stock", "purchase", "production", "shipment"]);
}

/** 창고별 재고: 원지 재고 / 제품 재고 / 부자재 재고 공통. */
export function StockBalances({ kind }: { kind: Kind }) {
  const [data] = useBalances(kind);
  const rows = data?.rows ?? [];
  const whs = data?.warehouses ?? [];
  const total = rows.reduce((a, r) => a + r.total, 0);
  const short = rows.filter((r) => r.short).length;
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <KpiRow items={[
        { title: `${KIND_KO[kind]} 품목 수`, value: rows.length },
        { title: "총 재고", value: num(total), suffix: UNIT[kind] || undefined },
        { title: "창고 수", value: whs.length, hint: whs.map((w) => w.name).join(", ") },
        { title: "안전재고 미달", value: short, color: short ? "#dc2626" : "#16a34a" },
      ]} />
      {short > 0 && <Alert type="warning" showIcon message={`안전재고 아래인 ${KIND_KO[kind]}가 ${short}건 있습니다. 스케쥴링 → 원지 자동발주에서 발주할 수 있습니다.`} />}
      <Card>
        <Table rowKey="item_code" dataSource={rows} size="middle" pagination={{ pageSize: 20 }} scroll={{ x: true }}
          columns={[
            { title: "코드", dataIndex: "item_code" },
            { title: "품명", dataIndex: "item_name" },
            ...whs.map((w) => ({ title: <span>{w.name}<br /><small style={{ color: "#94a3b8" }}>{w.site}</small></span>, key: w.code, align: "right" as const,
              render: (_: unknown, r: BalRow) => num(r.by_wh[w.code] ?? 0) })),
            { title: "합계", dataIndex: "total", align: "right", render: (v: number, r: BalRow) => <b>{num(v)} {r.unit}</b> },
            ...(kind !== "PRODUCT" ? [{ title: "안전재고", dataIndex: "safety", align: "right" as const, render: num },
              { title: "상태", key: "st", render: (_: unknown, r: BalRow) => r.short ? <Tag color="red">부족</Tag> : <Tag color="green">정상</Tag> }] : []),
          ]} />
      </Card>
    </Space>
  );
}

/** 입·출고 원장. */
export function StockMoves({ kind, types }: { kind: Kind; types?: string }) {
  const [rows = []] = useApi<Move[]>(`/api/inventory/moves?kind=${kind}${types ? `&move_type=${types}` : ""}`, ["stock", "shipment", "production", "purchase"]);
  const [type, setType] = useState<string>();
  const shown = type ? rows.filter((r) => r.move_type === type) : rows;
  const sum = (t: string) => rows.filter((r) => r.move_type === t).reduce((a, r) => a + r.qty, 0);
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {!types && <KpiRow items={[
        { title: "입고", value: num(sum("IN")), suffix: UNIT[kind] || undefined, color: "#16a34a" },
        { title: "출고", value: num(sum("OUT")), suffix: UNIT[kind] || undefined, color: "#c2410c" },
        { title: "이동", value: num(sum("TRANSFER")), suffix: UNIT[kind] || undefined },
        { title: "조정 건수", value: rows.filter((r) => r.move_type === "ADJUST").length },
      ]} />}
      <Card extra={!types && <Select allowClear placeholder="구분 전체" style={{ width: 140 }} value={type} onChange={setType}
        options={[["IN", "입고"], ["OUT", "출고"], ["TRANSFER", "이동"], ["ADJUST", "조정"]].map(([value, label]) => ({ value, label }))} />}
        title={types === "TRANSFER" ? `${KIND_KO[kind]} 이동 내역` : types === "ADJUST" ? `${KIND_KO[kind]} 조정 내역` : `${KIND_KO[kind]} 입·출고 원장`}>
        <Table rowKey="move_no" dataSource={shown} size="small" pagination={{ pageSize: 20 }} scroll={{ x: true }}
          locale={{ emptyText: "입출고 내역이 없습니다" }}
          columns={[
            { title: "일시", dataIndex: "created_at", render: dt },
            { title: "구분", dataIndex: "move_type_name", render: (v: string, r: Move) => <Tag color={TYPE_COLOR[r.move_type]}>{v}</Tag> },
            { title: "품목", dataIndex: "item_name" },
            { title: "수량", dataIndex: "qty", align: "right", render: (v: number) => num(v) },
            { title: "출발 창고", dataIndex: "from_wh", render: (v: string | null) => v ?? "-" },
            { title: "도착 창고", dataIndex: "to_wh", render: (v: string | null) => v ?? "-" },
            { title: "근거", dataIndex: "ref_no", render: (v: string | null) => v ?? "-" },
            { title: "사유", dataIndex: "reason" },
          ]} />
      </Card>
    </Space>
  );
}

/** 창고 이동(같은 사업장) / 사업장 이동(1공장 ↔ 2공장). */
export function StockTransfer({ kind, mode }: { kind: Kind; mode: "warehouse" | "site" }) {
  const [data] = useBalances(kind);
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const from = Form.useWatch("from_wh", form);
  const item = Form.useWatch("item_code", form);
  const whs = data?.warehouses ?? [];
  const fromWh = whs.find((w) => w.code === from);
  const toOptions = whs.filter((w) => w.code !== from && (!fromWh || (mode === "site" ? w.site !== fromWh.site : w.site === fromWh.site)));
  const avail = data?.rows.find((r) => r.item_code === item)?.by_wh[from] ?? 0;
  const items = useMemo(() => (data?.rows ?? []).filter((r) => !from || (r.by_wh[from] ?? 0) > 0), [data, from]);

  const submit = async (v: { item_code: string; from_wh: string; to_wh: string; qty: number; reason?: string }) => {
    setBusy(true);
    try {
      const r = await post<{ move_no: string; label: string }>("/api/inventory/transfer", { kind, ...v });
      message.success(`${r.label} 완료 (${r.move_no})`);
      form.resetFields(["qty", "reason"]);
    } catch (e) { message.error(String(e)); }
    setBusy(false);
  };
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title={`${KIND_KO[kind]} ${mode === "site" ? "사업장 이동 (1공장 ↔ 2공장)" : "창고 이동 (같은 사업장 안)"}`}>
        <Form form={form} layout="inline" onFinish={submit} style={{ rowGap: 12 }}>
          <Form.Item name="from_wh" label="보내는 창고" rules={[{ required: true }]}>
            <Select style={{ width: 200 }} options={whs.map((w) => ({ value: w.code, label: `${w.name}` }))} onChange={() => form.setFieldsValue({ to_wh: undefined, item_code: undefined })} />
          </Form.Item>
          <Form.Item name="item_code" label="품목" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" style={{ width: 240 }} options={items.map((r) => ({ value: r.item_code, label: `${r.item_name}` }))} />
          </Form.Item>
          <Form.Item name="to_wh" label="받는 창고" rules={[{ required: true }]}>
            <Select style={{ width: 200 }} options={toOptions.map((w) => ({ value: w.code, label: w.name }))}
              notFoundContent={mode === "warehouse" ? "같은 사업장에 다른 창고가 없습니다" : "보내는 창고를 먼저 고르세요"} />
          </Form.Item>
          <Form.Item name="qty" label={`수량${UNIT[kind] ? `(${UNIT[kind]})` : ""}`} rules={[{ required: true }]} extra={item && from ? `이동 가능 ${num(avail)}` : undefined}>
            <InputNumber min={1} max={avail || undefined} style={{ width: 140 }} />
          </Form.Item>
          <Form.Item name="reason" label="사유"><Input style={{ width: 200 }} placeholder="예: 2공장 생산 투입" /></Form.Item>
          <Form.Item><Button type="primary" htmlType="submit" loading={busy}>이동 등록</Button></Form.Item>
        </Form>
      </Card>
      <StockMoves kind={kind} types="TRANSFER" />
    </Space>
  );
}

/** 재고조정: 실사 수량 입력 → 장부와 차이만큼 조정. */
export function StockAdjust() {
  const [kind, setKind] = useState<Kind>("PRODUCT");
  const [data] = useBalances(kind);
  const [form] = Form.useForm();
  const item = Form.useWatch("item_code", form);
  const wh = Form.useWatch("warehouse_code", form);
  const book = data?.rows.find((r) => r.item_code === item)?.by_wh[wh] ?? 0;
  const submit = async (v: { item_code: string; warehouse_code: string; actual_qty: number; reason: string }) => {
    try {
      const r = await post<{ move_no: string; delta: number }>("/api/inventory/adjust", { kind, ...v });
      message.success(`조정 ${r.delta > 0 ? "+" : ""}${num(r.delta)} (${r.move_no})`);
      form.resetFields(["actual_qty"]);
    } catch (e) { message.error(String(e)); }
  };
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="재고 실사·조정" extra={<Select value={kind} style={{ width: 120 }} onChange={(k) => { setKind(k); form.resetFields(); }}
        options={(["PRODUCT", "PAPER", "SUB"] as Kind[]).map((k) => ({ value: k, label: KIND_KO[k] }))} />}>
        <Typography.Paragraph type="secondary">실사한 수량을 넣으면 장부와의 차이만큼 조정 전표가 만들어집니다.</Typography.Paragraph>
        <Form form={form} layout="inline" onFinish={submit} initialValues={{ reason: "월말 재고 실사" }} style={{ rowGap: 12 }}>
          <Form.Item name="warehouse_code" label="창고" rules={[{ required: true }]}>
            <Select style={{ width: 200 }} options={(data?.warehouses ?? []).map((w) => ({ value: w.code, label: w.name }))} />
          </Form.Item>
          <Form.Item name="item_code" label="품목" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" style={{ width: 260 }} options={(data?.rows ?? []).map((r) => ({ value: r.item_code, label: r.item_name }))} />
          </Form.Item>
          <Form.Item label="장부 수량"><b>{item && wh ? num(book) : "-"}</b></Form.Item>
          <Form.Item name="actual_qty" label="실사 수량" rules={[{ required: true }]}><InputNumber min={0} style={{ width: 140 }} /></Form.Item>
          <Form.Item name="reason" label="사유" rules={[{ required: true }]}><Input style={{ width: 180 }} /></Form.Item>
          <Form.Item><Button type="primary" htmlType="submit">조정 등록</Button></Form.Item>
        </Form>
      </Card>
      <StockMoves kind={kind} types="ADJUST" />
    </Space>
  );
}
