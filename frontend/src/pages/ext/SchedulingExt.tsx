import { Alert, Button, Card, Col, Descriptions, Empty, Progress, Row, Space, Table, Tag, Tooltip, Typography, message } from "antd";
import { useState } from "react";
import { post } from "../../api/client";
import { KpiRow, PROCESS_COLOR, useApi } from "../../components/common";
import { num, won } from "../../status";

interface Settings {
  corrugator: { roll_widths: number[]; min_trim_mm: number; max_ups: number; take_up: Record<string, number> };
  equipment: { code: string; name: string; process: string; capacity_per_hour: number; legacy_system: string }[];
  setup_minutes: number; dispatch: { pallet_sheets: number; truck_11t: number; truck_5t: number };
  regions: Record<string, string>; auto_order: string;
}

/** 스케쥴링 → 기준정보. */
export function SchedSettings() {
  const [s] = useApi<Settings>("/api/scheduling/settings", ["master"]);
  const [custs = []] = useApi<{ code: string; name: string }[]>("/api/master/partners?partner_type=CUSTOMER");
  if (!s) return null;
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={12}>
        <Card size="small" title="원단 스케쥴링 (골판지기 폭 조합)">
          <Descriptions size="small" column={1} bordered items={[
            { label: "원지 폭(deckle)", children: s.corrugator.roll_widths.map((w) => <Tag key={w}>{w}mm</Tag>) },
            { label: "최소 트림", children: `${s.corrugator.min_trim_mm}mm (양쪽 귀 자르기)` },
            { label: "최대 배치 수(ups)", children: `${s.corrugator.max_ups}장` },
            { label: "골심지 사용 배수", children: Object.entries(s.corrugator.take_up).map(([k, v]) => <Tag key={k}>{k}골 ×{v}</Tag>) },
          ]} />
        </Card>
      </Col>
      <Col xs={24} lg={12}>
        <Card size="small" title="상자 스케쥴링 (설비 능력)">
          <Table rowKey="code" size="small" pagination={false} dataSource={s.equipment}
            columns={[{ title: "설비", dataIndex: "name" }, { title: "공정", dataIndex: "process" },
              { title: "능력", dataIndex: "capacity_per_hour", align: "right", render: (v: number) => `${num(v)}매/시간` },
              { title: "연동", dataIndex: "legacy_system" }]} />
          <Typography.Text type="secondary">작업 전환 셋업 {s.setup_minutes}분 · 기준값은 원가분석 → 기준정보에서 변경</Typography.Text>
        </Card>
      </Col>
      <Col xs={24} lg={12}>
        <Card size="small" title="배차 스케쥴링">
          <Descriptions size="small" column={1} bordered items={[
            { label: "파렛트 적재", children: `${num(s.dispatch.pallet_sheets)}매/PLT` },
            { label: "차량 적재", children: `11톤 ${s.dispatch.truck_11t}PLT · 5톤 ${s.dispatch.truck_5t}PLT` },
            { label: "배송 권역", children: custs.map((c) => <div key={c.code}>{c.name}: {s.regions[c.code] ?? "-"}</div>) },
          ]} />
        </Card>
      </Col>
      <Col xs={24} lg={12}>
        <Card size="small" title="원지 자동발주"><Typography.Paragraph>{s.auto_order}</Typography.Paragraph>
          <Typography.Text type="secondary">원지별 안전재고·발주 단위·공급사는 자재관리 → 원지 자동발주 화면에서 확인합니다.</Typography.Text></Card>
      </Col>
    </Row>
  );
}

interface Gantt {
  lanes: { code: string; name: string; process: string; busy: number }[];
  bars: { wo_no: string; item_name: string; qty: number; process: string; equipment_code: string; start: number; end: number; status: string }[];
  span: number;
}

