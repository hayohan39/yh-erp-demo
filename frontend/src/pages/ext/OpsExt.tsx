import { Button, Card, Col, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Table, Tag, Typography, message } from "antd";
import { useState } from "react";
import { post } from "../../api/client";
import { KpiRow, PROCESS_COLOR, UsageBar, pct, useApi } from "../../components/common";
import { dt, num, won } from "../../status";

const req = async (url: string, body: unknown, method: string) => {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};

// ================================================================ 출하관리
interface PalletData {
  partners: { partner_code: string; partner_name: string; out_qty: number; in_qty: number; balance: number; last_at: string }[];
  moves: { id: number; partner_name: string; out_qty: number; in_qty: number; ref_no: string | null; memo: string | null; created_at: string }[];
}

/** 출하관리 → 파렛트 관리: 출하 때 나간 파렛트와 회수 잔량. */
export function Pallets() {
  const [data, load] = useApi<PalletData>("/api/shipping/pallets", ["shipment", "pallet"]);
  const [target, setTarget] = useState<PalletData["partners"][0]>();
  const [form] = Form.useForm();
  const ps = data?.partners ?? [];
  const submit = async (v: { qty: number; memo?: string }) => {
    try { await post("/api/shipping/pallets/return", { partner_code: target!.partner_code, ...v }); message.success("회수 등록"); setTarget(undefined); load(); }
    catch (e) { message.error(String(e)); }
  };
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <KpiRow items={[
        { title: "거래처 보유 파렛트", value: num(ps.reduce((a, p) => a + p.balance, 0)), suffix: "PLT" },
        { title: "누적 출고", value: num(ps.reduce((a, p) => a + p.out_qty, 0)) },
        { title: "누적 회수", value: num(ps.reduce((a, p) => a + p.in_qty, 0)) },
        { title: "회수율", value: pct(ps.reduce((a, p) => a + p.in_qty, 0) / (ps.reduce((a, p) => a + p.out_qty, 0) || 1)) },
      ]} />
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={13}>
          <Card title="거래처별 파렛트 잔량" size="small" extra={<Typography.Text type="secondary">출하 시 파렛트 적재 기준(기준정보)만큼 자동 출고</Typography.Text>}>
            <Table rowKey="partner_code" dataSource={ps} size="small" pagination={false}
              columns={[
                { title: "거래처", dataIndex: "partner_name" },
                { title: "출고", dataIndex: "out_qty", align: "right" },
                { title: "회수", dataIndex: "in_qty", align: "right" },
                { title: "잔량", dataIndex: "balance", align: "right", render: (v: number) => <b style={{ color: v > 60 ? "#c2410c" : undefined }}>{v}</b> },
                { title: "", key: "a", render: (_, p) => p.balance > 0 && <Button size="small" onClick={() => { setTarget(p); form.setFieldsValue({ qty: p.balance, memo: "회수" }); }}>회수</Button> },
              ]} />
          </Card>
        </Col>
        <Col xs={24} lg={11}>
          <Card title="파렛트 수불" size="small">
            <Table rowKey="id" dataSource={data?.moves ?? []} size="small" pagination={{ pageSize: 10 }}
              columns={[
                { title: "일시", dataIndex: "created_at", render: dt }, { title: "거래처", dataIndex: "partner_name" },
                { title: "구분", key: "t", render: (_, m) => (m.out_qty ? <Tag color="volcano">출고 {m.out_qty}</Tag> : <Tag color="green">회수 {m.in_qty}</Tag>) },
                { title: "근거", key: "r", render: (_, m) => m.ref_no ?? m.memo },
              ]} />
          </Card>
        </Col>
      </Row>
      <Modal title={`파렛트 회수 · ${target?.partner_name ?? ""}`} open={!!target} onCancel={() => setTarget(undefined)} onOk={() => form.submit()} okText="등록">
        <Form form={form} layout="vertical" onFinish={submit}>
          <Form.Item name="qty" label="회수 수량" rules={[{ required: true }]}><InputNumber min={1} max={target?.balance} style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="memo" label="메모"><Input /></Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

interface FreightData {
  rows: { shipment_no: string; order_no: string; customer_name: string; carrier_name: string; vehicle_no: string; qty: number; freight: number; std: number; diff: number; per_sheet: number | null; status: string; shipped_at: string | null }[];
  by_carrier: { carrier_name: string; count: number; freight: number; qty: number }[];
  rates: { base: number; per_sheet: number };
}

/** 출하관리 → 운반비 관리: 로지스팟 실제 운임 vs 표준 운임, 운송사별. */
export function Freight() {
  const [data] = useApi<FreightData>("/api/shipping/freight", ["shipment"]);
  const rows = data?.rows ?? [];
  const total = rows.reduce((a, r) => a + r.freight, 0);
  const std = rows.reduce((a, r) => a + r.std, 0);
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <KpiRow items={[
        { title: "배차 건수", value: rows.length },
        { title: "실제 운임", value: won(total) },
        { title: "표준 대비", value: `${total - std > 0 ? "+" : ""}${num(total - std)}`, suffix: "원", color: total > std ? "#dc2626" : "#16a34a", hint: `표준 = ${num(data?.rates.base)}원 + 매당 ${data?.rates.per_sheet}원` },
        { title: "매당 운반비", value: rows.length ? (total / rows.reduce((a, r) => a + r.qty, 0)).toFixed(1) : "-", suffix: "원" },
      ]} />
      <Card title="운송사별" size="small">
        <Table rowKey="carrier_name" dataSource={data?.by_carrier ?? []} size="small" pagination={false}
          locale={{ emptyText: "배차가 확정되면 운임이 집계됩니다" }}
          columns={[{ title: "운송사", dataIndex: "carrier_name" }, { title: "건수", dataIndex: "count", align: "right" },
            { title: "수량(매)", dataIndex: "qty", align: "right", render: num }, { title: "운임", dataIndex: "freight", align: "right", render: won },
            { title: "건당 평균", key: "avg", align: "right", render: (_, c) => won(c.freight / c.count) }]} />
      </Card>
      <Card title="출하 건별 운임" size="small">
        <Table rowKey="shipment_no" dataSource={rows} size="small" pagination={{ pageSize: 15 }} scroll={{ x: true }}
          columns={[
            { title: "출하번호", dataIndex: "shipment_no" }, { title: "거래처", dataIndex: "customer_name" },
            { title: "운송사", dataIndex: "carrier_name" }, { title: "차량", dataIndex: "vehicle_no" },
            { title: "수량", dataIndex: "qty", align: "right", render: num },
            { title: "실제 운임", dataIndex: "freight", align: "right", render: won },
            { title: "표준 운임", dataIndex: "std", align: "right", render: won },
            { title: "차이", dataIndex: "diff", align: "right", render: (v: number) => <span style={{ color: v > 0 ? "#dc2626" : "#16a34a" }}>{v > 0 ? "+" : ""}{num(v)}</span> },
            { title: "출발", dataIndex: "shipped_at", render: dt },
          ]} />
      </Card>
    </Space>
  );
}

