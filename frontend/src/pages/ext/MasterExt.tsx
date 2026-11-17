import { Button, Card, Col, Form, Input, InputNumber, Modal, Row, Space, Table, Tabs, Tag, Typography, message } from "antd";
import { useState } from "react";
import { post } from "../../api/client";
import { pct, useApi } from "../../components/common";
import { dt, num, won } from "../../status";

const put = async (url: string, body: unknown) => {
  const r = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};

interface CodeGroup { group_code: string; group_name: string; codes: { code: string; name: string }[] }

/** 기준정보 → 공통항목: 코드 그룹별 공통 코드. */
export function CommonCodes() {
  const [groups = [], load] = useApi<CodeGroup[]>("/api/master/codes");
  const [form] = Form.useForm();
  const add = async (v: object) => {
    try { await post("/api/master/codes", v); message.success("코드 추가"); form.resetFields(["code", "name"]); load(); }
    catch (e) { message.error(String(e)); }
  };
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Row gutter={[16, 16]}>
        {groups.map((g) => (
          <Col key={g.group_code} xs={24} md={12} xl={8}>
            <Card size="small" title={<span>{g.group_name} <Typography.Text type="secondary" style={{ fontSize: 12 }}>{g.group_code}</Typography.Text></span>}>
              <Space size={[6, 6]} wrap>{g.codes.map((c) => <Tag key={c.code}>{c.name} <small style={{ color: "#94a3b8" }}>{c.code}</small></Tag>)}</Space>
            </Card>
          </Col>
        ))}
      </Row>
      <Card size="small" title="코드 추가">
        <Form form={form} layout="inline" onFinish={add} style={{ rowGap: 12 }}>
          <Form.Item name="group_code" label="그룹" rules={[{ required: true }]}><Input style={{ width: 160 }} placeholder="예: CLAIM_TYPE" /></Form.Item>
          <Form.Item name="code" label="코드" rules={[{ required: true }]}><Input style={{ width: 120 }} /></Form.Item>
          <Form.Item name="name" label="이름" rules={[{ required: true }]}><Input style={{ width: 160 }} /></Form.Item>
          <Form.Item><Button type="primary" htmlType="submit">추가</Button></Form.Item>
        </Form>
      </Card>
    </Space>
  );
}

interface Rate { key: string; group_code: string; label: string; value: number; unit: string; note: string | null }
const GROUP_TITLE: Record<string, string> = { PROCESS: "가공비 (공정별 분당 원가)", FREIGHT: "운반비·적재 기준", COST: "원가 계산 기준" };

/** 원가 기준값 편집. 기준정보(가공비·운반비)와 원가분석 기준정보가 같은 컴포넌트를 쓴다. */
export function CostRates({ groups, children }: { groups: string[]; children?: React.ReactNode }) {
  const [rows = [], load] = useApi<Rate[]>(`/api/master/cost-rates?group=${groups.join(",")}`, ["master"]);
  const [edit, setEdit] = useState<Rate>();
  const [val, setVal] = useState<number | null>(null);
  const save = async () => {
    try { await put(`/api/master/cost-rates/${edit!.key}`, { value: val }); message.success("저장 → 원가 계산에 바로 반영"); setEdit(undefined); load(); }
    catch (e) { message.error(String(e)); }
  };
  const show = (r: Rate) => (r.unit === "비율" ? pct(r.value) : `${r.value.toLocaleString()} ${r.unit}`);
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {children}
      {groups.map((g) => (
        <Card key={g} size="small" title={GROUP_TITLE[g] ?? g}>
          <Table rowKey="key" dataSource={rows.filter((r) => r.group_code === g)} size="small" pagination={false}
            columns={[
              { title: "항목", dataIndex: "label" },
              { title: "값", key: "v", align: "right", render: (_, r) => <b>{show(r)}</b> },
              { title: "설명", dataIndex: "note" },
              { title: "", key: "e", render: (_, r) => <Button size="small" onClick={() => { setEdit(r); setVal(r.value); }}>변경</Button> },
            ]} />
        </Card>
      ))}
      <Modal title={`${edit?.label ?? ""} 변경`} open={!!edit} onCancel={() => setEdit(undefined)} onOk={save} okText="저장">
        <InputNumber value={val} onChange={setVal} min={0} step={edit?.unit === "비율" ? 0.01 : 1} style={{ width: "100%" }} addonAfter={edit?.unit} />
        {edit?.unit === "비율" && <Typography.Text type="secondary">0~1 사이 소수 (예: 3% → 0.03)</Typography.Text>}
      </Modal>
    </Space>
  );
}

interface PriceData {
  items: { code: string; name: string; customer_name: string; unit_price: number; std_cost: number; margin: number | null; changed_at: string | null }[];
  papers: { code: string; name: string; paper_kind: string; basis_weight: number; price: number; changed_at: string | null }[];
  subs: { code: string; name: string; unit: string; price: number; supplier_name: string; changed_at: string | null }[];
}
interface Hist { id: number; kind: string; code: string; old_price: number; new_price: number; reason: string | null; changed_at: string }

