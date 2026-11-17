import { Alert, Button, Card, Col, DatePicker, Form, Input, InputNumber, Modal, Row, Select, Space, Table, Tag, Typography, message } from "antd";
import dayjs from "dayjs";
import { useState } from "react";
import { post } from "../../api/client";
import { KpiRow, UsageBar, day, kg, pct, useApi } from "../../components/common";
import { dt, num, won } from "../../status";

interface ReqPlan { plan_no: string; created_at: string; status: string; total_kg: number; used_kg: number; lines: { paper_code: string; paper_name: string; kg: number; used_kg: number }[] }

/** 자재관리 → 원지 소요관리: 스케쥴 확정 때 PMS로 보낸 골게터 소요량 vs 실제 투입. */
export function PaperRequirements() {
  const [rows = []] = useApi<ReqPlan[]>("/api/material/requirements", ["work_order", "production", "stock"]);
  const total = rows.reduce((a, r) => a + r.total_kg, 0);
  const used = rows.reduce((a, r) => a + r.used_kg, 0);
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <KpiRow items={[
        { title: "확정 스케쥴", value: rows.length },
        { title: "원지 소요량", value: num(total), suffix: "kg" },
        { title: "투입 실적(PMS)", value: num(used), suffix: "kg" },
        { title: "투입 진행률", value: total ? pct(used / total) : "-" },
      ]} />
      <Card title="스케쥴별 원지 소요" extra={<Typography.Text type="secondary">스케쥴 확정 → IF-PMS-02 소요량 송신, 골게터 투입 → IF-PMS-01</Typography.Text>}>
        <Table rowKey="plan_no" dataSource={rows} size="middle" pagination={{ pageSize: 10 }} scroll={{ x: true }}
          locale={{ emptyText: "스케쥴을 확정하면 원지 소요량이 계산됩니다" }}
          expandable={{ expandedRowRender: (r) => (
            <Table rowKey="paper_code" dataSource={r.lines} size="small" pagination={false} columns={[
              { title: "원지", dataIndex: "paper_name" },
              { title: "소요량", dataIndex: "kg", align: "right", render: kg },
              { title: "투입", dataIndex: "used_kg", align: "right", render: kg },
              { title: "진행", key: "p", render: (_, l) => <UsageBar value={l.kg ? l.used_kg / l.kg : 0} warn={2} /> },
            ]} />
          ) }}
          columns={[
            { title: "스케쥴", dataIndex: "plan_no" },
            { title: "확정 일시", dataIndex: "created_at", render: dt },
            { title: "원지 종류", key: "n", render: (_, r) => `${r.lines.length}종` },
            { title: "소요량", dataIndex: "total_kg", align: "right", render: kg },
            { title: "투입", dataIndex: "used_kg", align: "right", render: kg },
            { title: "상태", dataIndex: "status", render: (s: string) => <Tag color={s === "투입완료" ? "green" : "blue"}>{s}</Tag> },
          ]} />
      </Card>
    </Space>
  );
}

interface Rec {
  kind: string; item_code: string; item_name: string; unit: string; stock: number; open_po: number; requirement: number;
  available: number; safety: number; lot: number | null; recommend: number; supplier_name: string; lead_days: number; unit_price: number;
}