// ================================================================ 생산관리
interface Result { id: number; wo_no: string; order_no: string | null; item_name: string | null; process: string; process_name: string; equipment_name: string; good_qty: number; defect_qty: number; defect_rate: number; run_minutes: number; per_hour: number | null; created_at: string }

/** 생산관리 → 생산실적: 설비 I/F로 들어온 공정별 실적. */
export function ProductionResults() {
  const [rows = []] = useApi<Result[]>("/api/production/results", ["production"]);
  const [proc, setProc] = useState<string>();
  const shown = proc ? rows.filter((r) => r.process === proc) : rows;
  const good = shown.reduce((a, r) => a + r.good_qty, 0);
  const bad = shown.reduce((a, r) => a + r.defect_qty, 0);
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <KpiRow items={[
        { title: "실적 건수", value: shown.length },
        { title: "양품", value: num(good), suffix: "매" },
        { title: "불량", value: num(bad), suffix: "매", color: "#c2410c" },
        { title: "불량률", value: pct(good + bad ? bad / (good + bad) : 0, 2) },
      ]} />
      <Card title="공정 실적" extra={<Select allowClear placeholder="공정 전체" style={{ width: 140 }} value={proc} onChange={setProc}
        options={[["CORRUGATE", "골판지기"], ["PRINT", "인쇄"], ["CONVERT", "가공"]].map(([value, label]) => ({ value, label }))} />}>
        <Table rowKey="id" dataSource={shown} size="small" pagination={{ pageSize: 20 }} scroll={{ x: true }}
          locale={{ emptyText: "설비 실적이 들어오면 표시됩니다" }}
          columns={[
            { title: "수신", dataIndex: "created_at", render: dt },
            { title: "생산지시", dataIndex: "wo_no" }, { title: "수주", dataIndex: "order_no" },
            { title: "품목", dataIndex: "item_name" },
            { title: "공정", dataIndex: "process_name", render: (v: string, r) => <Tag color={PROCESS_COLOR[r.process]}>{v}</Tag> },
            { title: "설비", dataIndex: "equipment_name" },
            { title: "양품", dataIndex: "good_qty", align: "right", render: num },
            { title: "불량", dataIndex: "defect_qty", align: "right", render: num },
            { title: "불량률", dataIndex: "defect_rate", align: "right", render: (v: number) => <span style={{ color: v >= 0.03 ? "#dc2626" : undefined }}>{pct(v, 2)}</span> },
            { title: "가동(분)", dataIndex: "run_minutes", align: "right" },
            { title: "시간당", dataIndex: "per_hour", align: "right", render: num },
          ]} />
      </Card>
    </Space>
  );
}

