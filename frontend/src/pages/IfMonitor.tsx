import { Button, Card, Drawer, Space, Table, Tag, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import { api, post } from "../api/client";
import { useEvents } from "../api/useEvents";

interface IfDef { if_id: string; system: string; direction: string; name: string; counts: Record<string, number> }
interface Msg {
  id: number; message_id: string; if_id: string; direction: string; source: string; target: string;
  status: string; error_msg: string | null; retry_count: number; created_at: string; payload?: unknown;
}

const STATUS_COLOR: Record<string, string> = { PROCESSED: "green", SENT: "green", FAILED: "red", RECEIVED: "gold" };

export default function IfMonitor() {
  const [catalog, setCatalog] = useState<IfDef[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [detail, setDetail] = useState<Msg>();
  const load = useCallback(() => {
    api<IfDef[]>("/api/if/catalog").then(setCatalog);
    api<Msg[]>("/api/if/messages").then(setMsgs);
  }, []);
  useEffect(() => void load(), [load]);
  useEvents(["if_message", "reset"], () => void load());

  const retry = async (id: number) => {
    const r = await post<Msg>(`/api/if/messages/${id}/retry`);
    message[r.status === "FAILED" ? "error" : "success"](`재처리 결과: ${r.status}`);
    load();
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="연동 현황 (I/F 18종)" size="small">
        <Table rowKey="if_id" dataSource={catalog} size="small" pagination={false} scroll={{ x: true }}
          columns={[
            { title: "I/F ID", dataIndex: "if_id" },
            { title: "시스템", dataIndex: "system" },
            { title: "방향", dataIndex: "direction", render: (d: string) => (d === "IN" ? "레거시 → ERP" : "ERP → 레거시") },
            { title: "데이터", dataIndex: "name" },
            { title: "정상", render: (_, r) => (r.counts.PROCESSED ?? 0) + (r.counts.SENT ?? 0), align: "right" },
            { title: "실패", render: (_, r) => r.counts.FAILED ?? 0, align: "right" },
          ]} />
      </Card>
      <Card title="송수신 이력" size="small">
        <Table rowKey="id" dataSource={msgs} size="small" scroll={{ x: true }}
          columns={[
            { title: "시각", dataIndex: "created_at" },
            { title: "I/F ID", dataIndex: "if_id" },
            { title: "송신", dataIndex: "source" },
            { title: "수신", dataIndex: "target" },
            { title: "상태", dataIndex: "status", render: (s: string) => <Tag color={STATUS_COLOR[s]}>{s}</Tag> },
            { title: "오류", dataIndex: "error_msg", ellipsis: true },
            {
              title: "", render: (_, r) => (
                <Space>
                  <Button size="small" onClick={async () => setDetail(await api<Msg>(`/api/if/messages/${r.id}`))}>상세</Button>
                  {r.status === "FAILED" && <Button size="small" danger onClick={() => retry(r.id)}>재처리</Button>}
                </Space>
              ),
            },
          ]} />
      </Card>
      <Drawer open={!!detail} onClose={() => setDetail(undefined)} width={520} title={detail?.if_id}>
        <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(detail, null, 2)}</pre>
      </Drawer>
    </Space>
  );
}