/** 스케쥴링 → 원지 자동발주: 가용재고가 안전재고 아래면 발주 단위로 올려 추천, 한 번에 발주. */
export function AutoOrder() {
  const [rows = [], load] = useApi<Rec[]>("/api/material/auto-order", ["purchase", "stock", "work_order"]);
  const [busy, setBusy] = useState(false);
  const need = rows.filter((r) => r.recommend > 0);
  const run = async () => {
    setBusy(true);
    try {
      const r = await post<{ purchase_orders: string[] }>("/api/material/auto-order");
      message.success(`발주 ${r.purchase_orders.length}건 생성 (자재관리 → 발주관리에서 입고 처리)`);
      load();
    } catch (e) { message.error(String(e)); }
    setBusy(false);
  };
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Alert type="info" showIcon message="가용재고 = 현재고 + 발주잔 − 미투입 소요량. 가용재고가 안전재고보다 적으면 원지는 10톤 단위, 부자재는 안전재고 2배까지 발주를 추천합니다." />
      <Card title={`발주 추천 ${need.length}건`} extra={<Button type="primary" disabled={!need.length} loading={busy} onClick={run}>추천대로 자동발주</Button>}>
        <Table rowKey={(r) => `${r.kind}-${r.item_code}`} dataSource={rows} size="middle" pagination={false} scroll={{ x: true }}
          columns={[
            { title: "구분", dataIndex: "kind", render: (k: string) => <Tag>{k === "PAPER" ? "원지" : "부자재"}</Tag> },
            { title: "품목", dataIndex: "item_name" },
            { title: "현재고", dataIndex: "stock", align: "right", render: (v: number, r) => `${num(v)} ${r.unit}` },
            { title: "발주잔", dataIndex: "open_po", align: "right", render: num },
            { title: "미투입 소요", dataIndex: "requirement", align: "right", render: num },
            { title: "가용재고", dataIndex: "available", align: "right", render: (v: number, r) => <b style={{ color: v < r.safety ? "#dc2626" : undefined }}>{num(v)}</b> },
            { title: "안전재고", dataIndex: "safety", align: "right", render: num },
            { title: "추천 발주량", dataIndex: "recommend", align: "right", render: (v: number, r) => v ? <Tag color="orange">{num(v)} {r.unit}</Tag> : "-" },
            { title: "예상 금액", key: "amt", align: "right", render: (_, r) => r.recommend ? won(r.recommend * r.unit_price) : "-" },
            { title: "공급사", dataIndex: "supplier_name" },
            { title: "리드타임", dataIndex: "lead_days", render: (v: number) => `${v}일` },
          ]} />
      </Card>
    </Space>
  );
}

interface Po {
  po_no: string; kind: string; item_code: string; item_name: string; supplier_name: string; qty: number; unit: string; unit_price: number;
  amount: number; warehouse_name: string; status: string; auto: number; due_date: string; ordered_at: string; received_at: string | null;
}

/** 자재관리 → 발주관리: 수동 발주 + 자동발주 결과, 입고 처리. */
export function PurchaseOrders() {
  const [rows = [], load] = useApi<Po[]>("/api/material/purchase-orders", ["purchase"]);
  const [papers = []] = useApi<{ code: string; name: string }[]>("/api/master/paper-grades");
  const [subs = []] = useApi<{ code: string; name: string; unit: string }[]>("/api/master/sub-materials");
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const kind = Form.useWatch("kind", form);
  const receive = async (po: Po) => {
    try {
      await post(`/api/material/purchase-orders/${po.po_no}/receive`);
      message.success(`${po.po_no} 입고 완료${po.kind === "PAPER" ? " → PMS에 원지입고 전송" : ""}`);
      load();
    } catch (e) { message.error(String(e)); }
  };
  const create = async (v: { kind: string; item_code: string; qty: number }) => {
    try {
      const r = await post<{ po_no: string }>("/api/material/purchase-orders", v);
      message.success(`${r.po_no} 발주`);
      setOpen(false); form.resetFields(); load();
    } catch (e) { message.error(String(e)); }
  };
  const openCnt = rows.filter((r) => r.status === "ORDERED").length;
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <KpiRow items={[
        { title: "발주잔(미입고)", value: openCnt, color: openCnt ? "#c2410c" : undefined },
        { title: "발주잔 금액", value: won(rows.filter((r) => r.status === "ORDERED").reduce((a, r) => a + r.amount, 0)) },
        { title: "자동발주", value: rows.filter((r) => r.auto).length, suffix: "건" },
        { title: "입고 완료", value: rows.filter((r) => r.status === "RECEIVED").length, suffix: "건" },
      ]} />
      <Card title="발주 목록" extra={<Button type="primary" onClick={() => setOpen(true)}>발주 등록</Button>}>
        <Table rowKey="po_no" dataSource={rows} size="middle" pagination={{ pageSize: 15 }} scroll={{ x: true }}
          locale={{ emptyText: "발주가 없습니다. 스케쥴링 → 원지 자동발주를 눌러 보세요" }}
          columns={[
            { title: "발주번호", dataIndex: "po_no", render: (v: string, r) => <span>{v} {r.auto ? <Tag color="geekblue">자동</Tag> : null}</span> },
            { title: "구분", dataIndex: "kind", render: (k: string) => (k === "PAPER" ? "원지" : "부자재") },
            { title: "품목", dataIndex: "item_name" },
            { title: "공급사", dataIndex: "supplier_name" },
            { title: "수량", dataIndex: "qty", align: "right", render: (v: number, r) => `${num(v)} ${r.unit}` },
            { title: "금액", dataIndex: "amount", align: "right", render: won },
            { title: "입고 창고", dataIndex: "warehouse_name" },
            { title: "납기", dataIndex: "due_date" },
            { title: "상태", dataIndex: "status", render: (s: string, r) => s === "RECEIVED" ? <Tag color="green">입고 {dt(r.received_at)}</Tag>
              : <Button size="small" type="primary" ghost onClick={() => receive(r)}>입고 처리</Button> },
          ]} />
      </Card>
      <Modal title="발주 등록" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} okText="발주">
        <Form form={form} layout="vertical" onFinish={create} initialValues={{ kind: "PAPER" }}>
          <Form.Item name="kind" label="구분"><Select options={[{ value: "PAPER", label: "원지" }, { value: "SUB", label: "부자재" }]} onChange={() => form.setFieldValue("item_code", undefined)} /></Form.Item>
          <Form.Item name="item_code" label="품목" rules={[{ required: true }]}>
            <Select options={(kind === "SUB" ? subs : papers).map((p) => ({ value: p.code, label: p.name }))} />
          </Form.Item>
          <Form.Item name="qty" label={kind === "SUB" ? "수량" : "수량(kg)"} rules={[{ required: true }]}><InputNumber min={1} style={{ width: "100%" }} /></Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