/** 기준정보 → 단가관리(상자 판매단가) / 원재료비(원지·부자재 단가). */
export function Prices({ mode }: { mode: "sales" | "material" }) {
  const [data, load] = useApi<PriceData>("/api/master/prices", ["master"]);
  const [hist = [], loadH] = useApi<Hist[]>("/api/master/price-history", ["master"]);
  const [edit, setEdit] = useState<{ kind: string; code: string; name: string; price: number }>();
  const [form] = Form.useForm();
  const open = (kind: string, code: string, name: string, price: number) => { setEdit({ kind, code, name, price }); form.setFieldsValue({ price, reason: "" }); };
  const save = async (v: { price: number; reason?: string }) => {
    try { await put(`/api/master/prices/${edit!.kind}/${edit!.code}`, v); message.success("단가 변경"); setEdit(undefined); load(); loadH(); }
    catch (e) { message.error(String(e)); }
  };
  const btn = (kind: string, code: string, name: string, price: number) => <Button size="small" onClick={() => open(kind, code, name, price)}>변경</Button>;
  const kinds = mode === "sales" ? ["ITEM", "STD"] : ["PAPER", "SUB"];
  const tabs = mode === "sales"
    ? [{ key: "items", label: "상자 판매단가", children: (
        <Table rowKey="code" dataSource={data?.items ?? []} size="small" pagination={{ pageSize: 15 }} scroll={{ x: true }}
          columns={[
            { title: "코드", dataIndex: "code" }, { title: "품목", dataIndex: "name" }, { title: "거래처", dataIndex: "customer_name" },
            { title: "판매단가", dataIndex: "unit_price", align: "right", render: won },
            { title: "표준원가", dataIndex: "std_cost", align: "right", render: won },
            { title: "마진율", dataIndex: "margin", align: "right", render: (v: number | null) => <span style={{ color: (v ?? 0) < 0.15 ? "#dc2626" : undefined }}>{pct(v)}</span>, sorter: (a, b) => (a.margin ?? 0) - (b.margin ?? 0) },
            { title: "최근 변경", dataIndex: "changed_at", render: dt },
            { title: "", key: "e", render: (_, r) => btn("item", r.code, r.name, r.unit_price) },
          ]} />) }]
    : [
        { key: "papers", label: "원지 kg단가", children: (
          <Table rowKey="code" dataSource={data?.papers ?? []} size="small" pagination={false}
            columns={[
              { title: "코드", dataIndex: "code" }, { title: "원지", dataIndex: "name" },
              { title: "구분", dataIndex: "paper_kind", render: (v: string) => (v === "LINER" ? "표면지" : "골심지") },
              { title: "평량", dataIndex: "basis_weight", render: (v: number) => `${v} g/m²` },
              { title: "kg단가", dataIndex: "price", align: "right", render: won },
              { title: "최근 변경", dataIndex: "changed_at", render: dt },
              { title: "", key: "e", render: (_, r) => btn("paper", r.code, r.name, r.price) },
            ]} />) },
        { key: "subs", label: "부자재 단가", children: (
          <Table rowKey="code" dataSource={data?.subs ?? []} size="small" pagination={false}
            columns={[
              { title: "코드", dataIndex: "code" }, { title: "부자재", dataIndex: "name" }, { title: "단위", dataIndex: "unit" },
              { title: "단가", dataIndex: "price", align: "right", render: won }, { title: "공급사", dataIndex: "supplier_name" },
              { title: "", key: "e", render: (_, r) => btn("sub", r.code, r.name, r.price) },
            ]} />) },
      ];
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card size="small"><Tabs items={tabs} /></Card>
      <Card size="small" title="변경 이력">
        <Table rowKey="id" dataSource={hist.filter((h) => kinds.includes(h.kind))} size="small" pagination={{ pageSize: 8 }}
          locale={{ emptyText: "변경 이력이 없습니다" }}
          columns={[
            { title: "일시", dataIndex: "changed_at", render: dt }, { title: "코드", dataIndex: "code" },
            { title: "이전", dataIndex: "old_price", align: "right", render: (v: number) => num(v) },
            { title: "변경", dataIndex: "new_price", align: "right", render: (v: number) => num(v) },
            { title: "증감", key: "d", align: "right", render: (_, h) => <span style={{ color: h.new_price > h.old_price ? "#dc2626" : "#16a34a" }}>{pct((h.new_price - h.old_price) / (h.old_price || 1))}</span> },
            { title: "사유", dataIndex: "reason" },
          ]} />
      </Card>
      <Modal title={`단가 변경 · ${edit?.name ?? ""}`} open={!!edit} onCancel={() => setEdit(undefined)} onOk={() => form.submit()} okText="저장">
        <Form form={form} layout="vertical" onFinish={save}>
          <Form.Item name="price" label={`새 단가 (현재 ${num(edit?.price)}원)`} rules={[{ required: true }]}><InputNumber min={0.1} style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="reason" label="사유"><Input placeholder="예: 원지 가격 인상 반영" /></Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
