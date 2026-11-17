import { Alert, Button, Card, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Steps, Table, Tag, Typography, message } from "antd";
import { useState } from "react";
import { post } from "../../api/client";
import { KpiRow, pct, useApi } from "../../components/common";
import { dt, num, won } from "../../status";

interface Cust {
  code: string; name: string; biz_no: string; industry: string; region: string; orders: number; open_orders: number;
  order_amount: number; last_order: string | null; sales_ytd: number; receivable: number; open_claims: number;
}

/** 영업관리 → 거래처관리: 고객별 수주·매출·미수·크레임. */
export function Customers() {
  const [rows = []] = useApi<Cust[]>("/api/sales/customers", ["sales_order", "invoice", "receipt", "claim"]);
  const ytd = rows.reduce((a, r) => a + r.sales_ytd, 0);
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <KpiRow items={[
        { title: "거래 고객", value: rows.length },
        { title: "올해 누적 매출", value: won(ytd) },
        { title: "총 미수금", value: won(rows.reduce((a, r) => a + r.receivable, 0)) },
        { title: "미결 크레임", value: rows.reduce((a, r) => a + r.open_claims, 0), suffix: "건" },
      ]} />
      <Card>
        <Table rowKey="code" dataSource={rows} size="middle" pagination={false} scroll={{ x: true }}
          columns={[
            { title: "코드", dataIndex: "code" },
            { title: "거래처", dataIndex: "name", render: (v: string, r) => <span><b>{v}</b><br /><small style={{ color: "#64748b" }}>{r.industry} · {r.region}</small></span> },
            { title: "사업자번호", dataIndex: "biz_no" },
            { title: "올해 매출", dataIndex: "sales_ytd", align: "right", render: won, sorter: (a, b) => a.sales_ytd - b.sales_ytd, defaultSortOrder: "descend" },
            { title: "매출 비중", key: "share", align: "right", render: (_, r) => pct(ytd ? r.sales_ytd / ytd : 0) },
            { title: "데모 수주", dataIndex: "orders", align: "right", render: (v: number, r) => `${v}건 (진행 ${r.open_orders})` },
            { title: "최근 수주", dataIndex: "last_order", render: (v: string | null) => v ?? "-" },
            { title: "미수금", dataIndex: "receivable", align: "right", render: won },
            { title: "크레임", dataIndex: "open_claims", render: (v: number) => (v ? <Tag color="red">미결 {v}</Tag> : <Tag>없음</Tag>) },
          ]} />
      </Card>
    </Space>
  );
}

interface Alloc {
  free_stock: { item_code: string; item_name: string; qty: number }[];
  candidates: { order_no: string; customer_name: string; due_date: string; coverable: boolean; cover_rate: number; lines: { item_code: string; item_name: string; qty: number; free: number }[] }[];
  history: { order_no: string; item_code: string; item_name: string; qty: number; created_at: string }[];
}

/** 영업관리 → 수주전용: 여유 제품재고를 새 수주에 돌려 생산 없이 바로 출하. */
export function Allocation() {
  const [data, load] = useApi<Alloc>("/api/sales/allocation", ["sales_order", "stock", "shipment"]);
  const [busy, setBusy] = useState<string>();
  const run = async (order_no: string) => {
    setBusy(order_no);
    try {
      await post("/api/sales/allocation", { order_no });
      message.success(`${order_no} 재고 전용 → 생산완료, 바로 출하요청할 수 있습니다`);
      load();
    } catch (e) { message.error(String(e)); }
    setBusy(undefined);
  };
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Alert type="info" showIcon message="여유재고 = 제품 재고 − 출하 대기 수주에 묶인 수량. 접수된 수주를 여유재고로 모두 채울 수 있으면 생산 없이 '생산완료'로 넘겨 바로 출하합니다." />
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <Card title="여유 제품재고" size="small">
            <Table rowKey="item_code" dataSource={data?.free_stock ?? []} size="small" pagination={{ pageSize: 10 }}
              columns={[{ title: "품목", dataIndex: "item_name" }, { title: "여유(매)", dataIndex: "qty", align: "right", render: num }]} />
          </Card>
        </Col>
        <Col xs={24} lg={16}>
          <Card title="전용 가능 수주 (수주접수 상태)" size="small">
            <Table rowKey="order_no" dataSource={data?.candidates ?? []} size="small" pagination={false} scroll={{ x: true }}
              locale={{ emptyText: "접수 상태인 수주가 없습니다. 시뮬레이터에서 주문을 보내 보세요" }}
              columns={[
                { title: "수주번호", dataIndex: "order_no" },
                { title: "거래처", dataIndex: "customer_name" },
                { title: "납기", dataIndex: "due_date" },
                { title: "품목 / 필요·여유", dataIndex: "lines", render: (ls: Alloc["candidates"][0]["lines"]) => ls.map((l) => (
                  <div key={l.item_code} style={{ color: l.free >= l.qty ? undefined : "#94a3b8" }}>{l.item_name} {num(l.qty)} / {num(l.free)}</div>)) },
                { title: "충족률", dataIndex: "cover_rate", render: (v: number) => pct(v, 0) },
                { title: "", key: "a", render: (_, r) => <Button type="primary" size="small" disabled={!r.coverable} loading={busy === r.order_no} onClick={() => run(r.order_no)}>재고 전용</Button> },
              ]} />
          </Card>
        </Col>
      </Row>
      <Card title="전용 이력" size="small">
        <Table rowKey={(r) => `${r.order_no}-${r.item_code}-${r.created_at}`} dataSource={data?.history ?? []} size="small" pagination={{ pageSize: 10 }}
          columns={[{ title: "일시", dataIndex: "created_at", render: dt }, { title: "수주번호", dataIndex: "order_no" }, { title: "품목", dataIndex: "item_name" }, { title: "수량", dataIndex: "qty", align: "right", render: num }]} />
      </Card>
    </Space>
  );
}