interface WorkLog {
  rows: { wo_no: string; item_name: string; process: string; process_name: string; equipment_name: string; status: string; started_at: string | null; ended_at: string | null; run_minutes: number | null; good_qty: number; defect_qty: number }[];
  summary: { equipment_code: string; equipment_name: string; jobs: number; running: number; run_minutes: number; good_qty: number; defect_qty: number }[];
}

/** 생산관리 → 작업내역: 설비별 작업일보. */
export function WorkLogPage() {
  const [data] = useApi<WorkLog>("/api/production/work-log", ["production"]);
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Row gutter={[16, 16]}>
        {(data?.summary ?? []).map((s) => (
          <Col key={s.equipment_code} xs={24} md={8}>
            <Card size="small" title={s.equipment_name} extra={s.running ? <Tag color="green">가동 중</Tag> : <Tag>대기</Tag>}>
              <Descriptions size="small" column={2} items={[
                { label: "작업", children: `${s.jobs}건` }, { label: "가동", children: `${num(s.run_minutes)}분` },
                { label: "양품", children: num(s.good_qty) }, { label: "불량", children: num(s.defect_qty) },
              ]} />
            </Card>
          </Col>
        ))}
      </Row>
      <Card title="작업 내역">
        <Table rowKey={(r) => `${r.wo_no}-${r.process}`} dataSource={data?.rows ?? []} size="small" pagination={{ pageSize: 20 }} scroll={{ x: true }}
          locale={{ emptyText: "설비가 작업을 시작하면 쌓입니다" }}
          columns={[
            { title: "설비", dataIndex: "equipment_name" },
            { title: "공정", dataIndex: "process_name", render: (v: string, r) => <Tag color={PROCESS_COLOR[r.process]}>{v}</Tag> },
            { title: "생산지시", dataIndex: "wo_no" }, { title: "품목", dataIndex: "item_name" },
            { title: "시작", dataIndex: "started_at", render: dt }, { title: "종료", dataIndex: "ended_at", render: dt },
            { title: "가동(공장 분)", dataIndex: "run_minutes", align: "right", render: (v: number | null) => v ?? "-" },
            { title: "양품", dataIndex: "good_qty", align: "right", render: num }, { title: "불량", dataIndex: "defect_qty", align: "right", render: num },
            { title: "상태", dataIndex: "status", render: (s: string) => (s === "RUN" ? <Tag color="green">진행</Tag> : <Tag color="blue">완료</Tag>) },
          ]} />
      </Card>
    </Space>
  );
}

