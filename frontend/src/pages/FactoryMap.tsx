import { Card, Col, List, Row, Statistic, Tag, Typography } from "antd";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useEvents } from "../api/useEvents";
import { useSimSpeed } from "../api/useSimSpeed";
import { Pt, TokenShape, polyD, textW, useTokens } from "../components/anim";

export interface Current { wo_no: string; item_name: string; qty: number; started_at: string; expected_minutes: number; print_colors: number }
export interface Machine {
  code: string; name: string; process: string; legacy_system: string; status: "RUN" | "IDLE"; current: Current | null;
  queue: number; done: number; good_qty: number; defect_qty: number; defect_rate: number; open_defects: number;
}
export interface Paper { code: string; name: string; kind: string; used_kg: number; rolls_used: number; stock_kg: number; opening_kg: number }
export interface Factory {
  server_time: string; machines: Machine[]; conveyor: { in_transit: number }; papers: Paper[]; paper_used_kg: number;
  products: { total_qty: number; items: { item_code: string; item_name: string; qty: number }[] };
  work_orders: { total: number; done: number; in_prod: number; issued: number };
}
export interface IfEvent { if_id: string; direction: string; source: string; target: string; status: string; name: string; key: string; detail: string }
interface LogRow { id: number; time: string; text: string; color: string }

// ---- 배치(viewBox 1200 x 640 기준 좌표)
const BAR_Y = 36; // 상단 ERP·MES 연동 바 하단
const BOX = {
  PMS: { x: 20, y: 70, w: 240, h: 300 },
  CG01: { x: 300, y: 92, w: 470, h: 150 },
  PR05: { x: 900, y: 300, w: 280, h: 160 },
  EV01: { x: 540, y: 460, w: 290, h: 150 },
  STOCK: { x: 270, y: 470, w: 230, h: 140 },
  SHIP: { x: 20, y: 470, w: 220, h: 140 },
};
const P_ROLL: Pt[] = [[260, 200], [290, 200], [330, 205]];
const P_TO_PRINT: Pt[] = [[770, 170], [1040, 170], [1040, 300]];
const P_DIRECT: Pt[] = [[770, 170], [1040, 170], [1040, 270], [870, 270], [870, 535], [830, 535]];
const P_PRINT_EV: Pt[] = [[1040, 460], [1040, 535], [830, 535]];
const P_EV_STOCK: Pt[] = [[540, 535], [500, 535]];
const P_STOCK_TRUCK: Pt[] = [[300, 560], [270, 535], [175, 560]];
const P_SHIP_IF: Pt[] = [[280, BAR_Y], [280, 445], [130, 445], [130, BOX.SHIP.y]];
const CENTER: Record<string, number> = { PMS: 140, CG01: 535, PR05: 1040, EV01: 685, CONV: 1040 };
const instrPath = (x: number, y: number): Pt[] => [[x, BAR_Y], [x, y]];
const IF_TARGET: Record<string, { at: string; y: number }> = {
  "IF-EQ-01": { at: "CG01", y: BOX.CG01.y }, "IF-EQ-02": { at: "CG01", y: BOX.CG01.y },
  "IF-EQ-05": { at: "PR05", y: BOX.PR05.y }, "IF-EQ-06": { at: "PR05", y: BOX.PR05.y },
  "IF-EQ-03": { at: "EV01", y: 270 }, "IF-EQ-04": { at: "EV01", y: 270 },
  "IF-PMS-02": { at: "PMS", y: BOX.PMS.y }, "IF-PMS-01": { at: "PMS", y: BOX.PMS.y },
  "IF-EXT-03": { at: "CONV", y: 170 },
};
const PROC_KO: Record<string, string> = { CORRUGATE: "골판지기", PRINT: "인쇄", CONVERT: "가공" };