interface Ledger { shipment_no: string; order_no: string; customer_name: string; qty: number; supply_amount: number; shipped_at: string | null; ship_status: string; invoice_no: string | null; invoice_status: string | null; stage: string }
const STAGES = ["출하 진행", "출하 완료", "마감 요청", "계산서 발행"];

/** 영업관리 → 판매관리: 출하 → 마감 → 계산서까지 판매 건별 진행. */
export function SalesLedger() {
  const [rows = []] = useApi<Ledger[]>("/api/sales/ledger", ["shipment", "invoice", "sales_order"]);
  const sum = (s: string) => rows.filter((r) => r.stage === s).reduce((a, r) => a + r.supply_amount, 0);
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <KpiRow items={STAGES.map((s) => ({ title: s, value: won(sum(s)), hint: `${rows.filter((r) => r.stage === s).length}건` }))} />
      <Card title="판매 원장">
        <Table rowKey="shipment_no" dataSource={rows} size="middle" pagination={{ pageSize: 15 }} scroll={{ x: true }}
          locale={{ emptyText: "출하 내역이 생기면 판매 원장에 쌓입니다" }}
          columns={[
            { title: "출하번호", dataIndex: "shipment_no" },
            { title: "수주번호", dataIndex: "order_no" },
            { title: "거래처", dataIndex: "customer_name" },
            { title: "수량", dataIndex: "qty", align: "right", render: num },
            { title: "공급가액", dataIndex: "supply_amount", align: "right", render: won },
            { title: "출하", dataIndex: "shipped_at", render: dt },
            { title: "진행", dataIndex: "stage", width: 300, render: (s: string) => (
              <Steps size="small" current={STAGES.indexOf(s)} status={s === "계산서 발행" ? "finish" : "process"} items={[{ title: "출하" }, { title: "완료" }, { title: "마감" }, { title: "계산서" }]} />) },
            { title: "세금계산서", dataIndex: "invoice_no", render: (v: string | null) => v ?? "-" },
          ]} />
      </Card>
    </Space>
  );
}

interface ArCust { customer_code: string; customer_name: string; opening: number; opening_left: number; invoiced: number; received: number; balance: number; invoices: { invoice_no: string; issued_at: string; total: number; paid: number; left: number }[] }
interface Rcpt { receipt_no: string; customer_name: string; invoice_no: string | null; amount: number; method: string; received_at: string }