interface Proc { process: string; process_name: string; equipment_name: string; legacy_system: string; capacity_per_hour: number; rate_per_min: number; setup_minutes: number; base_defect_rate: number; wait: number; ready: number; run: number; done: number; good_qty: number; defect_rate: number | null }

/** 생산관리 → 공정관리: 공정 기준 + 공정별 재공(WIP) + 라우팅 유형. */
export function Processes() {
  const [data] = useApi<{ processes: Proc[]; routing: { name: string; steps: string[]; items: number }[] }>("/api/production/processes", ["production", "work_order"]);
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Row gutter={[16, 16]}>
        {(data?.processes ?? []).map((p) => (
          <Col key={p.process} xs={24} md={8}>
            <Card size="small" title={<span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: PROCESS_COLOR[p.process], marginRight: 6 }} />{p.process_name} · {p.equipment_name}</span>}>
              <Row gutter={8} style={{ textAlign: "center", marginBottom: 8 }}>
                {[["대기", p.wait], ["투입 가능", p.ready], ["진행", p.run], ["완료", p.done]].map(([l, v]) => (
                  <Col span={6} key={l as string}><div style={{ fontSize: 20, fontWeight: 600 }}>{v}</div><div style={{ fontSize: 12, color: "#64748b" }}>{l}</div></Col>
                ))}
              </Row>
              <Descriptions size="small" column={1} items={[
                { label: "연동", children: p.legacy_system },
                { label: "능력", children: `${num(p.capacity_per_hour)}매/시간` },
                { label: "가공비", children: `${num(p.rate_per_min)}원/분 · 셋업 ${p.setup_minutes}분` },
                { label: "불량률(누적/기준)", children: `${pct(p.defect_rate, 2)} / ${pct(p.base_defect_rate, 1)}` },
              ]} />
            </Card>
          </Col>
        ))}
      </Row>
      <Card title="공정 라우팅 유형" size="small">
        <Table rowKey="name" dataSource={data?.routing ?? []} size="small" pagination={false}
          columns={[{ title: "유형", dataIndex: "name" },
            { title: "공정 순서", dataIndex: "steps", render: (s: string[]) => s.map((x, i) => <span key={x}>{i ? " → " : ""}<Tag>{x}</Tag></span>) },
            { title: "적용 품목", dataIndex: "items", align: "right", render: (v: number) => `${v}종` }]} />
      </Card>
    </Space>
  );
}

interface Oo { oo_no: string; kind: string; kind_name: string; vendor_name: string; item_name: string; process_name: string; qty: number; unit_price: number; amount: number; status: string; due_date: string; created_at: string; received_at: string | null }