const css = `
.fm-spin{animation:fm-spin 1.1s linear infinite;transform-box:fill-box;transform-origin:center}
.fm-flow{stroke-dasharray:14 9;animation:fm-dash .5s linear infinite}
.fm-belt{stroke-dasharray:6 6;animation:fm-dash .4s linear infinite}
.fm-press{animation:fm-press .7s ease-in-out infinite}
.fm-blink{animation:fm-blink .9s step-start infinite}
.fm-glow{filter:drop-shadow(0 0 6px #22c55e)}
.fm-drive{animation:fm-drive 3s ease-in forwards}
@keyframes fm-drive{0%{transform:translateX(0);opacity:1}100%{transform:translateX(-260px);opacity:0}}
.fm-alarm{filter:drop-shadow(0 0 10px #ef4444)}
@keyframes fm-spin{to{transform:rotate(360deg)}}
@keyframes fm-dash{to{stroke-dashoffset:-23}}
@keyframes fm-press{0%,100%{transform:translateY(0)}50%{transform:translateY(16px)}}
@keyframes fm-blink{50%{opacity:.2}}
`;

const C = { bg: "#0b1220", panel: "#111a2e", line: "#334155", text: "#e2e8f0", sub: "#94a3b8", run: "#22c55e", idle: "#64748b", erp: "#3b82f6", alarm: "#ef4444" };

function machineFrame(m: Machine | undefined, flash: boolean) {
  const run = m?.status === "RUN";
  const alarm = flash || (m?.open_defects ?? 0) > 0;
  return { stroke: alarm ? C.alarm : run ? C.run : C.line, cls: alarm ? "fm-alarm" : run ? "fm-glow" : "", run };
}

function Progress({ x, y, w, m, speed, offset }: { x: number; y: number; w: number; m?: Machine; speed: number; offset: number }) {
  if (!m?.current) return <text x={x} y={y + 9} fill={C.sub} fontSize={12}>대기 중 · 대기 {m?.queue ?? 0}건</text>;
  const started = Date.parse(m.current.started_at + "Z");
  const elapsed = (Date.now() - offset - started) / 1000;
  // 시뮬레이터: 1배속에서 생산 1분 = 1초
  const p = Math.min(Math.max(elapsed / (m.current.expected_minutes / Math.max(speed, 0.1)), 0.02), 0.98);
  return (
    <g>
      <rect x={x} y={y} width={w} height={10} rx={5} fill="#1e293b" />
      <rect x={x} y={y} width={w * p} height={10} rx={5} fill={C.run} />
      <text x={x + w} y={y - 4} textAnchor="end" fill={C.text} fontSize={11}>{Math.round(p * 100)}%</text>
    </g>
  );
}

const short = (s: string, n = 16) => (s.length > n ? s.slice(0, n) + "…" : s);

function MachineText({ x, y, m }: { x: number; y: number; m?: Machine }) {
  return (
    <g fontSize={12} fill={C.text}>
      {m?.current ? (
        <>
          <text x={x} y={y}><tspan fontWeight={700}>{m.current.wo_no}</tspan> · {short(m.current.item_name)}</text>
          <text x={x} y={y + 17} fill={C.sub}>투입 {m.current.qty.toLocaleString()}매 · 대기 {m.queue}건</text>
        </>
      ) : <text x={x} y={y} fill={C.sub}>완료 {m?.done ?? 0}건</text>}
      <text x={x} y={y + 34} fill={C.sub}>
        양품 {(m?.good_qty ?? 0).toLocaleString()} · 불량률{" "}
        <tspan fill={(m?.defect_rate ?? 0) >= 0.03 ? C.alarm : C.sub}>{((m?.defect_rate ?? 0) * 100).toFixed(1)}%</tspan>
      </text>
    </g>
  );
}

function Header({ x, y, title, sys, m }: { x: number; y: number; title: string; sys: string; m?: Machine }) {
  const run = m?.status === "RUN";
  return (
    <g>
      <circle cx={x + 6} cy={y - 5} r={6} fill={run ? C.run : C.idle} className={run ? "fm-blink" : ""} />
      <text x={x + 18} y={y} fill={C.text} fontSize={15} fontWeight={700}>{title}</text>
      <text x={x + 24 + textW(title, 15)} y={y} fill={C.sub} fontSize={11}>{sys} · {run ? "가동" : "대기"}</text>
    </g>
  );
}

