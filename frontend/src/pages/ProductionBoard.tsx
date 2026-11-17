import { Badge, Card, Col, Empty, List, Row, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { useEvents } from "../api/useEvents";

interface Cell { wo_no: string; item_name: string; qty: number; good_qty: number; defect_qty: number }
interface Lane { equipment_code: string; name: string; process: string; legacy_system: string; wait: Cell[]; run: Cell[]; done: Cell[] }

function Section({ title, color, rows, done }: { title: string; color: string; rows: Cell[]; done?: boolean }) {
  return (
    <>
      <Typography.Text strong><Badge color={color} text={`${title} ${rows.length}`} /></Typography.Text>
      {rows.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="" style={{ margin: 4 }} /> : (
        <List size="small" dataSource={done ? rows.slice(-5).reverse() : rows} renderItem={(c) => (
          <List.Item style={{ padding: "4px 0" }}>
            <div style={{ width: "100%" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <b>{c.wo_no}</b><span>{(done ? c.good_qty : c.qty).toLocaleString()}</span>
              </div>
              <div style={{ color: "#64748b", fontSize: 12 }}>
                {c.item_name}{done && c.defect_qty > 0 ? ` · 불량 ${c.defect_qty}` : ""}
              </div>
            </div>
          </List.Item>
        )} />
      )}
    </>
  );
}

export default function ProductionBoard() {
  const [lanes, setLanes] = useState<Lane[]>([]);
  const load = useCallback(() => api<Lane[]>("/api/production/board").then(setLanes), []);
  useEffect(() => void load(), [load]);
  useEvents(["work_order", "production", "reset"], () => void load());

  return (
    <Row gutter={[16, 16]}>
      {lanes.map((l) => (
        <Col xs={24} md={8} key={l.equipment_code}>
          <Card title={l.name} extra={<Badge status={l.run.length ? "processing" : "default"} text={l.run.length ? "가동" : "대기"} />}
            size="small" styles={{ body: { minHeight: 320 } }}>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>연동: {l.legacy_system}</Typography.Paragraph>
            <Section title="진행" color="blue" rows={l.run} />
            <Section title="대기" color="gray" rows={l.wait} />
            <Section title="완료(최근)" color="green" rows={l.done} done />
          </Card>
        </Col>
      ))}
    </Row>
  );
}
