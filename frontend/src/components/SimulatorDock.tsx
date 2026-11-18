import { Badge, Button, Collapse, InputNumber, Popconfirm, Segmented, Select, Space, Steps, Switch, Tag, Tooltip, Typography, message } from "antd";
import { ArrowRightOutlined, CaretRightOutlined, ControlOutlined, DownOutlined, PauseOutlined, PlusOutlined, WarningOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, errMsg, post } from "../api/client";
import { useEvents } from "../api/useEvents";
import { ORDER_STATUS, num, won } from "../status";

interface SimStatus { running: boolean; speed: number; sent: number; failed: number; received: number; defect_spike: boolean }
interface OrderBrief { order_no: string; customer_name: string; status: string; stage: string; total_amount: number }
interface Focus extends OrderBrief {
  qty: number; due_date: string;
  work_orders: { total: number; done: number; in_prod: number };
  shipment: { shipment_no: string; status: string; vehicle_no: string | null; carrier_name: string | null } | null;
  invoice: { invoice_no: string; status: string; nts_approval_no: string | null; total_amount: number } | null;
}
interface Cycle { stages: Record<string, number>; orders: OrderBrief[]; focus: Focus | null; defects_open: number }

type Act = "plan" | "ship" | "close";
interface Stage {
  key: string; title: string; sys: string; path: string; pathLabel: string;
  decision?: { act: Act; label: string; hint: string };
  auto?: string;
}

/** 주문 → 생산 → 출하 → 세금계산서 테스트 사이클. key는 백엔드 /api/dashboard/cycle 의 단계 키와 같다. */
const STAGES: Stage[] = [
  { key: "order", title: "주문 수신", sys: "OMS → ERP 수주", path: "/scheduling/corrugator", pathLabel: "원단 스케쥴링",
    decision: { act: "plan", label: "생산계획 수립·확정", hint: "대기 수주로 원단 폭 조합 계획을 만들고 확정해 MES에 생산지시를 보냅니다" } },
  { key: "production", title: "생산", sys: "MES · 골게터 · 인쇄 · 에볼", path: "/monitor/equipment", pathLabel: "설비 모니터링",
    auto: "설비가 생산지시를 받아 골판지기 → 인쇄 → 가공 순으로 생산합니다" },
  { key: "ship_request", title: "출하요청", sys: "ERP → 로지스팟", path: "/shipping/requests", pathLabel: "출하요청",
    decision: { act: "ship", label: "출하요청", hint: "생산이 끝났습니다. 출하요청을 내면 로지스팟에 배차를 요청합니다" } },
  { key: "delivery", title: "배차·상차", sys: "로지스팟 · 오토콘", path: "/shipping/dispatch", pathLabel: "배차상차",
    auto: "로지스팟이 차량을 배차하고 상차·출발을 알려옵니다" },
  { key: "close", title: "매출 마감", sys: "ERP 영업", path: "/sales/close", pathLabel: "마감관리",
    decision: { act: "close", label: "매출 마감", hint: "출하가 끝났습니다. 매출을 마감하면 위아고에 세금계산서 발행을 요청합니다" } },
  { key: "invoice", title: "세금계산서", sys: "위아고 → 국세청", path: "/sales/invoice", pathLabel: "전자세금계산서",
    auto: "위아고가 국세청 승인번호를 회신하면 마감되고 OMS에 진도를 알립니다" },
  { key: "done", title: "사이클 완료", sys: "OMS 진도 회신 · 원가 집계", path: "/cost/orders", pathLabel: "실제원가" },
];
const IDX = Object.fromEntries(STAGES.map((s, i) => [s.key, i]));
const STATUS_LABEL = Object.fromEntries(ORDER_STATUS.map(([k, l]) => [k, l]));

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* 저장 불가 환경 */ } },
};
const isNarrow = () => window.innerWidth < 768;

