import { Button, Form, Input, Modal, Table, Tag, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import { api, errMsg, post } from "../api/client";
import { dt } from "../status";
import { useEvents } from "../api/useEvents";
import { PROCESS_NAME } from "./WorkOrders";

interface Defect {
  defect_no: string; wo_no: string; item_name: string; process: string; equipment_code: string;
  defect_qty: number; defect_rate: number; defect_type: string; status: string; cause: string | null;
  action_text: string | null; created_at: string;
}

export default function Defects() {
  const [rows, setRows] = useState<Defect[]>([]);
  const [target, setTarget] = useState<Defect>();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form] = Form.useForm();
  const load = useCallback(() => api<Defect[]>("/api/quality/defects").then(setRows).finally(() => setLoading(false)), []);
  useEffect(() => void load(), [load]);
  useEvents(["defect", "defect_closed", "reset"], () => void load());

  const close = () => { setTarget(undefined); form.resetFields(); };
  const submit = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      await post(`/api/quality/defects/${target!.defect_no}/action`, v);
      message.success(`${target!.defect_no} 대책을 등록했습니다`);
      close();
    } catch (e) { message.error(errMsg(e)); }
    setSaving(false);
    void load();
  };

  return (
    <>
      <Table rowKey="defect_no" dataSource={rows} loading={loading} size="middle" locale={{ emptyText: "등록된 불량이 없습니다" }} scroll={{ x: "max-content" }}
        columns={[
          { title: "불량번호", dataIndex: "defect_no" },
          { title: "발생시각", dataIndex: "created_at", render: dt },
          { title: "지시번호", dataIndex: "wo_no" },
          { title: "품목", dataIndex: "item_name" },
          { title: "공정", dataIndex: "process", render: (p: string) => PROCESS_NAME[p] ?? p },
          { title: "유형", dataIndex: "defect_type" },
          { title: "불량수", dataIndex: "defect_qty", align: "right" },
          { title: "불량률", dataIndex: "defect_rate", align: "right", render: (v: number) => `${(v * 100).toFixed(1)}%` },
          { title: "상태", dataIndex: "status", render: (s: string) => <Tag color={s === "OPEN" ? "red" : "green"}>{s === "OPEN" ? "조치 필요" : "조치 완료"}</Tag> },
          { title: "원인 · 대책", dataIndex: "action_text", width: 280, render: (v: string | null, r) => v ? <span><b>{r.cause}</b><br /><span style={{ color: "#64748b" }}>{v}</span></span> : "-" },
          { title: "", render: (_, r) => r.status === "OPEN" && <Button size="small" type="primary" onClick={() => setTarget(r)}>대책 등록</Button> },
        ]} />
      <Modal open={!!target} title={`대책 등록 · ${target?.defect_no}`} onOk={submit} onCancel={close} okText="등록" cancelText="취소" confirmLoading={saving} destroyOnClose>
        <p style={{ color: "#64748b", marginTop: 0 }}>{target?.item_name} · {target?.defect_type} · 불량률 {target ? (target.defect_rate * 100).toFixed(1) : ""}%</p>
        <Form form={form} layout="vertical">
          <Form.Item name="cause" label="원인" rules={[{ required: true, message: "원인을 입력하세요" }]}><Input placeholder="예: 잉크 점도 저하" /></Form.Item>
          <Form.Item name="action_text" label="대책" rules={[{ required: true, message: "대책을 입력하세요" }]}><Input.TextArea rows={3} placeholder="예: 점도 재조정, 시작 100매 전수 검사" /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