/** 영업관리 → 수금관리: 기초 미수 + 발행 세금계산서 − 수금. */
export function Receivables() {
  const [data, load] = useApi<{ customers: ArCust[]; receipts: Rcpt[] }>("/api/sales/receivables", ["invoice", "receipt"]);
  const [target, setTarget] = useState<{ c: ArCust; invoice_no: string | null; left: number }>();
  const [form] = Form.useForm();
  const cs = data?.customers ?? [];
  const submit = async (v: { amount: number; method: string }) => {
    if (!target) return;
    try {
      await post("/api/sales/receipts", { customer_code: target.c.customer_code, invoice_no: target.invoice_no, ...v });
      message.success("수금 등록");
      setTarget(undefined); load();
    } catch (e) { message.error(String(e)); }
  };
  const openModal = (c: ArCust, invoice_no: string | null, left: number) => {
    setTarget({ c, invoice_no, left });
    form.setFieldsValue({ amount: Math.round(left), method: "계좌이체" });
  };
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <KpiRow items={[
        { title: "총 미수금", value: won(cs.reduce((a, c) => a + c.balance, 0)) },
        { title: "기초 미수", value: won(cs.reduce((a, c) => a + c.opening, 0)) },
        { title: "당기 발행(부가세 포함)", value: won(cs.reduce((a, c) => a + c.invoiced, 0)) },
        { title: "수금 합계", value: won(cs.reduce((a, c) => a + c.received, 0)), color: "#16a34a" },
      ]} />
      <Card title="거래처별 미수" extra={<Typography.Text type="secondary">행을 펼치면 세금계산서별 잔액과 수금 버튼이 나옵니다</Typography.Text>}>
        <Table rowKey="customer_code" dataSource={cs} size="middle" pagination={false} scroll={{ x: true }}
          expandable={{ expandedRowRender: (c) => (
            <Table rowKey="invoice_no" size="small" pagination={false}
              dataSource={[{ invoice_no: "기초 미수", issued_at: "", total: c.opening, paid: c.opening - c.opening_left, left: c.opening_left }, ...c.invoices]}
              columns={[
                { title: "세금계산서", dataIndex: "invoice_no" },
                { title: "발행", dataIndex: "issued_at", render: (v: string) => (v ? dt(v) : "-") },
                { title: "청구액", dataIndex: "total", align: "right", render: won },
                { title: "수금", dataIndex: "paid", align: "right", render: won },
                { title: "잔액", dataIndex: "left", align: "right", render: (v: number) => <b>{won(v)}</b> },
                { title: "", key: "a", render: (_, i) => i.left > 0 ? <Button size="small" onClick={() => openModal(c, i.invoice_no === "기초 미수" ? null : i.invoice_no, i.left)}>수금 등록</Button> : <Tag color="green">완납</Tag> },
              ]} />
          ) }}
          columns={[
            { title: "거래처", dataIndex: "customer_name" },
            { title: "기초 미수", dataIndex: "opening", align: "right", render: won },
            { title: "당기 발행", dataIndex: "invoiced", align: "right", render: won },
            { title: "수금", dataIndex: "received", align: "right", render: won },
            { title: "미수 잔액", dataIndex: "balance", align: "right", render: (v: number) => <b>{won(v)}</b>, sorter: (a, b) => a.balance - b.balance },
          ]} />
      </Card>
      <Card title="수금 내역" size="small">
        <Table rowKey="receipt_no" dataSource={data?.receipts ?? []} size="small" pagination={{ pageSize: 10 }}
          locale={{ emptyText: "수금 내역이 없습니다" }}
          columns={[
            { title: "일시", dataIndex: "received_at", render: dt }, { title: "번호", dataIndex: "receipt_no" },
            { title: "거래처", dataIndex: "customer_name" }, { title: "세금계산서", dataIndex: "invoice_no", render: (v: string | null) => v ?? "기초 미수" },
            { title: "방법", dataIndex: "method" }, { title: "금액", dataIndex: "amount", align: "right", render: won },
          ]} />
      </Card>
      <Modal title={`수금 등록 · ${target?.c.customer_name ?? ""}`} open={!!target} onCancel={() => setTarget(undefined)} onOk={() => form.submit()} okText="등록">
        <Typography.Paragraph>{target?.invoice_no ?? "기초 미수"} · 잔액 {won(target?.left)}</Typography.Paragraph>
        <Form form={form} layout="vertical" onFinish={submit}>
          <Form.Item name="amount" label="수금액" rules={[{ required: true }]}><InputNumber min={1} max={target?.left} style={{ width: "100%" }} formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")} /></Form.Item>
          <Form.Item name="method" label="방법"><Select options={["계좌이체", "어음", "현금"].map((m) => ({ value: m, label: m }))} /></Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

interface ClaimRow { claim_no: string; customer_code: string; customer_name: string; order_no: string | null; item_name: string | null; claim_type: string; qty: number; amount: number; status: string; status_name: string; description: string; cause: string | null; action_text: string | null; created_at: string; closed_at: string | null }
const CLAIM_STEP: Record<string, number> = { RECEIVED: 0, INVESTIGATING: 1, CLOSED: 2 };

/** 영업관리 → 크레임 관리: 접수 → 원인 조사 → 대책·보상 후 종결. */
export function Claims() {
  const [rows = [], load] = useApi<ClaimRow[]>("/api/sales/claims", ["claim"]);
  const [custs = []] = useApi<{ code: string; name: string }[]>("/api/master/partners?partner_type=CUSTOMER");
  const [items = []] = useApi<{ code: string; name: string; customer_code: string }[]>("/api/master/items");
  const [types = []] = useApi<{ code: string; name: string }[]>("/api/master/codes/CLAIM_TYPE");
  const [newOpen, setNewOpen] = useState(false);
  const [step, setStep] = useState<ClaimRow>();
  const [f1] = Form.useForm();
  const [f2] = Form.useForm();
  const cust = Form.useWatch("customer_code", f1);
  const create = async (v: object) => {
    try { await post("/api/sales/claims", v); message.success("크레임 접수"); setNewOpen(false); f1.resetFields(); load(); }
    catch (e) { message.error(String(e)); }
  };
  const advance = async (v: object) => {
    if (!step) return;
    try { await post(`/api/sales/claims/${step.claim_no}/step`, v); message.success("처리 완료"); setStep(undefined); load(); }
    catch (e) { message.error(String(e)); }
  };
  const openStep = (r: ClaimRow) => {
    setStep(r);
    f2.setFieldsValue({ status: r.status === "RECEIVED" ? "INVESTIGATING" : "CLOSED", cause: r.cause, action_text: r.action_text, amount: r.amount });
  };
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <KpiRow items={[
        { title: "접수", value: rows.filter((r) => r.status === "RECEIVED").length, color: "#c2410c" },
        { title: "원인 조사", value: rows.filter((r) => r.status === "INVESTIGATING").length },
        { title: "종결", value: rows.filter((r) => r.status === "CLOSED").length, color: "#16a34a" },
        { title: "보상 금액", value: won(rows.reduce((a, r) => a + r.amount, 0)) },
      ]} />
      <Card title="크레임 목록" extra={<Button type="primary" onClick={() => setNewOpen(true)}>크레임 접수</Button>}>
        <Table rowKey="claim_no" dataSource={rows} size="middle" pagination={{ pageSize: 10 }} scroll={{ x: true }}
          expandable={{ expandedRowRender: (r) => (
            <Space direction="vertical"><span><b>내용</b> {r.description}</span><span><b>원인</b> {r.cause ?? "-"}</span><span><b>대책</b> {r.action_text ?? "-"}</span></Space>) }}
          columns={[
            { title: "번호", dataIndex: "claim_no" },
            { title: "접수일", dataIndex: "created_at", render: dt },
            { title: "거래처", dataIndex: "customer_name" },
            { title: "품목", dataIndex: "item_name", render: (v: string | null) => v ?? "-" },
            { title: "유형", dataIndex: "claim_type", render: (v: string) => <Tag>{v}</Tag> },
            { title: "수량", dataIndex: "qty", align: "right", render: num },
            { title: "진행", dataIndex: "status", width: 240, render: (s: string) => <Steps size="small" current={CLAIM_STEP[s]} status={s === "CLOSED" ? "finish" : "process"} items={[{ title: "접수" }, { title: "조사" }, { title: "종결" }]} /> },
            { title: "보상", dataIndex: "amount", align: "right", render: (v: number) => (v ? won(v) : "-") },
            { title: "", key: "a", render: (_, r) => r.status !== "CLOSED" && <Button size="small" onClick={() => openStep(r)}>{r.status === "RECEIVED" ? "조사 시작" : "종결"}</Button> },
          ]} />
      </Card>
      <Modal title="크레임 접수" open={newOpen} onCancel={() => setNewOpen(false)} onOk={() => f1.submit()} okText="접수">
        <Form form={f1} layout="vertical" onFinish={create}>
          <Form.Item name="customer_code" label="거래처" rules={[{ required: true }]}><Select options={custs.map((c) => ({ value: c.code, label: c.name }))} /></Form.Item>
          <Form.Item name="item_code" label="품목"><Select allowClear options={items.filter((i) => i.customer_code === cust).map((i) => ({ value: i.code, label: i.name }))} /></Form.Item>
          <Form.Item name="claim_type" label="유형" rules={[{ required: true }]}><Select options={types.map((t) => ({ value: t.name, label: t.name }))} /></Form.Item>
          <Form.Item name="qty" label="수량"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="description" label="내용" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>
      <Modal title={`크레임 처리 · ${step?.claim_no ?? ""}`} open={!!step} onCancel={() => setStep(undefined)} onOk={() => f2.submit()} okText="저장">
        <Form form={f2} layout="vertical" onFinish={advance}>
          <Form.Item name="status" label="단계"><Select options={[{ value: "INVESTIGATING", label: "원인 조사" }, { value: "CLOSED", label: "종결" }]} /></Form.Item>
          <Form.Item name="cause" label="원인"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="action_text" label="대책"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="amount" label="보상 금액"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
