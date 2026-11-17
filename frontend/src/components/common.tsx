import { Card, Col, Progress, Row, Statistic, Tooltip } from "antd";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { useEvents } from "../api/useEvents";

/** GET 데이터 + SSE 이벤트가 오면 다시 불러오기. */
export function useApi<T>(url: string, events: string[] = [], init?: T): [T | undefined, () => void] {
  const [data, setData] = useState<T | undefined>(init);
  const load = useCallback(() => {
    api<T>(url).then(setData).catch(() => undefined);
  }, [url]);
  useEffect(() => load(), [load]);
  useEvents([...events, "reset"], () => load());
  return [data, load];
}

export const pct = (v: number | null | undefined, d = 1) => (v == null ? "-" : `${(v * 100).toFixed(d)}%`);
export const kg = (v: number | null | undefined) => (v == null ? "-" : `${Math.round(v).toLocaleString()}kg`);
export const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : "-");

export interface Kpi { title: string; value: ReactNode; suffix?: string; color?: string; hint?: string }

export function KpiRow({ items }: { items: Kpi[] }) {
  const span = items.length >= 4 ? 6 : 24 / items.length;
  return (
    <Row gutter={[16, 16]}>
      {items.map((k) => (
        <Col key={k.title} xs={12} lg={span}>
          <Card size="small">
            <Statistic title={k.hint ? <Tooltip title={k.hint}>{k.title}</Tooltip> : k.title} value={k.value as never}
              suffix={k.suffix} valueStyle={{ color: k.color, fontSize: 22 }} />
          </Card>
        </Col>
      ))}
    </Row>
  );
}

/** 사용률 막대: 80% 이상 주황, 100% 이상 빨강. */
export function UsageBar({ value, warn = 0.8 }: { value: number; warn?: number }) {
  const color = value >= 1 ? "#dc2626" : value >= warn ? "#f59e0b" : "#2a78d6";
  return <Progress percent={Math.round(value * 100)} size="small" strokeColor={color} style={{ minWidth: 120, margin: 0 }} />;
}

/** 가로 막대 비교(구성비). 한 가지 색, 값은 텍스트로. */
export function ShareBars({ rows, fmt }: { rows: { name: string; value: number; share: number }[]; fmt: (v: number) => string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(90px,140px) 1fr auto", gap: "8px 10px", alignItems: "center" }}>
      {rows.map((r) => (
        <div key={r.name} style={{ display: "contents" }}>
          <span style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
          <Tooltip title={`${fmt(r.value)} (${pct(r.share)})`}>
            <div style={{ height: 12, background: "#eef2f7", borderRadius: 4 }}>
              <div style={{ height: 12, width: `${(r.value / max) * 100}%`, background: "#2a78d6", borderRadius: 4 }} />
            </div>
          </Tooltip>
          <span style={{ fontSize: 12, color: "#475569", textAlign: "right", whiteSpace: "nowrap" }}>{fmt(r.value)} · {pct(r.share)}</span>
        </div>
      ))}
    </div>
  );
}

export const PROCESS_COLOR: Record<string, string> = { CORRUGATE: "#2a78d6", PRINT: "#eb6834", CONVERT: "#1baf7a" };