/** 자재관리 → 구매관리: 입고 완료된 발주 = 매입 확정, 공급사별 합계. */
export function Purchases() {
  const [data] = useApi<{ rows: Po[]; by_supplier: { supplier_name: string; count: number; amount: number; vat: number }[] }>("/api/material/purchases", ["purchase"]);
  const rows = data?.rows ?? [];
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={9}>
          <Card title="공급사별 매입" size="small">
            <Table rowKey="supplier_name" dataSource={data?.by_supplier ?? []} size="small" pagination={false}
              locale={{ emptyText: "입고된 발주가 없습니다" }}
              columns={[
                { title: "공급사", dataIndex: "supplier_name" },
                { title: "건수", dataIndex: "count", align: "right" },
                { title: "공급가액", dataIndex: "amount", align: "right", render: won },
                { title: "부가세", dataIndex: "vat", align: "right", render: won },
              ]} />
          </Card>
        </Col>
        <Col xs={24} lg={15}>
          <Card title="매입 내역" size="small">
            <Table rowKey="po_no" dataSource={rows} size="small" pagination={{ pageSize: 10 }} scroll={{ x: true }}
              columns={[
                { title: "입고일", dataIndex: "received_at", render: dt },
                { title: "발주번호", dataIndex: "po_no" },
                { title: "품목", dataIndex: "item_name" },
                { title: "공급사", dataIndex: "supplier_name" },
                { title: "수량", dataIndex: "qty", align: "right", render: (v: number, r: Po) => `${num(v)} ${r.unit}` },
                { title: "단가", dataIndex: "unit_price", align: "right", render: (v: number) => num(v) },
                { title: "금액", dataIndex: "amount", align: "right", render: won },
              ]} />
          </Card>
        </Col>
      </Row>
    </Space>
  );
}

interface Sub { code: string; name: string; unit: string; unit_price: number; safety_qty: number; usage_per_k: number; process_name: string; supplier_name: string; stock: number; used_30d: number; short: boolean }

/** 자재관리 → 부자재 관리: 전분·잉크·밴드 등. 생산 완료 시 공정별 사용 기준으로 자동 차감. */
export function SubMaterials() {
  const [rows = []] = useApi<Sub[]>("/api/material/sub-materials", ["stock", "production", "purchase"]);
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <KpiRow items={[
        { title: "부자재 품목", value: rows.length },
        { title: "재고 금액", value: won(rows.reduce((a, r) => a + r.stock * r.unit_price, 0)) },
        { title: "30일 사용 금액", value: won(rows.reduce((a, r) => a + r.used_30d * r.unit_price, 0)) },
        { title: "안전재고 미달", value: rows.filter((r) => r.short).length, color: rows.some((r) => r.short) ? "#dc2626" : "#16a34a" },
      ]} />
      <Card title="부자재 현황" extra={<Typography.Text type="secondary">생산 완료 시 1천 매당 사용량만큼 자동 출고</Typography.Text>}>
        <Table rowKey="code" dataSource={rows} size="middle" pagination={false} scroll={{ x: true }}
          columns={[
            { title: "코드", dataIndex: "code" },
            { title: "부자재", dataIndex: "name" },
            { title: "사용 공정", dataIndex: "process_name" },
            { title: "1천 매당", dataIndex: "usage_per_k", align: "right", render: (v: number, r) => `${v} ${r.unit}` },
            { title: "현재고", dataIndex: "stock", align: "right", render: (v: number, r) => `${num(v)} ${r.unit}` },
            { title: "안전재고", dataIndex: "safety_qty", align: "right", render: (v: number, r) => `${num(v)} ${r.unit}` },
            { title: "30일 사용", dataIndex: "used_30d", align: "right", render: (v: number, r) => `${num(v)} ${r.unit}` },
            { title: "단가", dataIndex: "unit_price", align: "right", render: won },
            { title: "공급사", dataIndex: "supplier_name" },
            { title: "상태", dataIndex: "short", render: (s: boolean) => s ? <Tag color="red">부족</Tag> : <Tag color="green">정상</Tag> },
          ]} />
      </Card>
    </Space>
  );
}