/** 생산관리 → 외주·매입관리: 외주 가공(톰슨·코팅)과 완제품 상품 매입. */
export function Outsource() {
  const [rows = [], load] = useApi<Oo[]>("/api/production/outsource", ["outsource"]);
  const [vendors = []] = useApi<{ code: string; name: string }[]>("/api/master/partners?partner_type=OUTSOURCE");
  const [items = []] = useApi<{ code: string; name: string }[]>("/api/master/items");
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const create = async (v: object) => {
    try { await post("/api/production/outsource", v); message.success("외주 발주"); setOpen(false); form.resetFields(); load(); }
    catch (e) { message.error(String(e)); }
  };
  const receive = async (r: Oo) => {
    try { await post(`/api/production/outsource/${r.oo_no}/receive`); message.success(r.kind === "PURCHASE" ? "입고 → 제품 재고 반영" : "입고 완료"); load(); }
    catch (e) { message.error(String(e)); }
  };
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <KpiRow items={[
        { title: "진행 중", value: rows.filter((r) => r.status === "ORDERED").length, suffix: "건" },
        { title: "외주 가공비", value: won(rows.filter((r) => r.kind === "OUTSOURCE").reduce((a, r) => a + r.amount, 0)) },
        { title: "상품 매입액", value: won(rows.filter((r) => r.kind === "PURCHASE").reduce((a, r) => a + r.amount, 0)) },
        { title: "입고 완료", value: rows.filter((r) => r.status === "RECEIVED").length, suffix: "건" },
      ]} />
      <Card title="외주·매입 목록" extra={<Button type="primary" onClick={() => setOpen(true)}>외주·매입 등록</Button>}>
        <Table rowKey="oo_no" dataSource={rows} size="middle" pagination={{ pageSize: 15 }} scroll={{ x: true }}
          locale={{ emptyText: "외주 가공·상품 매입을 등록해 보세요" }}
          columns={[
            { title: "번호", dataIndex: "oo_no" }, { title: "구분", dataIndex: "kind_name", render: (v: string) => <Tag>{v}</Tag> },
            { title: "외주처", dataIndex: "vendor_name" }, { title: "품목", dataIndex: "item_name" }, { title: "작업", dataIndex: "process_name" },
            { title: "수량", dataIndex: "qty", align: "right", render: num }, { title: "금액", dataIndex: "amount", align: "right", render: won },
            { title: "납기", dataIndex: "due_date" },
            { title: "상태", dataIndex: "status", render: (s: string, r) => s === "RECEIVED" ? <Tag color="green">입고 {dt(r.received_at)}</Tag> : <Button size="small" type="primary" ghost onClick={() => receive(r)}>입고 처리</Button> },
          ]} />
      </Card>
      <Modal title="외주·매입 등록" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} okText="등록">
        <Form form={form} layout="vertical" onFinish={create} initialValues={{ kind: "OUTSOURCE", days: 3, process_name: "톰슨 타발" }}>
          <Form.Item name="kind" label="구분"><Select options={[{ value: "OUTSOURCE", label: "외주 가공" }, { value: "PURCHASE", label: "상품 매입(완제품)" }]} /></Form.Item>
          <Form.Item name="vendor_code" label="외주처" rules={[{ required: true }]}><Select options={vendors.map((v) => ({ value: v.code, label: v.name }))} /></Form.Item>
          <Form.Item name="item_code" label="품목" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={items.map((i) => ({ value: i.code, label: i.name }))} /></Form.Item>
          <Form.Item name="process_name" label="작업 내용" rules={[{ required: true }]}><Select options={["톰슨 타발", "코팅·라미네이팅", "수작업 조립", "완제품 매입"].map((x) => ({ value: x, label: x }))} /></Form.Item>
          <Row gutter={8}>
            <Col span={8}><Form.Item name="qty" label="수량" rules={[{ required: true }]}><InputNumber min={1} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="unit_price" label="단가" rules={[{ required: true }]}><InputNumber min={1} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="days" label="납기(일 후)"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>
    </Space>
  );
}

// ================================================================ 품질관리
interface Spec { item_code: string; item_name: string; customer_name: string; board_spec: string; flute: string; size: string; box_style: string; rev: number; bct_kgf: number; burst_kgf: number; moisture_max: number; print_note: string; pack_note: string; updated_at: string }

