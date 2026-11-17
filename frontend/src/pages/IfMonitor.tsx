import { Button, Card, Drawer, Segmented, Space, Table, Tag, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import { api, errMsg, post } from "../api/client";
import { IfStatus, dt } from "../status";
import { useEvents } from "../api/useEvents";

interface IfDef { if_id: string; system: string; direction: string; name: string; counts: Record<string, number> }
interface Msg {
  id: number; message_id: string; if_id: string; direction: string; source: string; target: string;
  status: string; error_msg: string | null; retry_count: number; created_at: string; payload?: unknown;
}

const Dir = ({ d }: { d: string }) => (d === "IN" ? <Tag color="blue">레거시 → ERP</Tag> : <Tag color="purple">ERP → 레거시</Tag>);

export default function IfMonitor() {
  const [catalog, setCatalog] = useState<IfDef[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [detail, setDetail] = useState<Msg>();
  const [filter, setFilter] = useState<string>("ALL");
  const [ifId, setIfId] = useState<string>();
  const load = useCallback(() => {
    api<IfDef[]>("/api/if/catalog").then(setCatalog);
    api<Msg[]>("/api/if/messages").then(setMsgs);
  }, []);
  useEffect(() => void load(), [load]);
  useEvents(["if_message", "reset"], () => void load());

  const retry = async (id: number) => {
    try {
      const r = await post<Msg>(`/api/if/messages/${id}/retry`);
      message[r.status === "FAILED" ? "error" : "success"](r.status === "FAILED" ? "재처리했지만 다시 실패했습니다" : "재처리 성공");
    } catch (e) { message.error(errMsg(e)); }
    load();
  };
  const openDetail = async (id: number) => {
    try { setDetail(await api<Msg>(`/api/if/messages/${id}`)); } catch (e) { message.error(errMsg(e)); }
  };
  const failed = msgs.filter((m) => m.status === "FAILED").length;
  const shown = msgs.filter((m) => (filter === "ALL" || (filter === "FAILED") === (m.status === "FAILED")) && (!ifId || m.if_id === ifId));

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="연동 현황 (I/F 18종)" size="small">
        <Table rowKey="if_id" dataSource={catalog} size="small"
          onRow={(r) => ({ onClick: () => setIfId((v) => (v === r.if_id ? undefined : r.if_id)), style: { cursor: "pointer", background: ifId === r.if_id ? "#eff6ff" : undefined } })} pagination={false} scroll={{ x: "max-content" }}
          columns={[
            { title: "I/F ID", dataIndex: "if_id" },
            { title: "시스템", dataIndex: "system" },
            { title: "방향", dataIndex: "direction", render: (d: string) => <Dir d={d} /> },
            { title: "데이터", dataIndex: "name" },
            { title: "정상", render: (_, r) => (r.counts.PROCESSED ?? 0) + (r.counts.SENT ?? 0), align: "right" },
            { title: "실패", render: (_, r) => (r.counts.FAILED ? <b style={{ color: "#dc2626" }}>{r.counts.FAILED}</b> : 0), align: "right" },
          ]} />
      </Card>
      <Card title={`송수신 이력${ifId ? ` · ${ifId}` : ""}`} size="small" extra={
        <Space wrap>
          {ifId && <Button size="small" onClick={() => setIfId(undefined)}>I/F 선택 해제</Button>}
          <Segmented size="small" value={filter} onChange={(v) => setFilter(String(v))}
            options={[{ value: "ALL", label: "전체" }, { value: "OK", label: "정상" }, { value: "FAILED", label: `실패 ${failed}` }]} />
        </Space>}>
        <Table rowKey="id" dataSource={shown} size="small" pagination={{ pageSize: 15, showSizeChanger: false }} scroll={{ x: "max-content" }}
          columns={[
            { title: "시각", dataIndex: "created_at", render: dt },
            { title: "I/F ID", dataIndex: "if_id" },
            { title: "송신", dataIndex: "source" },
            { title: "수신", dataIndex: "target" },
            { title: "상태", dataIndex: "status", render: (s: string) => <IfStatus s={s} /> },
            { title: "오류", dataIndex: "error_msg", width: 260, ellipsis: true, render: (v: string | null) => v ?? "" },
            {
              title: "", render: (_, r) => (
                <Space>
                  <Button size="small" onClick={() => void openDetail(r.id)}>상세</Button>
                  {r.status === "FAILED" && <Button size="small" danger onClick={() => retry(r.id)}>재처리</Button>}
                </Space>
              ),
            },
          ]} />
      </Card>
      <Drawer open={!!detail} onClose={() => setDetail(undefined)} width={Math.min(560, window.innerWidth)}
        title={detail && <Space>{detail.if_id}<IfStatus s={detail.status} /></Space>}>
        {detail && (
          <>
            <p style={{ marginTop: 0, color: "#64748b" }}>{detail.source} → {detail.target} · {dt(detail.created_at)}{detail.retry_count ? ` · 재처리 ${detail.retry_count}회` : ""}</p>
            {detail.error_msg && <p style={{ color: "#dc2626" }}>{detail.error_msg}</p>}
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>메시지 ID {detail.message_id}</div>
            <pre style={{ whiteSpace: "pre-wrap", background: "#0f172a", color: "#e2e8f0", padding: 12, borderRadius: 8, fontSize: 12 }}>
              {JSON.stringify(detail.payload ?? detail, null, 2)}
            </pre>
          </>
        )}
      </Drawer>
    </Space>
  );
}