/** 스케쥴링 → 상자 스케쥴링: 설비별 작업 순서 간트(공장 시간 기준). */
export function BoxGantt() {
  const [g] = useApi<Gantt>("/api/scheduling/gantt", ["production", "work_order"]);
  if (!g) return null;
  if (!g.bars.length) return <Card><Empty description="스케쥴을 확정하면 설비별 작업 순서가 그려집니다" /></Card>;
  const W = 1000, laneH = 46, left = 130, top = 26;
  const span = Math.max(g.span, 60);
  const x = (m: number) => left + (m / span) * (W - left - 10);
  const step = span > 600 ? 120 : span > 240 ? 60 : 30;
  const ticks = Array.from({ length: Math.floor(span / step) + 1 }, (_, i) => i * step);
  const lane = Object.fromEntries(g.lanes.map((l, i) => [l.code, i]));
  const H = top + g.lanes.length * laneH + 10;
  const cnt = (s: string) => new Set(g.bars.filter((b) => b.status === s).map((b) => `${b.wo_no}${b.process}`)).size;
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <KpiRow items={[
        { title: "계획 작업", value: g.bars.length }, { title: "진행 중", value: cnt("RUN"), color: "#16a34a" },
        { title: "완료", value: cnt("DONE") }, { title: "전체 소요(공장 시간)", value: `${Math.floor(span / 60)}시간 ${Math.round(span % 60)}분` },
      ]} />
      <Card title="인쇄·가공 공정 간트" extra={<Space size={12}>{Object.entries({ CORRUGATE: "골판지기", PRINT: "인쇄", CONVERT: "가공" }).map(([k, v]) => (
        <span key={k} style={{ fontSize: 12 }}><span style={{ display: "inline-block", width: 10, height: 10, background: PROCESS_COLOR[k], borderRadius: 2, marginRight: 4 }} />{v}</span>))}
        <span style={{ fontSize: 12, color: "#64748b" }}>흐린 막대 = 대기(예상)</span></Space>}>
        <div style={{ overflowX: "auto" }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 720 }}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={x(t)} x2={x(t)} y1={top - 4} y2={H - 6} stroke="#e2e8f0" />
                <text x={x(t)} y={14} fontSize={11} textAnchor="middle" fill="#64748b">{t === 0 ? "시작" : `+${t / 60 >= 1 ? `${Math.floor(t / 60)}h${t % 60 ? `${t % 60}m` : ""}` : `${t}m`}`}</text>
              </g>
            ))}
            {g.lanes.map((l, i) => (
              <g key={l.code}>
                <text x={8} y={top + i * laneH + laneH / 2 + 4} fontSize={12} fill="#0f172a" fontWeight={600}>{l.name}</text>
                <line x1={left} x2={W - 10} y1={top + (i + 1) * laneH} y2={top + (i + 1) * laneH} stroke="#f1f5f9" />
              </g>
            ))}
            {g.bars.map((b) => {
              const y = top + lane[b.equipment_code] * laneH + 8;
              const w = Math.max(x(b.end) - x(b.start) - 2, 3);
              return (
                <Tooltip key={`${b.wo_no}-${b.process}`} title={`${b.wo_no} · ${b.item_name} · ${num(b.qty)}매 · ${Math.round(b.end - b.start)}분 · ${b.status === "DONE" ? "완료" : b.status === "RUN" ? "진행" : "대기"}`}>
                  <g>
                    <rect x={x(b.start) + 1} y={y} width={w} height={laneH - 16} rx={4} fill={PROCESS_COLOR[b.process]}
                      opacity={b.status === "WAIT" ? 0.35 : 1} stroke={b.status === "RUN" ? "#0f172a" : "none"} strokeWidth={2} />
                    {w > 60 && <text x={x(b.start) + 6} y={y + (laneH - 16) / 2 + 4} fontSize={11} fill={b.status === "WAIT" ? "#0f172a" : "#fff"}>{b.wo_no.slice(-4)}</text>}
                  </g>
                </Tooltip>
              );
            })}
          </svg>
        </div>
        <Typography.Text type="secondary">완료 공정은 설비 실적 시간, 진행·대기 공정은 설비 능력 + 셋업으로 예상한 시간입니다. 같은 지시의 다음 공정은 앞 공정이 끝난 뒤 시작합니다.</Typography.Text>
      </Card>
    </Space>
  );
}

