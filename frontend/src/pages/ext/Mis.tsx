import { Card, Col, Collapse, Row, Segmented, Space, Table, Tooltip, Typography } from "antd";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { KpiRow, ShareBars, pct, useApi } from "../../components/common";
import { num } from "../../status";

interface Series {
  metric: string; label: string; unit: string; period: string; current: number; live_current: number | null; prev: number | null; yoy: number | null;
  points: { period: string; value: number; current: boolean }[];
  breakdown: { dim: string; name: string; value: number; share: number }[];
}

const PAGES: Record<string, { title: string; metrics: string[]; dimTitle: string }> = {
  orders: { title: "수주분석", metrics: ["orders_amt"], dimTitle: "거래처별 수주" },
  sales: { title: "매출분석", metrics: ["sales_amt"], dimTitle: "거래처별 매출" },
  production: { title: "생산분석", metrics: ["prod_qty", "defect_rate"], dimTitle: "공정별 생산량" },
  paper: { title: "원지매입", metrics: ["paper_amt", "paper_kg"], dimTitle: "제지사별 매입" },
  freight: { title: "운반비분석", metrics: ["freight_amt"], dimTitle: "운송사별 운반비" },
};

/** 단위에 맞춘 짧은 표기: 원 → 억/만, 매·kg → 만, % → 소수. */
export function fmtShort(v: number, unit: string) {
  if (unit === "%") return pct(v, 2);
  if (unit === "원") return v >= 1e8 ? `${(v / 1e8).toFixed(1)}억` : `${Math.round(v / 1e4).toLocaleString()}만`;
  return v >= 1e4 ? `${(v / 1e4).toFixed(v >= 1e6 ? 0 : 1)}만${unit}` : `${num(v)}${unit}`;
}
const fmtFull = (v: number, unit: string) => (unit === "%" ? pct(v, 2) : `${num(v)}${unit}`);

function BarChart({ s }: { s: Series }) {
  const W = 760, H = 240, L = 56, B = 26, T = 12;
  const max = Math.max(...s.points.map((p) => p.value), 0) * 1.1 || 1;
  const n = s.points.length;
  const slot = (W - L - 8) / n;
  const bw = Math.min(slot * 0.62, 38);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 520 }} role="img" aria-label={`${s.label} 추이`}>
        <defs>
          <pattern id={`hatch-${s.metric}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#9cc3f0" /><line x1="0" y1="0" x2="0" y2="6" stroke="#2a78d6" strokeWidth="2" />
          </pattern>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - 4} y1={y(t)} y2={y(t)} stroke="#eef2f7" />
            <text x={L - 6} y={y(t) + 4} fontSize={10} textAnchor="end" fill="#64748b">{fmtShort(t, s.unit)}</text>
          </g>
        ))}
        {s.points.map((p, i) => {
          const cx = L + slot * i + slot / 2;
          const top = y(p.value);
          const h = Math.max(H - B - top, 0);
          return (
            <Tooltip key={p.period} title={`${p.period}${p.current ? " (진행 중)" : ""}: ${fmtFull(p.value, s.unit)}`}>
              <g>
                <rect x={cx - slot / 2} y={T} width={slot} height={H - T - B} fill="transparent" />
                <path d={`M${cx - bw / 2},${H - B} V${top + Math.min(4, h)} q0,-4 4,-4 H${cx + bw / 2 - 4} q4,0 4,4 V${H - B} Z`}
                  fill={p.current ? `url(#hatch-${s.metric})` : "#2a78d6"} />
                <text x={cx} y={H - 8} fontSize={10} textAnchor="middle" fill={p.current ? "#0f172a" : "#64748b"} fontWeight={p.current ? 700 : 400}>
                  {s.period === "year" ? p.period : `${p.period.slice(2, 4)}.${p.period.slice(5)}`}
                </text>
              </g>
            </Tooltip>
          );
        })}
        <line x1={L} x2={W - 4} y1={H - B} y2={H - B} stroke="#cbd5e1" />
      </svg>
    </div>
  );
}