interface Exp { exp_no: string; exp_date: string; category: string; dept: string; amount: number; memo: string | null }

/** 자재관리 → 경비관리. */
export function Expenses() {
  const [data, load] = useApi<{ rows: Exp[]; by_month: Record<string, number | string>[] }>("/api/material/expenses");
  const [codes = []] = useApi<{ code: string; name: string }[]>("/api/master/codes/EXPENSE_CAT");
  const [form] = Form.useForm();
  const months = data?.by_month ?? [];
  const cats = codes.map((c) => c.name);
  const add = async (v: { exp_date: dayjs.Dayjs; category: string; dept: string; amount: number; memo?: string }) => {
    try {
      await post("/api/material/expenses", { ...v, exp_date: v.exp_date.format("YYYY-MM-DD") });
      message.success("경비 등록");
      form.resetFields(["amount", "memo"]);
      load();
    } catch (e) { message.error(String(e)); }
  };
  const last = months[months.length - 1];
  const prev = months[months.length - 2];
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <KpiRow items={[
        { title: "이번 달 경비", value: won(Number(last?.total ?? 0)) },
        { title: "지난달 경비", value: won(Number(prev?.total ?? 0)) },
        { title: "6개월 평균", value: won(months.reduce((a, m) => a + Number(m.total), 0) / (months.length || 1)) },
        { title: "등록 건수", value: data?.rows.length ?? 0 },
      ]} />
      <Card title="월별 경비" size="small">
        <Table rowKey="ym" dataSource={months} size="small" pagination={false} scroll={{ x: true }}
          columns={[{ title: "월", dataIndex: "ym" }, ...cats.map((c) => ({ title: c, dataIndex: c, align: "right" as const, render: (v: number) => (v ? num(v) : "-") })),
            { title: "합계", dataIndex: "total", align: "right" as const, render: (v: number) => <b>{num(v)}</b> }]} />
      </Card>
      <Card title="경비 등록" size="small">
        <Form form={form} layout="inline" onFinish={add} initialValues={{ exp_date: dayjs(), dept: "관리팀" }} style={{ rowGap: 12 }}>
          <Form.Item name="exp_date" label="일자" rules={[{ required: true }]}><DatePicker /></Form.Item>
          <Form.Item name="category" label="항목" rules={[{ required: true }]}><Select style={{ width: 150 }} options={cats.map((c) => ({ value: c, label: c }))} /></Form.Item>
          <Form.Item name="dept" label="부서" rules={[{ required: true }]}><Select style={{ width: 130 }} options={["생산팀", "설비팀", "관리팀", "환경안전팀", "영업팀"].map((d) => ({ value: d, label: d }))} /></Form.Item>
          <Form.Item name="amount" label="금액" rules={[{ required: true }]}><InputNumber min={1} style={{ width: 160 }} formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")} /></Form.Item>
          <Form.Item name="memo" label="적요"><Input style={{ width: 200 }} /></Form.Item>
          <Form.Item><Button type="primary" htmlType="submit">등록</Button></Form.Item>
        </Form>
      </Card>
      <Card title="경비 내역" size="small">
        <Table rowKey="exp_no" dataSource={data?.rows ?? []} size="small" pagination={{ pageSize: 12 }} scroll={{ x: true }}
          columns={[
            { title: "일자", dataIndex: "exp_date", render: day },
            { title: "번호", dataIndex: "exp_no" },
            { title: "항목", dataIndex: "category" },
            { title: "부서", dataIndex: "dept" },
            { title: "금액", dataIndex: "amount", align: "right", render: won },
            { title: "적요", dataIndex: "memo" },
          ]} />
      </Card>
    </Space>
  );
}