/** 품질관리 → 시방 관리: 품목별 품질 기준(압축·파열·수분)과 인쇄·포장 조건. */
export function Specs() {
  const [rows = [], load] = useApi<Spec[]>("/api/quality/specs");
  const [edit, setEdit] = useState<Spec>();
  const [form] = Form.useForm();
  const save = async (v: object) => {
    try { await req(`/api/quality/specs/${edit!.item_code}`, v, "PUT"); message.success("시방 개정"); setEdit(undefined); load(); }
    catch (e) { message.error(String(e)); }
  };
  return (
    <Card title="품목별 시방" extra={<Typography.Text type="secondary">출하 성적서는 이 기준으로 판정합니다</Typography.Text>}>
      <Table rowKey="item_code" dataSource={rows} size="small" pagination={{ pageSize: 15 }} scroll={{ x: true }}
        columns={[
          { title: "품목", dataIndex: "item_name", render: (v: string, r) => <span>{v}<br /><small style={{ color: "#64748b" }}>{r.item_code} · {r.box_style}</small></span> },
          { title: "원단", dataIndex: "board_spec" },
          { title: "압축강도(BCT)", dataIndex: "bct_kgf", align: "right", render: (v: number) => `${num(v)} kgf 이상` },
          { title: "파열강도", dataIndex: "burst_kgf", align: "right", render: (v: number) => `${v} kgf/cm² 이상` },
          { title: "수분", dataIndex: "moisture_max", align: "right", render: (v: number) => `${v}% 이하` },
          { title: "인쇄", dataIndex: "print_note" }, { title: "포장", dataIndex: "pack_note" },
          { title: "개정", dataIndex: "rev", render: (v: number) => `Rev.${v}` },
          { title: "", key: "e", render: (_, r) => <Button size="small" onClick={() => { setEdit(r); form.setFieldsValue(r); }}>개정</Button> },
        ]} />
      <Modal title={`시방 개정 · ${edit?.item_name ?? ""}`} open={!!edit} onCancel={() => setEdit(undefined)} onOk={() => form.submit()} okText="개정 저장">
        <Form form={form} layout="vertical" onFinish={save}>
          <Row gutter={8}>
            <Col span={8}><Form.Item name="bct_kgf" label="BCT(kgf)"><InputNumber min={1} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="burst_kgf" label="파열(kgf/cm²)"><InputNumber min={1} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="moisture_max" label="수분(%)"><InputNumber min={1} style={{ width: "100%" }} /></Form.Item></Col>
          </Row>
          <Form.Item name="print_note" label="인쇄 조건"><Input /></Form.Item>
          <Form.Item name="pack_note" label="포장 조건"><Input /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

interface Cert { cert_no: string; shipment_no: string; order_no: string; customer_name: string; item_name: string; qty: number; bct_kgf: number; burst_kgf: number; moisture: number; bct_std: number; burst_std: number; moisture_max: number; verdict: string; issued_at: string }

/** 품질관리 → 성적서 관리: 출하 시 자동 발행되는 시험 성적서. */
export function Certs() {
  const [rows = []] = useApi<Cert[]>("/api/quality/certs", ["shipment"]);
  const [view, setView] = useState<Cert>();
  return (
    <Card title="출하 성적서" extra={<Typography.Text type="secondary">출하(상차 완료) 시 품목별로 자동 발행</Typography.Text>}>
      <Table rowKey="cert_no" dataSource={rows} size="middle" pagination={{ pageSize: 15 }} scroll={{ x: true }}
        locale={{ emptyText: "출하가 완료되면 성적서가 발행됩니다" }}
        columns={[
          { title: "성적서", dataIndex: "cert_no" }, { title: "발행", dataIndex: "issued_at", render: dt },
          { title: "출하", dataIndex: "shipment_no" }, { title: "거래처", dataIndex: "customer_name" }, { title: "품목", dataIndex: "item_name" },
          { title: "수량", dataIndex: "qty", align: "right", render: num },
          { title: "BCT", key: "b", align: "right", render: (_, c) => `${c.bct_kgf} / ${c.bct_std}` },
          { title: "판정", dataIndex: "verdict", render: (v: string) => <Tag color={v === "합격" ? "green" : "red"}>{v}</Tag> },
          { title: "", key: "v", render: (_, c) => <Button size="small" onClick={() => setView(c)}>보기</Button> },
        ]} />
      <Modal title="시험 성적서" open={!!view} onCancel={() => setView(undefined)} footer={<Button onClick={() => window.print()}>인쇄</Button>} width={640}>
        {view && (
          <>
            <Descriptions size="small" bordered column={2} items={[
              { label: "성적서 번호", children: view.cert_no }, { label: "발행일", children: dt(view.issued_at) },
              { label: "거래처", children: view.customer_name }, { label: "출하번호", children: view.shipment_no },
              { label: "품목", children: view.item_name, span: 2 }, { label: "수량", children: `${num(view.qty)}매` }, { label: "수주", children: view.order_no },
            ]} />
            <Table style={{ marginTop: 12 }} size="small" pagination={false} rowKey="k"
              dataSource={[
                { k: "압축강도(BCT, kgf)", std: `${view.bct_std} 이상`, val: view.bct_kgf, ok: view.bct_kgf >= view.bct_std },
                { k: "파열강도(kgf/cm²)", std: `${view.burst_std} 이상`, val: view.burst_kgf, ok: view.burst_kgf >= view.burst_std },
                { k: "수분(%)", std: `${view.moisture_max} 이하`, val: view.moisture, ok: view.moisture <= view.moisture_max },
              ]}
              columns={[{ title: "시험 항목", dataIndex: "k" }, { title: "기준", dataIndex: "std" }, { title: "측정값", dataIndex: "val", align: "right" },
                { title: "판정", dataIndex: "ok", render: (v: boolean) => <Tag color={v ? "green" : "red"}>{v ? "적합" : "부적합"}</Tag> }]} />
            <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>YH 패키징 품질관리팀 · 종합 판정: <b>{view.verdict}</b></Typography.Paragraph>
          </>
        )}
      </Modal>
    </Card>
  );
}

interface Dev { dev_no: string; customer_name: string; item_name: string; category: string; amount: number; bill_type: string; status: string; created_at: string }

/** 품질관리 → 개발비 관리: 샘플·목형·수지판·디자인 비용과 고객 청구 여부. */
export function DevCosts() {
  const [rows = [], load] = useApi<Dev[]>("/api/quality/dev-costs");
  const [custs = []] = useApi<{ code: string; name: string }[]>("/api/master/partners?partner_type=CUSTOMER");
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const create = async (v: object) => {
    try { await post("/api/quality/dev-costs", v); message.success("개발비 등록"); setOpen(false); form.resetFields(); load(); }
    catch (e) { message.error(String(e)); }
  };
  const done = async (no: string) => { await post(`/api/quality/dev-costs/${no}/done`); load(); };
  const sum = (f: (d: Dev) => boolean) => rows.filter(f).reduce((a, r) => a + r.amount, 0);
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <KpiRow items={[
        { title: "개발 건수", value: rows.length }, { title: "진행 중", value: rows.filter((r) => r.status === "진행").length },
        { title: "고객 청구", value: won(sum((d) => d.bill_type === "고객청구")) }, { title: "자사 부담", value: won(sum((d) => d.bill_type === "자사부담")), color: "#c2410c" },
      ]} />
      <Card title="개발비 목록" extra={<Button type="primary" onClick={() => setOpen(true)}>개발비 등록</Button>}>
        <Table rowKey="dev_no" dataSource={rows} size="middle" pagination={{ pageSize: 15 }} scroll={{ x: true }}
          columns={[
            { title: "번호", dataIndex: "dev_no" }, { title: "등록", dataIndex: "created_at", render: dt },
            { title: "거래처", dataIndex: "customer_name" }, { title: "개발 품목", dataIndex: "item_name" },
            { title: "항목", dataIndex: "category", render: (v: string) => <Tag>{v}</Tag> },
            { title: "금액", dataIndex: "amount", align: "right", render: won },
            { title: "부담", dataIndex: "bill_type", render: (v: string) => <Tag color={v === "고객청구" ? "blue" : "orange"}>{v}</Tag> },
            { title: "상태", dataIndex: "status", render: (s: string, r) => s === "완료" ? <Tag color="green">완료</Tag> : <Popconfirm title="개발 완료로 바꿀까요?" onConfirm={() => done(r.dev_no)}><Button size="small">진행 → 완료</Button></Popconfirm> },
          ]} />
      </Card>
      <Modal title="개발비 등록" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} okText="등록">
        <Form form={form} layout="vertical" onFinish={create} initialValues={{ category: "샘플", bill_type: "고객청구" }}>
          <Form.Item name="customer_code" label="거래처" rules={[{ required: true }]}><Select options={custs.map((c) => ({ value: c.code, label: c.name }))} /></Form.Item>
          <Form.Item name="item_name" label="개발 품목" rules={[{ required: true }]}><Input /></Form.Item>
          <Row gutter={8}>
            <Col span={8}><Form.Item name="category" label="항목"><Select options={["샘플", "목형", "수지판", "디자인"].map((x) => ({ value: x, label: x }))} /></Form.Item></Col>
            <Col span={8}><Form.Item name="amount" label="금액" rules={[{ required: true }]}><InputNumber min={1} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="bill_type" label="부담"><Select options={["고객청구", "자사부담"].map((x) => ({ value: x, label: x }))} /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>
    </Space>
  );
}