function MetricCard({ metric, period }: { metric: string; period: string }) {
  const [s] = useApi<Series>(`/api/mis/series?metric=${metric}&period=${period}`, ["invoice", "sales_order", "production", "purchase", "shipment"]);
  if (!s) return <Card loading />;
  return (
    <Card size="small" title={`${s.label} ${period === "year" ? "연도별" : "월별"} 추이`}
      extra={<Typography.Text type="secondary" style={{ fontSize: 12 }}>빗금 = {period === "year" ? "올해(누적)" : "이번 달(진행 중)"}</Typography.Text>}>
      <BarChart s={s} />
      <Collapse ghost size="small" items={[{ key: "t", label: "표로 보기", children: (
        <Table size="small" pagination={false} rowKey="period" dataSource={[...s.points].reverse()}
          columns={[{ title: period === "year" ? "연도" : "월", dataIndex: "period", render: (v: string, p) => `${v}${p.current ? " (진행 중)" : ""}` },
            { title: s.label, dataIndex: "value", align: "right" as const, render: (v: number) => fmtFull(v, s.unit) }]} />) }]} />
    </Card>
  );
}

/** 경영정보 → 수주·매출·생산·원지매입·운반비 분석(월/년). */
export default function MisAnalysis() {
  const { metric = "sales" } = useParams();
  const page = PAGES[metric] ?? PAGES.sales;
  const [period, setPeriod] = useState<string>("month");
  const [main] = useApi<Series>(`/api/mis/series?metric=${page.metrics[0]}&period=month`, ["invoice", "sales_order", "production", "purchase", "shipment"]);
  const [yearS] = useApi<Series>(`/api/mis/series?metric=${page.metrics[0]}&period=year`, ["invoice", "sales_order", "production", "purchase", "shipment"]);
  const unit = main?.unit ?? "";
  const diff = (a: number, b: number | null) => (b ? `${a >= b ? "▲" : "▼"} ${pct(Math.abs(a / b - 1))}` : "-");
  // 진행 중인 달은 경과 일수로 월말을 추정해 전년 동월과 비교한다(불량률은 비율이라 그대로)
  const today = new Date();
  const dim = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const proj = main ? (unit === "%" ? main.current : (main.current * dim) / today.getDate()) : 0;
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <Typography.Text type="secondary">지난달까지는 월 실적, 이번 달은 기준 실적에 데모 중 발생한 실데이터를 더한 값입니다.</Typography.Text>
        <Segmented value={period} onChange={(v) => setPeriod(String(v))} options={[{ label: "월별", value: "month" }, { label: "연도별", value: "year" }]} />
      </div>
      {main && (
        <KpiRow items={[
          { title: `이번 달 ${main.label}`, value: fmtShort(main.current, unit), hint: main.live_current ? `데모 중 발생 ${fmtFull(main.live_current, unit)} 포함` : undefined },
          { title: "전월", value: main.prev != null ? fmtShort(main.prev, unit) : "-" },
          { title: unit === "%" ? "전년 동월 대비" : "월말 예상 · 전년 동월 대비", value: unit === "%" ? diff(main.current, main.yoy) : `${fmtShort(proj, unit)} ${diff(proj, main.yoy)}`,
            hint: `이번 달 ${today.getDate()}/${dim}일 경과 기준 추정. 전년 동월 ${main.yoy != null ? fmtShort(main.yoy, unit) : "-"}` },
          { title: "올해 누적", value: yearS ? fmtShort(yearS.points.find((p) => p.current)?.value ?? 0, unit) : "-",
            hint: yearS ? `전년 ${fmtShort(yearS.points.find((p) => !p.current)?.value ?? 0, unit)}` : undefined },
        ]} />
      )}
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            {page.metrics.map((m) => <MetricCard key={`${m}-${period}`} metric={m} period={period} />)}
          </Space>
        </Col>
        <Col xs={24} xl={8}>
          <Card size="small" title={`${page.dimTitle} (${period === "year" ? "올해 누적" : "이번 달"})`}>
            {(period === "year" ? yearS : main)?.breakdown.length
              ? <ShareBars rows={(period === "year" ? yearS : main)!.breakdown} fmt={(v) => fmtShort(v, unit)} />
              : <Typography.Text type="secondary">데이터가 없습니다</Typography.Text>}
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