interface Truck {
  truck_no: number; region: string; due_date: string; truck_type: string; capacity: number; pallets: number; load_rate: number; est_freight: number; all_ready: boolean;
  orders: { order_no: string; customer_name: string; qty: number; pallets: number; status: string; ready: boolean; split: string | null }[];
}

/** 스케쥴링 → 배차 스케쥴링: 납기·권역별로 수주를 묶어 차량 적재 계획. */
export function DispatchPlan() {
  const [trucks = [], load] = useApi<Truck[]>("/api/scheduling/dispatch-plan", ["sales_order", "shipment"]);
  const [busy, setBusy] = useState<number>();
  const run = async (t: Truck) => {
    setBusy(t.truck_no);
    try {
      const r = await post<{ shipments: string[]; errors: string[] }>("/api/scheduling/dispatch-plan/execute", { order_nos: [...new Set(t.orders.filter((o) => o.ready).map((o) => o.order_no))] });
      message.success(`출하요청 ${r.shipments.length}건 → 로지스팟 배차요청`);
      load();
    } catch (e) { message.error(String(e)); }
    setBusy(undefined);
  };
  const avg = trucks.length ? trucks.reduce((a, t) => a + t.load_rate, 0) / trucks.length : 0;
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <KpiRow items={[
        { title: "계획 차량", value: trucks.length, suffix: "대" },
        { title: "출발 가능", value: trucks.filter((t) => t.all_ready).length, suffix: "대", color: "#16a34a" },
        { title: "평균 적재율", value: `${Math.round(avg * 100)}%` },
        { title: "예상 운임", value: won(trucks.reduce((a, t) => a + t.est_freight, 0)) },
      ]} />
      <Alert type="info" showIcon message="계획·생산중·생산완료 수주를 납기일·배송 권역별로 묶고, 파렛트 수 기준으로 11톤/5톤 차량에 적재합니다(한 차를 넘는 수주는 나눠 싣습니다). 생산이 끝난 수주는 차량 단위로 바로 출하요청할 수 있습니다." />
      {trucks.length === 0 ? <Card><Empty description="배차할 수주가 없습니다" /></Card> : (
        <Row gutter={[16, 16]}>
          {trucks.map((t) => (
            <Col key={t.truck_no} xs={24} md={12} xl={8}>
              <Card size="small" title={<span>🚚 {t.truck_no}호차 · {t.truck_type}</span>}
                extra={<Tag color={t.all_ready ? "green" : "default"}>{t.all_ready ? "출발 가능" : "생산 대기"}</Tag>}>
                <Space direction="vertical" style={{ width: "100%" }} size={6}>
                  <span><Tag color="blue">{t.region}</Tag> 납기 {t.due_date}</span>
                  <Tooltip title={`${t.pallets} / ${t.capacity} PLT`}><Progress percent={Math.round(t.load_rate * 100)} size="small" format={() => `${t.pallets}/${t.capacity} PLT`} /></Tooltip>
                  {t.orders.map((o) => (
                    <div key={o.order_no} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: o.ready ? undefined : "#94a3b8" }}>
                      <span>{o.customer_name} <small>{o.order_no}</small>{o.split && <Tag style={{ marginLeft: 4 }}>분할 {o.split}</Tag>}</span><span>{num(o.qty)}매 · {o.pallets}PLT</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography.Text type="secondary">예상 운임 {won(t.est_freight)}</Typography.Text>
                    <Button size="small" type="primary" disabled={!t.orders.some((o) => o.ready)} loading={busy === t.truck_no} onClick={() => run(t)}>출하요청</Button>
                  </div>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </Space>
  );
}