interface Tool { code: string; kind: string; kind_name: string; item_name: string; customer_name: string; location: string; shots: number; life_shots: number; usage: number; status: string; made_at: string }

/** 품질관리 → 조판·목형: 수지판·칼틀 사용 타수와 수명. 생산 완료 때마다 타수 누적. */
export function Tooling() {
  const [rows = [], load] = useApi<Tool[]>("/api/quality/tooling", ["production", "tooling"]);
  const [kind, setKind] = useState<string>();
  const shown = kind ? rows.filter((r) => r.kind === kind) : rows;
  const replace = async (code: string) => { await post(`/api/quality/tooling/${code}/replace`); message.success("신규 제작으로 교체"); load(); };
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <KpiRow items={[
        { title: "조판(수지판)", value: rows.filter((r) => r.kind === "PLATE").length, suffix: "벌" },
        { title: "목형(칼틀)", value: rows.filter((r) => r.kind === "DIE").length, suffix: "개" },
        { title: "수명 80% 이상", value: rows.filter((r) => r.usage >= 0.8 && r.usage < 1).length, color: "#c2410c" },
        { title: "교체 필요", value: rows.filter((r) => r.usage >= 1 || r.status === "교체필요").length, color: "#dc2626" },
      ]} />
      <Card title="조판·목형 대장" extra={<Select allowClear placeholder="전체" style={{ width: 140 }} value={kind} onChange={setKind}
        options={[{ value: "PLATE", label: "조판(수지판)" }, { value: "DIE", label: "목형(칼틀)" }]} />}>
        <Table rowKey="code" dataSource={shown} size="small" pagination={{ pageSize: 15 }} scroll={{ x: true }}
          columns={[
            { title: "코드", dataIndex: "code" }, { title: "구분", dataIndex: "kind_name" },
            { title: "품목", dataIndex: "item_name" }, { title: "거래처", dataIndex: "customer_name" },
            { title: "보관 위치", dataIndex: "location" }, { title: "제작일", dataIndex: "made_at" },
            { title: "사용 타수 / 수명", key: "s", render: (_, t) => `${num(t.shots)} / ${num(t.life_shots)}` },
            { title: "수명 사용률", dataIndex: "usage", sorter: (a, b) => a.usage - b.usage, defaultSortOrder: "descend", render: (v: number) => <UsageBar value={v} /> },
            { title: "", key: "a", render: (_, t) => t.usage >= 0.8 && <Popconfirm title="새로 제작해 교체할까요?" onConfirm={() => replace(t.code)}><Button size="small" danger={t.usage >= 1}>교체</Button></Popconfirm> },
          ]} />
      </Card>
    </Space>
  );
}