/** 모든 화면 위에 떠 있는 시뮬레이터 창. 접어 두면 오른쪽 아래 버튼만 남는다. */
export default function SimulatorDock() {
  const nav = useNavigate();
  const [open, setOpen] = useState(() => store.get("simdock.open") === "1");
  const [sim, setSim] = useState<SimStatus | null>();
  const [cy, setCy] = useState<Cycle>();
  const [focusNo, setFocusNo] = useState<string | null>(() => store.get("simdock.focus"));
  const [busy, setBusy] = useState(false);
  const [speedIn, setSpeedIn] = useState<number | null>(null);

  useEffect(() => store.set("simdock.open", open ? "1" : "0"), [open]);
  useEffect(() => store.set("simdock.focus", focusNo), [focusNo]);

  const loadSim = useCallback(() => api<SimStatus>("/api/sim/status").then(setSim).catch(() => setSim(null)), []);
  const loadCycle = useCallback(
    () => api<Cycle>(`/api/dashboard/cycle${focusNo ? `?order_no=${encodeURIComponent(focusNo)}` : ""}`).then(setCy).catch(() => undefined),
    [focusNo],
  );
  useEffect(() => {
    void loadSim(); void loadCycle();
    const t = setInterval(() => { void loadSim(); void loadCycle(); }, open ? 3000 : 6000);
    return () => clearInterval(t);
  }, [loadSim, loadCycle, open]);
  useEvents(["sales_order", "shipment", "invoice", "work_order", "reset"], () => { void loadCycle(); });

  // 추적 수주가 없거나(첫 실행·초기화) 사라졌으면 가장 최근 진행 중 수주를 잡는다.
  useEffect(() => {
    if (!cy) return;
    const exists = focusNo && cy.orders.some((o) => o.order_no === focusNo);
    if (focusNo && !exists && cy.focus == null) setFocusNo(null);
    else if (!focusNo) {
      const next = cy.orders.find((o) => o.status !== "CLOSED") ?? cy.orders[0];
      if (next) setFocusNo(next.order_no);
    }
  }, [cy, focusNo]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); message.success(ok); } catch (e) { message.error(errMsg(e)); }
    setBusy(false);
    void loadSim(); void loadCycle();
  };
  const newOrder = (large: boolean) => run(async () => {
    const r = await post<{ erp?: { result?: { order_no?: string } } }>(`/api/sim/oms/order${large ? "?large=true" : ""}`);
    const no = r.erp?.result?.order_no;
    if (no) setFocusNo(no);
  }, large ? "OMS 대형 주문 수신" : "OMS 주문 1건 수신");

  const doAct = (act: Act, orderNo?: string) => {
    if (act === "plan") return run(async () => {
      const plan = await post<{ plan_no: string }>("/api/scheduling/plans");
      await post(`/api/scheduling/plans/${plan.plan_no}/confirm`);
    }, "계획 확정, MES 생산지시 송신");
    if (act === "ship") return run(async () => {
      const nos = orderNo ? [orderNo] : (await api<{ order_no: string }[]>("/api/shipping/ready")).map((r) => r.order_no);
      if (!nos.length) throw new Error("생산이 끝난 수주가 없습니다");
      for (const n of nos) await post("/api/shipping/requests", { order_no: n });
    }, "출하요청 → 로지스팟 배차요청");
    return run(() => post("/api/settlement/close", orderNo ? { order_nos: [orderNo] } : {}), "매출 마감 → 위아고 세금계산서 발행 요청");
  };
  const go = (path: string) => { nav(path); if (isNarrow()) setOpen(false); };

  const f = cy?.focus;
  const cur = f ? IDX[f.stage] ?? 0 : 0;
  const curStage = STAGES[cur];
  const needsDecision = !!(f && curStage.decision);
  const pendingTotal = STAGES.filter((s) => s.decision).reduce((a, s) => a + (cy?.stages[s.key] ?? 0), 0);

  const detail = (s: Stage): string | null => {
    if (!f) return null;
    if (s.key === "production" && f.work_orders.total) return `생산지시 ${f.work_orders.done}/${f.work_orders.total} 완료${f.work_orders.in_prod ? ` · ${f.work_orders.in_prod}건 생산 중` : ""}`;
    if (s.key === "delivery" && f.shipment) return `${f.shipment.shipment_no}${f.shipment.vehicle_no ? ` · ${f.shipment.carrier_name ?? ""} ${f.shipment.vehicle_no}` : " · 배차 대기"}`;
    if (s.key === "invoice" && f.invoice) return `${f.invoice.invoice_no}${f.invoice.nts_approval_no ? ` · 승인 ${f.invoice.nts_approval_no}` : " · 승인 대기"}`;
    return null;
  };

  const stepItems = STAGES.map((s, i) => {
    const n = cy?.stages[s.key] ?? 0;
    const isCur = !!f && i === cur;
    const done = !!f && (i < cur || f.stage === "done");
    const info = i <= cur ? detail(s) : null;
    return {
      status: (done ? "finish" : isCur ? "process" : "wait") as "finish" | "process" | "wait",
      title: (
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <b style={{ fontWeight: isCur ? 700 : 500 }}>{s.title}</b>
          {n > 0 && <Tag style={{ marginInlineEnd: 0 }} color={s.decision ? "orange" : undefined}>{n}건</Tag>}
          {isCur && s.decision && <Tag color="red" style={{ marginInlineEnd: 0 }}>지시 필요</Tag>}
          {isCur && s.auto && <Tag color="processing" style={{ marginInlineEnd: 0 }}>진행 중</Tag>}
        </span>
      ),
      description: (
        <div style={{ fontSize: 12, paddingBottom: 4 }}>
          <div style={{ color: "#8c8c8c" }}>
            {s.sys}
            <Button type="link" size="small" style={{ padding: "0 4px", height: 18, fontSize: 12 }} onClick={() => go(s.path)}>
              {s.pathLabel} <ArrowRightOutlined />
            </Button>
          </div>
          {info && <div style={{ color: "#595959" }}>{info}</div>}
          {isCur && s.decision && (
            <div className="simdock-decision">
              <div>{s.decision.hint}</div>
              <Space wrap size={6} style={{ marginTop: 6 }}>
                <Button size="small" type="primary" disabled={busy} onClick={() => doAct(s.decision!.act, s.decision!.act === "plan" ? undefined : f!.order_no)}>
                  {s.decision.label} 지시
                </Button>
                <Button size="small" disabled={busy} onClick={() => go(s.path)}>{s.pathLabel} 화면에서 <ArrowRightOutlined /></Button>
              </Space>
              {s.decision.act === "plan" && <div style={{ color: "#8c8c8c", marginTop: 4 }}>계획은 대기 중인 수주 전체로 세웁니다</div>}
            </div>
          )}
          {isCur && s.auto && <div style={{ color: "#0b7285" }}>{s.auto}</div>}
          {isCur && s.key === "done" && (
            <Space wrap size={6} style={{ marginTop: 6 }}>
              <Button size="small" type="primary" icon={<PlusOutlined />} disabled={busy} onClick={() => newOrder(false)}>새 사이클 시작</Button>
              <Button size="small" onClick={() => go(s.path)}>수주 원가 보기 <ArrowRightOutlined /></Button>
            </Space>
          )}
          {!isCur && s.decision && n > 0 && (
            <Button size="small" type="dashed" disabled={busy} style={{ marginTop: 4 }} onClick={() => doAct(s.decision!.act)}>
              대기 {n}건 일괄 {s.decision.label}
            </Button>
          )}
        </div>
      ),
    };
  });

  if (!open) {
    return (
      <div className="simdock-fab">
        <Badge dot={pendingTotal > 0 || (cy?.defects_open ?? 0) > 0} offset={[-6, 6]}>
          <Button type="primary" shape="round" size="large" icon={<ControlOutlined />} onClick={() => setOpen(true)}
            className={needsDecision ? "simdock-pulse" : undefined} aria-label="시뮬레이터 열기">
            <span className="simdock-fab-text">
              시뮬레이터{f ? ` · ${f.stage === "done" ? "완료" : curStage.title}${needsDecision ? " (지시 필요)" : ""}` : ""}
            </span>
          </Button>
        </Badge>
      </div>
    );
  }

  const options = [
    ...(cy?.orders ?? []).map((o) => ({
      value: o.order_no,
      label: `${o.order_no} · ${o.customer_name} · ${STATUS_LABEL[o.status] ?? o.status}`,
    })),
  ];

  return (
    <div className="simdock-panel" role="dialog" aria-label="시뮬레이터">
      <div className="simdock-head">
        <ControlOutlined />
        <b style={{ flex: 1 }}>테스트 사이클 시뮬레이터</b>
        <Badge status={sim === null ? "error" : sim?.running ? "processing" : "default"} text={<span style={{ fontSize: 12 }}>{sim === null ? "연결 끊김" : sim?.running ? `자동 ${sim.speed}x` : "수동"}</span>} />
        <Button type="text" size="small" icon={<DownOutlined />} onClick={() => setOpen(false)} aria-label="접기" title="접기" />
      </div>
      <div className="simdock-body">
        <Space wrap size={6} style={{ marginBottom: 8 }}>
          <Tooltip title={sim?.running ? "자동 주문 발생을 멈춥니다" : "OMS가 일정 간격으로 주문을 자동 발생시킵니다"}>
            <Button size="small" icon={sim?.running ? <PauseOutlined /> : <CaretRightOutlined />} disabled={busy || sim === null}
              onClick={() => run(() => post(sim?.running ? "/api/sim/stop" : "/api/sim/start"), sim?.running ? "자동 발생 정지" : "자동 발생 시작")}>
              {sim?.running ? "자동 정지" : "자동 시작"}
            </Button>
          </Tooltip>
          <Segmented size="small" value={[1, 5, 10, 20, 30].includes(sim?.speed ?? 0) ? sim?.speed : undefined}
            options={[1, 5, 10, 20, 30].map((v) => ({ label: `${v}x`, value: v }))}
            onChange={(v) => run(() => post("/api/sim/speed", { speed: Number(v) }), `배속 ${v}x`)} />
        </Space>
        <Space wrap size={6} style={{ marginBottom: 10 }}>
          <Button size="small" icon={<PlusOutlined />} disabled={busy} onClick={() => newOrder(false)}>OMS 주문</Button>
          <Button size="small" icon={<PlusOutlined />} disabled={busy} onClick={() => newOrder(true)}>대형 주문</Button>
        </Space>

        <div style={{ fontSize: 12, color: "#8c8c8c", marginBottom: 4 }}>추적 수주</div>
        <Select size="small" style={{ width: "100%" }} value={focusNo ?? undefined} placeholder="수주가 없습니다. 주문을 발생시키세요"
          options={options} onChange={(v) => setFocusNo(v)} showSearch optionFilterProp="label" notFoundContent="수주 없음" />
        {f && (
          <div style={{ fontSize: 12, color: "#595959", margin: "6px 0 10px" }}>
            {f.customer_name} · {num(f.qty)}매 · {won(f.total_amount)} · 납기 {String(f.due_date).slice(5)}
          </div>
        )}
        {!f && <div style={{ height: 10 }} />}

        {(cy?.defects_open ?? 0) > 0 && (
          <div className="simdock-alert">
            <WarningOutlined /> 불량 대책 미처리 {cy!.defects_open}건
            <Button size="small" type="link" style={{ padding: "0 4px" }} onClick={() => go("/quality/defects")}>불량대책 관리 <ArrowRightOutlined /></Button>
          </div>
        )}

        <Steps direction="vertical" size="small" current={cur} items={stepItems} />

        <Collapse size="small" ghost items={[{
          key: "tools", label: <span style={{ fontSize: 12 }}>시연 도구</span>,
          children: (
            <Space direction="vertical" size={8} style={{ width: "100%", fontSize: 12 }}>
              <Space wrap size={6}>
                <span>배속 직접</span>
                <InputNumber size="small" min={0.1} max={60} step={1} value={speedIn} placeholder="x" onChange={(v) => setSpeedIn(v)} style={{ width: 70 }} />
                <Button size="small" disabled={!speedIn || busy} onClick={() => run(() => post("/api/sim/speed", { speed: speedIn }), `배속 ${speedIn}x`)}>적용</Button>
              </Space>
              <Tooltip title="다음 인쇄 작업 1건에서 불량률 6~9%가 발생합니다">
                <span>다음 인쇄 작업 불량 발생 <Switch size="small" checked={sim?.defect_spike} disabled={sim === null}
                  onChange={(on) => run(() => post("/api/sim/defect-spike", { on }), on ? "다음 인쇄 작업에서 불량이 발생합니다" : "취소")} /></span>
              </Tooltip>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                ERP 송신 {sim?.sent ?? 0} · 실패 {sim?.failed ?? 0} · 지시 수신 {sim?.received ?? 0}
              </Typography.Text>
              <Popconfirm title="모든 거래 데이터를 지우고 기준정보 상태로 되돌립니다." okText="초기화" cancelText="취소"
                okButtonProps={{ danger: true }} onConfirm={() => run(async () => { await post("/api/sim/reset"); setFocusNo(null); }, "초기화 완료")}>
                <Button size="small" danger disabled={busy}>데모 초기화</Button>
              </Popconfirm>
            </Space>
          ),
        }]} />
      </div>
    </div>
  );
}