/** 설비 모니터링의 평면도 보기(3D를 쓸 수 없을 때의 대체 화면이기도 하다). */
export default function FactoryMap({ extra }: { extra?: ReactNode }) {
  const [f, setF] = useState<Factory>();
  const speed = useSimSpeed();
  const [offset, setOffset] = useState(0);
  const [flash, setFlash] = useState<Record<string, number>>({});
  const [log, setLog] = useState<LogRow[]>([]);
  const [, setTick] = useState(0);
  const [truck, setTruck] = useState<{ status: "NONE" | "DISPATCHED" | "LEAVING"; vehicle?: string; key: number }>({ status: "NONE", key: 0 });
  const { tokens, clock, add } = useTokens();
  const timer = useRef<number>();
  const logSeq = useRef(1);

  const load = useCallback(() => api<Factory>("/api/monitor/factory").then((d) => {
    setF(d);
    setOffset(Date.now() - Date.parse(d.server_time + "Z"));
  }), []);
  const reload = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void load(), 250);
  }, [load]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 500); return () => clearInterval(t); }, []);

  const addLog = (text: string, color: string) =>
    setLog((l) => [{ id: logSeq.current++, time: new Date().toLocaleTimeString("ko-KR", { hour12: false }), text, color }, ...l].slice(0, 40));

  const ms = (base: number) => Math.max(900, base / Math.sqrt(Math.max(speed, 1) / 2));

  useEvents(["if_message", "production", "defect", "defect_closed", "work_order", "shipment", "invoice", "reset"], (name, raw) => {
    const d = raw as Record<string, string>;
    if (name === "reset") { setLog([]); setTruck((t) => ({ status: "NONE", key: t.key + 1 })); reload(); return; }
    if (name === "if_message") {
      const e = raw as IfEvent;
      if (e.status === "RECEIVED") return;
      const tgt = IF_TARGET[e.if_id];
      const failed = e.status === "FAILED";
      if (e.if_id === "IF-EXT-02") {
        const out = e.direction === "OUT";
        add({ pts: out ? P_SHIP_IF : [...P_SHIP_IF].reverse(), dur: ms(1800), color: failed ? C.alarm : "#14b8a6",
          shape: out ? "mail" : "dot", label: out ? "로지스팟 배차요청" : `로지스팟 ${e.detail === "SHIPPED" ? "상차 완료" : "배차 확정"}` });
      } else if (tgt) {
        const x = CENTER[tgt.at];
        const pts = instrPath(x, tgt.y);
        const out = e.direction === "OUT";
        add({ pts: out ? pts : [...pts].reverse(), dur: ms(1400), color: failed ? C.alarm : out ? "#f59e0b" : C.run,
          shape: out ? "mail" : "dot", label: `${e.if_id.replace("IF-", "")} ${e.name}` });
      }
      if (e.if_id === "IF-PMS-01") {
        [0, 260, 520].forEach((delay) => add({ pts: P_ROLL, dur: ms(1500), color: "#a16207", shape: "roll" }, delay));
        addLog(`PMS 원지 롤 3개 투입 (${e.key})`, "#d97706");
      }
      if (e.if_id === "IF-MES-01") addLog(`ERP → MES 생산지시 ${e.key}`, C.erp);
      if (e.if_id === "IF-OMS-01") addLog("OMS 신규 주문 수신", C.erp);
      if (failed) addLog(`I/F 실패 ${e.if_id} ${e.name}`, C.alarm);
      reload();
      return;
    }
    if (name === "production") {
      const proc = d.process;
      if (proc === "TRANSFER") {
        const toPrint = d.next_process === "PRINT";
        add({ pts: toPrint ? P_TO_PRINT : P_DIRECT, dur: ms(toPrint ? 2600 : 3400), color: "#d6a756", shape: "sheet",
          label: `원단 ${Number(d.sheets).toLocaleString()}매` });
        addLog(`오토콘: ${d.wo_no} 원단 이송 → ${toPrint ? "인쇄 5호기" : "가공기"}`, "#eab308");
      } else if (proc === "DONE") {
        add({ pts: P_EV_STOCK, dur: ms(1500), color: "#c08a3e", shape: "box" });
        addLog(`${d.wo_no} 생산 완료 → 제품 창고 입고`, C.run);
      } else if (d.event === "START") {
        addLog(`${PROC_KO[proc] ?? proc} 가동 시작: ${d.wo_no}`, C.text);
      } else {
        if (proc === "PRINT") add({ pts: P_PRINT_EV, dur: ms(2000), color: "#d6a756", shape: "sheet", label: "인쇄 완료" });
        addLog(`${PROC_KO[proc] ?? proc} 실적 보고: ${d.wo_no}`, C.sub);
      }
      reload();
      return;
    }
    if (name === "defect") {
      setFlash((x) => ({ ...x, [d.equipment_code]: Date.now() }));
      addLog(`불량 경보 ${d.equipment_code} ${d.defect_type} ${(Number(d.defect_rate) * 100).toFixed(1)}%`, C.alarm);
    }
    if (name === "work_order") addLog(`계획 확정: 생산지시 ${d.count}건 발행`, C.erp);
    if (name === "shipment") {
      if (d.status === "REQUESTED") addLog(`출하요청 ${d.shipment_no} (${d.order_no})`, "#14b8a6");
      if (d.status === "DISPATCHED") {
        setTruck((t) => ({ status: "DISPATCHED", vehicle: d.vehicle_no, key: t.key + 1 }));
        addLog(`로지스팟 배차 확정: ${d.vehicle_no}`, "#14b8a6");
      }
      if (d.status === "SHIPPED") {
        [0, 300, 600].forEach((delay) => add({ pts: P_STOCK_TRUCK, dur: ms(1300), color: "#c08a3e", shape: "box" }, delay));
        window.setTimeout(() => setTruck((t) => ({ ...t, status: "LEAVING", key: t.key + 1 })), 1500);
        window.setTimeout(() => setTruck((t) => ({ status: "NONE", key: t.key + 1 })), 5000);
        addLog(`상차 완료·출발: ${d.vehicle_no} ${Number(d.qty).toLocaleString()}매`, "#14b8a6");
      }
    }
    if (name === "invoice") addLog(`세금계산서 발행 완료 ${d.invoice_no}`, "#a855f7");
    reload();
  });

  const mm = Object.fromEntries((f?.machines ?? []).map((m) => [m.code, m])) as Record<string, Machine>;
  const isFlash = (code: string) => Date.now() - (flash[code] ?? 0) < 8000;
  const cg = machineFrame(mm.CG01, isFlash("CG01"));
  const pr = machineFrame(mm.PR05, isFlash("PR05"));
  const ev = machineFrame(mm.EV01, isFlash("EV01"));
  const belt = (f?.conveyor.in_transit ?? 0) > 0 || tokens.some((t) => t.shape === "sheet");
  const wos = f?.work_orders;

  return (
    <div>
      <style>{css}</style>
      <Card size="small" style={{ marginBottom: 12 }} styles={{ body: { display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between" } }}>
        <Typography.Text type="secondary">설비·PMS·오토콘 신호를 실시간으로 받아 그립니다 · 시연 진행은 오른쪽 아래 시뮬레이터 창에서</Typography.Text>
        {extra}
      </Card>
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        {[
          ["생산지시 진행", `${wos?.in_prod ?? 0} / ${wos?.total ?? 0}`, "건"],
          ["생산 완료", wos?.done ?? 0, "건"],
          ["원지 투입", (f?.paper_used_kg ?? 0).toLocaleString(), "kg"],
          ["제품 재고", (f?.products.total_qty ?? 0).toLocaleString(), "매"],
          ["오토콘 이송 중", f?.conveyor.in_transit ?? 0, "건"],
        ].map(([t, v, u]) => (
          <Col xs={12} md={8} lg={4} key={t as string} flex="1">
            <Card size="small"><Statistic title={t} value={v as string} suffix={u} /></Card>
          </Col>
        ))}
      </Row>
      <Row gutter={12}>
        <Col xs={24} xl={18}>
          <div style={{ background: C.bg, borderRadius: 10, padding: 8, overflowX: "auto" }}>
            <svg viewBox="0 0 1200 640" style={{ width: "100%", minWidth: 720, display: "block" }} fontFamily="inherit">
              {/* 상단 연동 바 */}
              <rect x={10} y={6} width={1180} height={30} rx={6} fill="#172554" stroke={C.erp} />
              <text x={24} y={26} fill="#bfdbfe" fontSize={13} fontWeight={700}>YH 통합 ERP · MES</text>
              <text x={1176} y={26} fill="#93c5fd" fontSize={11} textAnchor="end">생산지시 ↓ · 실적·가동상태 ↑</text>
              {Object.entries(CENTER).map(([k, x]) => (
                <line key={k} x1={x} y1={BAR_Y} x2={x} y2={k === "EV01" ? 270 : k === "CONV" ? 170 : (BOX as Record<string, { y: number }>)[k]?.y ?? 100}
                  stroke="#1e3a8a" strokeDasharray="3 5" />
              ))}

              {/* 원지 창고(PMS) */}
              <rect {...{ x: BOX.PMS.x, y: BOX.PMS.y, width: BOX.PMS.w, height: BOX.PMS.h }} rx={10} fill={C.panel} stroke={C.line} />
              <text x={BOX.PMS.x + 14} y={BOX.PMS.y + 24} fill={C.text} fontSize={15} fontWeight={700}>원지 창고</text>
              <text x={BOX.PMS.x + 90} y={BOX.PMS.y + 24} fill={C.sub} fontSize={11}>PMS · 재고 kg</text>
              {(f?.papers ?? []).map((p, i) => {
                const y = BOX.PMS.y + 46 + i * 31;
                const r = p.stock_kg / p.opening_kg;
                return (
                  <g key={p.code}>
                    <circle cx={BOX.PMS.x + 22} cy={y + 4} r={9} fill="#78350f" stroke="#d97706" />
                    <circle cx={BOX.PMS.x + 22} cy={y + 4} r={3} fill="#fbbf24" />
                    <text x={BOX.PMS.x + 38} y={y} fill={C.text} fontSize={11}>{p.name}</text>
                    <rect x={BOX.PMS.x + 38} y={y + 5} width={130} height={6} rx={3} fill="#1e293b" />
                    <rect x={BOX.PMS.x + 38} y={y + 5} width={130 * r} height={6} rx={3} fill={r < 0.5 ? "#f97316" : "#d97706"} />
                    <text x={BOX.PMS.x + BOX.PMS.w - 10} y={y + 11} fill={C.sub} fontSize={10} textAnchor="end">{Math.round(p.stock_kg).toLocaleString()}</text>
                  </g>
                );
              })}

              {/* 골판지기 CG01 */}
              <rect x={BOX.CG01.x} y={BOX.CG01.y} width={BOX.CG01.w} height={BOX.CG01.h} rx={10} fill={C.panel} stroke={cg.stroke} strokeWidth={2} className={cg.cls} />
              <Header x={BOX.CG01.x + 12} y={BOX.CG01.y + 24} title="골판지기 CG01" sys="골게터 POP" m={mm.CG01} />
              {[0, 1, 2].map((i) => (
                <g key={i} transform={`translate(${BOX.CG01.x + 36 + i * 44},${BOX.CG01.y + 104})`}>
                  <g className={cg.run ? "fm-spin" : ""}>
                    <circle r={18} fill="#78350f" stroke="#d97706" strokeWidth={2} />
                    <line x1={-18} y1={0} x2={18} y2={0} stroke="#fbbf24" />
                    <circle r={5} fill="#fbbf24" />
                  </g>
                </g>
              ))}
              <rect x={BOX.CG01.x + 160} y={BOX.CG01.y + 92} width={290} height={28} rx={4} fill="#0f172a" stroke={C.line} />
              <path d={`M${BOX.CG01.x + 165},${BOX.CG01.y + 106} ${Array.from({ length: 28 }, (_, i) => `q5,${i % 2 ? 8 : -8} 10,0`).join(" ")}`}
                stroke="#d6a756" strokeWidth={3} fill="none" className={cg.run ? "fm-flow" : ""} />
              {[0, 1, 2, 3].map((i) => <rect key={i} x={BOX.CG01.x + 180 + i * 62} y={BOX.CG01.y + 86} width={40} height={6} rx={2} fill={cg.run ? "#ef4444" : "#475569"} opacity={0.8} />)}
              <MachineText x={BOX.CG01.x + 160} y={BOX.CG01.y + 44} m={mm.CG01} />
              <Progress x={BOX.CG01.x + 160} y={BOX.CG01.y + 134} w={290} m={mm.CG01} speed={speed} offset={offset} />

              {/* 오토콘 컨베이어 */}
              <path d={polyD([[770, 170], [1040, 170], [1040, 300]])} stroke="#475569" strokeWidth={14} fill="none" strokeLinejoin="round" />
              <path d={polyD([[770, 170], [1040, 170], [1040, 300]])} stroke="#94a3b8" strokeWidth={2} fill="none" className={belt ? "fm-belt" : ""} />
              <path d={polyD([[1040, 270], [870, 270], [870, 535], [830, 535]])} stroke="#334155" strokeWidth={10} fill="none" strokeLinejoin="round" />
              <path d={polyD(P_PRINT_EV)} stroke="#475569" strokeWidth={14} fill="none" strokeLinejoin="round" />
              <path d={polyD(P_PRINT_EV)} stroke="#94a3b8" strokeWidth={2} fill="none" className={belt ? "fm-belt" : ""} />
              <path d={polyD(P_EV_STOCK)} stroke="#475569" strokeWidth={14} fill="none" />
              <rect x={792} y={180} width={190} height={50} rx={8} fill={C.panel} stroke={C.line} />
              <text x={804} y={200} fill={C.text} fontSize={13} fontWeight={700}>오토콘 컨베이어</text>
              <text x={804} y={219} fill={C.sub} fontSize={11}>원단 이송 중 {f?.conveyor.in_transit ?? 0}건</text>
              <text x={880} y={330} fill={C.sub} fontSize={10} transform="rotate(90 880 330)">무인쇄 → 가공 직행</text>

              {/* 인쇄 5호기 */}
              <rect x={BOX.PR05.x} y={BOX.PR05.y} width={BOX.PR05.w} height={BOX.PR05.h} rx={10} fill={C.panel} stroke={pr.stroke} strokeWidth={2} className={pr.cls} />
              <Header x={BOX.PR05.x + 12} y={BOX.PR05.y + 24} title="인쇄 5호기" sys="PR05" m={mm.PR05} />
              {["#0ea5e9", "#ec4899", "#facc15", "#e2e8f0"].slice(0, Math.max(mm.PR05?.current?.print_colors ?? 4, 1)).map((c, i) => (
                <g key={c} transform={`translate(${BOX.PR05.x + 30 + i * 36},${BOX.PR05.y + 54})`}>
                  <g className={pr.run ? "fm-spin" : ""}><circle r={14} fill="#0f172a" stroke={c} strokeWidth={4} strokeDasharray="20 8" /></g>
                </g>
              ))}
              <MachineText x={BOX.PR05.x + 14} y={BOX.PR05.y + 96} m={mm.PR05} />
              <Progress x={BOX.PR05.x + 14} y={BOX.PR05.y + 142} w={250} m={mm.PR05} speed={speed} offset={offset} />
              {isFlash("PR05") && <text x={BOX.PR05.x + BOX.PR05.w - 12} y={BOX.PR05.y + 24} textAnchor="end" fill={C.alarm} fontWeight={700} fontSize={13} className="fm-blink">불량 경보</text>}

              {/* 가공기 */}
              <rect x={BOX.EV01.x} y={BOX.EV01.y} width={BOX.EV01.w} height={BOX.EV01.h} rx={10} fill={C.panel} stroke={ev.stroke} strokeWidth={2} className={ev.cls} />
              <Header x={BOX.EV01.x + 12} y={BOX.EV01.y + 24} title="가공기 EV01" sys="에볼/썬라이즈" m={mm.EV01} />
              <g transform={`translate(${BOX.EV01.x + 210},${BOX.EV01.y + 36})`}>
                <g className={ev.run ? "fm-press" : ""}><rect x={0} y={0} width={60} height={16} fill="#64748b" /><rect x={8} y={16} width={44} height={6} fill="#cbd5e1" /></g>
                <rect x={-4} y={44} width={68} height={8} fill="#334155" />
              </g>
              <MachineText x={BOX.EV01.x + 14} y={BOX.EV01.y + 52} m={mm.EV01} />
              <Progress x={BOX.EV01.x + 14} y={BOX.EV01.y + 128} w={260} m={mm.EV01} speed={speed} offset={offset} />
              <line x1={CENTER.EV01} y1={270} x2={CENTER.EV01} y2={BOX.EV01.y} stroke="#1e3a8a" strokeDasharray="3 5" />

              {/* 제품 창고 */}
              <rect x={BOX.STOCK.x} y={BOX.STOCK.y} width={BOX.STOCK.w} height={BOX.STOCK.h} rx={10} fill={C.panel} stroke={C.line} />
              <text x={BOX.STOCK.x + 14} y={BOX.STOCK.y + 24} fill={C.text} fontSize={15} fontWeight={700}>제품 창고</text>
              <text x={BOX.STOCK.x + BOX.STOCK.w - 12} y={BOX.STOCK.y + 24} fill={C.sub} fontSize={11} textAnchor="end">{(f?.products.total_qty ?? 0).toLocaleString()}매</text>
              {Array.from({ length: Math.min(12, Math.ceil((f?.products.total_qty ?? 0) / 4000)) }, (_, i) => (
                <rect key={i} x={BOX.STOCK.x + 16 + (i % 6) * 34} y={BOX.STOCK.y + 104 - Math.floor(i / 6) * 26} width={30} height={22} fill="#c08a3e" stroke="#fde68a" />
              ))}
              {(f?.products.items ?? []).slice(0, 2).map((s, i) => (
                <text key={s.item_code} x={BOX.STOCK.x + 16} y={BOX.STOCK.y + 46 + i * 16} fill={C.sub} fontSize={11}>{s.item_name} {s.qty.toLocaleString()}</text>
              ))}

              {/* 출하장 */}
              <rect x={BOX.SHIP.x} y={BOX.SHIP.y} width={BOX.SHIP.w} height={BOX.SHIP.h} rx={10} fill={C.panel} stroke={C.line} strokeDasharray="6 4" />
              <text x={BOX.SHIP.x + 14} y={BOX.SHIP.y + 24} fill={C.text} fontSize={15} fontWeight={700}>출하장</text>
              <text x={BOX.SHIP.x + 70} y={BOX.SHIP.y + 24} fill={C.sub} fontSize={11}>로지스팟 배차</text>
              <path d={polyD(P_SHIP_IF)} stroke="#134e4a" strokeDasharray="3 5" fill="none" />
              <g transform={`translate(${BOX.SHIP.x + 40},${BOX.SHIP.y + 60})`}>
                <g key={truck.key} className={truck.status === "LEAVING" ? "fm-drive" : ""} opacity={truck.status === "NONE" ? 0.25 : 1}>
                  <rect x={36} y={0} width={90} height={44} rx={3} fill={truck.status === "NONE" ? "#334155" : "#0f766e"} />
                  <rect x={0} y={14} width={36} height={30} rx={3} fill={truck.status === "NONE" ? "#475569" : "#14b8a6"} />
                  <rect x={5} y={18} width={16} height={11} rx={2} fill="#ccfbf1" opacity={0.7} />
                  <circle cx={18} cy={50} r={9} fill="#0f172a" stroke="#94a3b8" /><circle cx={104} cy={50} r={9} fill="#0f172a" stroke="#94a3b8" />
                  {truck.vehicle && truck.status !== "NONE" && <text x={81} y={27} textAnchor="middle" fill="#fff" fontSize={11} fontWeight={700}>{truck.vehicle}</text>}
                </g>
              </g>
              <text x={BOX.SHIP.x + 14} y={BOX.SHIP.y + 128} fill={C.sub} fontSize={11}>
                {truck.status === "NONE" ? "배차 대기" : truck.status === "DISPATCHED" ? "차량 도착 · 상차 중" : "출발"}
              </text>
              <path d={polyD([[270, 535], [240, 535]])} stroke="#475569" strokeWidth={14} />

              {tokens.map((k) => <TokenShape key={k.id} k={k} clock={clock} />)}
            </svg>
          </div>
        </Col>
        <Col xs={24} xl={6}>
          <Card size="small" title="현장 이벤트" styles={{ body: { maxHeight: 590, overflow: "auto", padding: "0 12px" } }}>
            <List size="small" dataSource={log} locale={{ emptyText: "주문을 보내면 여기에 현장 신호가 쌓입니다" }}
              renderItem={(r) => (
                <List.Item style={{ padding: "6px 0" }}>
                  <span><Tag style={{ marginRight: 6 }}>{r.time}</Tag><span style={{ color: r.color === C.text || r.color === C.sub ? undefined : r.color }}>{r.text}</span></span>
                </List.Item>
              )} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
