import { Card, Col, List, Row, Tag, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useEvents } from "../api/useEvents";
import DemoActions from "../components/DemoActions";
import { Pt, TokenShape, polyD, useTokens } from "../components/anim";

interface IfStat { if_id: string; system: string; direction: string; name: string; total: number; failed: number }
interface IfEvent { id: number; if_id: string; direction: string; source: string; target: string; status: string; name: string; key: string; detail: string; error_msg?: string }
interface Feed { id: number; time: string; e: IfEvent }

const HUB = { x: 470, y: 200, w: 260, h: 240 };
interface Node { sys: string; label: string; desc: string; x: number; y: number; side: "L" | "R" }
const NODES: Node[] = [
  { sys: "OMS", label: "OMS", desc: "주문관리", x: 120, y: 110, side: "L" },
  { sys: "로지스팟", label: "로지스팟", desc: "배차", x: 120, y: 250, side: "L" },
  { sys: "위아고", label: "위아고", desc: "전자세금계산서", x: 120, y: 390, side: "L" },
  { sys: "더존", label: "더존", desc: "재무회계", x: 120, y: 530, side: "L" },
  { sys: "MES", label: "MES", desc: "생산실행", x: 1080, y: 70, side: "R" },
  { sys: "PMS", label: "PMS", desc: "원지관리", x: 1080, y: 170, side: "R" },
  { sys: "골게터 POP", label: "골게터 POP", desc: "골판지기 CG01", x: 1080, y: 270, side: "R" },
  { sys: "인쇄 5호기", label: "인쇄 5호기", desc: "인쇄기 PR05", x: 1080, y: 370, side: "R" },
  { sys: "에볼/썬라이즈", label: "에볼/썬라이즈", desc: "가공기 EV01", x: 1080, y: 470, side: "R" },
  { sys: "오토콘", label: "오토콘", desc: "컨베이어", x: 1080, y: 570, side: "R" },
];
const NW = 190, NH = 62;

function linkPts(n: Node): Pt[] {
  const group = NODES.filter((m) => m.side === n.side);
  const i = group.indexOf(n);
  const hy = HUB.y + 30 + (i * (HUB.h - 60)) / Math.max(group.length - 1, 1);
  if (n.side === "L") return [[n.x + NW / 2, n.y], [n.x + NW / 2 + 60, n.y], [HUB.x - 40, hy], [HUB.x, hy]];
  return [[n.x - NW / 2, n.y], [n.x - NW / 2 - 60, n.y], [HUB.x + HUB.w + 40, hy], [HUB.x + HUB.w, hy]];
}

const CAT: Record<string, { color: string; label: string }> = {
  order: { color: "#3b82f6", label: "주문" }, progress: { color: "#38bdf8", label: "진도" },
  instr: { color: "#f59e0b", label: "지시" }, result: { color: "#22c55e", label: "실적" },
  paper: { color: "#d97706", label: "원지" }, move: { color: "#eab308", label: "이송" },
  logistics: { color: "#14b8a6", label: "배차" }, settle: { color: "#a855f7", label: "정산" },
};
const IF_CAT: Record<string, string> = {
  "IF-OMS-01": "order", "IF-OMS-02": "progress", "IF-OMS-03": "settle",
  "IF-MES-01": "instr", "IF-EQ-01": "instr", "IF-EQ-03": "instr", "IF-EQ-05": "instr", "IF-EXT-03": "instr", "IF-PMS-02": "instr",
  "IF-MES-02": "result", "IF-EQ-02": "result", "IF-EQ-04": "result", "IF-EQ-06": "result",
  "IF-PMS-01": "paper", "IF-EXT-04": "move", "IF-EXT-02": "logistics", "IF-EXT-01": "settle", "IF-EXT-05": "settle",
};
const MODULES: { key: string; label: string; ifs: string[] }[] = [
  { key: "sales", label: "영업", ifs: ["IF-OMS-01", "IF-OMS-02", "IF-OMS-03"] },
  { key: "sched", label: "스케쥴링", ifs: [] },
  { key: "prod", label: "생산", ifs: ["IF-MES-01", "IF-MES-02", "IF-EQ-01", "IF-EQ-02", "IF-EQ-03", "IF-EQ-04", "IF-EQ-05", "IF-EQ-06", "IF-EXT-03", "IF-EXT-04"] },
  { key: "mat", label: "자재", ifs: ["IF-PMS-01", "IF-PMS-02"] },
  { key: "qual", label: "품질", ifs: [] },
  { key: "ship", label: "출하", ifs: ["IF-EXT-02"] },
  { key: "cost", label: "원가", ifs: [] },
  { key: "acct", label: "정산", ifs: ["IF-EXT-01", "IF-EXT-05"] },
  { key: "mis", label: "경영정보", ifs: [] },
];
const STAGES: { label: string; match: (e: IfEvent | string) => boolean }[] = [
  { label: "주문 접수", match: (e) => typeof e !== "string" && e.if_id === "IF-OMS-01" },
  { label: "수주 확정", match: (e) => typeof e !== "string" && e.if_id === "IF-OMS-02" && e.detail === "수주확정" },
  { label: "생산 계획", match: (e) => e === "schedule" },
  { label: "생산 지시", match: (e) => typeof e !== "string" && ["IF-MES-01", "IF-EQ-01", "IF-EQ-03", "IF-EQ-05", "IF-PMS-02", "IF-EXT-03"].includes(e.if_id) },
  { label: "설비 가동·실적", match: (e) => typeof e !== "string" && ["IF-EQ-02", "IF-EQ-04", "IF-EQ-06", "IF-PMS-01", "IF-EXT-04"].includes(e.if_id) },
  { label: "생산 완료", match: (e) => typeof e !== "string" && (e.if_id === "IF-MES-02" || (e.if_id === "IF-OMS-02" && e.detail === "생산완료")) },
  { label: "출하·배차", match: (e) => typeof e !== "string" && e.if_id === "IF-EXT-02" },
  { label: "매출·세금계산서", match: (e) => typeof e !== "string" && ["IF-OMS-03", "IF-EXT-01"].includes(e.if_id) },
  { label: "회계 전표", match: (e) => typeof e !== "string" && e.if_id === "IF-EXT-05" },
];

const C = { bg: "#0b1220", panel: "#111a2e", line: "#1f2a44", text: "#e2e8f0", sub: "#94a3b8", erp: "#3b82f6", alarm: "#ef4444" };
const css = `
.ifm-pulse{animation:ifm-pulse 1.2s ease-out}
@keyframes ifm-pulse{0%{stroke-width:6;opacity:1}100%{stroke-width:2;opacity:.6}}
.ifm-ring{animation:ifm-ring 2.4s linear infinite;transform-box:fill-box;transform-origin:center}
@keyframes ifm-ring{to{transform:rotate(360deg)}}
`;

export default function IfFlowMap() {
  const [stats, setStats] = useState<IfStat[]>([]);
  const [feed, setFeed] = useState<Feed[]>([]);
  const [hot, setHot] = useState<Record<string, number>>({}); // 시스템/모듈/단계별 마지막 활성 시각
  const [stageCnt, setStageCnt] = useState<number[]>(() => STAGES.map(() => 0));
  const [speed, setSpeed] = useState(1);
  const [, setTick] = useState(0);
  const { tokens, clock, add } = useTokens();
  const timer = useRef<number>();
  const seq = useRef(1);

  const load = useCallback(() => api<IfStat[]>("/api/monitor/interfaces").then(setStats), []);
  const reload = useCallback(() => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => void load(), 400); }, [load]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 500); return () => clearInterval(t); }, []);

  const heat = (keys: string[]) => setHot((h) => { const n = { ...h }; keys.forEach((k) => { n[k] = Date.now(); }); return n; });
  const stage = (e: IfEvent | string) => {
    const i = STAGES.findIndex((s) => s.match(e));
    if (i < 0) return;
    setStageCnt((c) => c.map((v, j) => (j === i ? v + 1 : v)));
    heat([`stage:${i}`]);
  };

  useEvents(["if_message", "schedule", "reset"], (name, raw) => {
    if (name === "reset") { setFeed([]); setStageCnt(STAGES.map(() => 0)); setHot({}); reload(); return; }
    if (name === "schedule") { stage("schedule"); heat(["mod:sched"]); return; }
    const e = raw as IfEvent;
    if (e.status === "RECEIVED") return; // 처리 결과(PROCESSED/SENT/FAILED)만 그린다
    const sys = e.direction === "IN" ? e.source : e.target;
    const node = NODES.find((n) => n.sys === sys);
    const failed = e.status === "FAILED";
    const cat = CAT[IF_CAT[e.if_id] ?? "order"];
    if (node) {
      const pts = linkPts(node);
      const label = `${e.name}${e.key ? " " + e.key : ""}`;
      add({ pts: e.direction === "IN" ? pts : [...pts].reverse(), dur: Math.max(1100, 2200 / Math.sqrt(Math.max(speed, 1) / 2)),
        color: failed ? C.alarm : cat.color, shape: e.direction === "IN" ? "dot" : "mail", label: label.length > 26 ? label.slice(0, 25) + "…" : label });
    }
    const mod = MODULES.find((m) => m.ifs.includes(e.if_id));
    heat([`sys:${sys}`, ...(mod ? [`mod:${mod.key}`] : []), `link:${sys}`]);
    stage(e);
    setFeed((f) => [{ id: seq.current++, time: new Date().toLocaleTimeString("ko-KR", { hour12: false }), e }, ...f].slice(0, 60));
    reload();
  });

  const isHot = (k: string, ms = 1600) => Date.now() - (hot[k] ?? 0) < ms;
  const sysStat = (sys: string) => {
    const s = stats.filter((x) => x.system === sys);
    return {
      inN: s.filter((x) => x.direction === "IN").reduce((a, b) => a + b.total, 0),
      outN: s.filter((x) => x.direction === "OUT").reduce((a, b) => a + b.total, 0),
      failed: s.reduce((a, b) => a + b.failed, 0),
      ifs: s.length,
    };
  };
  const total = stats.reduce((a, b) => a + b.total, 0);
  const failedTotal = stats.reduce((a, b) => a + b.failed, 0);

  return (
    <div>
      <style>{css}</style>
      <Card size="small" style={{ marginBottom: 12 }} styles={{ body: { display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between" } }}>
        <DemoActions onSpeed={setSpeed} />
        <Typography.Text type="secondary">누적 I/F {total.toLocaleString()}건 · 실패 <span style={{ color: failedTotal ? C.alarm : undefined }}>{failedTotal}</span>건</Typography.Text>
      </Card>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {STAGES.map((s, i) => {
          const on = isHot(`stage:${i}`, 2500);
          return (
            <div key={s.label} style={{
              flex: "1 1 100px", padding: "8px 10px", borderRadius: 8, textAlign: "center", transition: "all .3s",
              background: on ? "#1d4ed8" : stageCnt[i] ? "#dbeafe" : "#f1f5f9", color: on ? "#fff" : "#0f172a",
              boxShadow: on ? "0 0 0 3px rgba(59,130,246,.35)" : undefined,
            }}>
              <div style={{ fontSize: 12, opacity: 0.8 }}>{i + 1}단계</div>
              <div style={{ fontWeight: 700 }}>{s.label}</div>
              <div style={{ fontSize: 12 }}>{stageCnt[i]}건</div>
            </div>
          );
        })}
      </div>

      <Row gutter={12}>
        <Col xs={24} xl={18}>
          <div style={{ background: C.bg, borderRadius: 10, padding: 8, overflowX: "auto" }}>
            <svg viewBox="0 0 1200 640" style={{ width: "100%", minWidth: 720, display: "block" }}>
              <text x={20} y={30} fill={C.sub} fontSize={13} fontWeight={700}>영업·물류·재무 시스템</text>
              <text x={1180} y={30} fill={C.sub} fontSize={13} fontWeight={700} textAnchor="end">공장·설비 시스템</text>

              {NODES.map((n) => {
                const pts = linkPts(n);
                const on = isHot(`link:${n.sys}`);
                return (
                  <g key={`l-${n.sys}`}>
                    <path d={polyD(pts)} stroke={on ? "#60a5fa" : C.line} strokeWidth={on ? 4 : 3} fill="none" strokeLinejoin="round" className={on ? "ifm-pulse" : ""} />
                  </g>
                );
              })}

              {/* ERP 허브 */}
              <rect x={HUB.x - 8} y={HUB.y - 8} width={HUB.w + 16} height={HUB.h + 16} rx={20} fill="none" stroke="#1e40af" strokeDasharray="4 10" className="ifm-ring" />
              <rect x={HUB.x} y={HUB.y} width={HUB.w} height={HUB.h} rx={16} fill="#172554" stroke={C.erp} strokeWidth={2} />
              <text x={HUB.x + HUB.w / 2} y={HUB.y + 32} textAnchor="middle" fill="#fff" fontSize={18} fontWeight={800}>YH 통합 ERP</text>
              <text x={HUB.x + HUB.w / 2} y={HUB.y + 52} textAnchor="middle" fill="#93c5fd" fontSize={11}>I/F 게이트웨이 · 18종 · 이력·재처리</text>
              {MODULES.map((m, i) => {
                const col = i % 3, row = Math.floor(i / 3);
                const x = HUB.x + 16 + col * 78, y = HUB.y + 72 + row * 52;
                const on = isHot(`mod:${m.key}`, 2000);
                return (
                  <g key={m.key}>
                    <rect x={x} y={y} width={72} height={40} rx={8} fill={on ? "#2563eb" : "#1e3a8a"} stroke={on ? "#bfdbfe" : "#1e40af"} style={{ transition: "all .3s" }} />
                    <text x={x + 36} y={y + 25} textAnchor="middle" fill={on ? "#fff" : "#bfdbfe"} fontSize={13} fontWeight={on ? 700 : 500}>{m.label}</text>
                  </g>
                );
              })}

              {NODES.map((n) => {
                const s = sysStat(n.sys);
                const on = isHot(`sys:${n.sys}`);
                return (
                  <g key={n.sys} transform={`translate(${n.x - NW / 2},${n.y - NH / 2})`}>
                    <rect width={NW} height={NH} rx={10} fill={C.panel} stroke={s.failed ? C.alarm : on ? "#60a5fa" : "#334155"} strokeWidth={on ? 3 : 1.5} style={{ transition: "all .3s" }} />
                    <text x={12} y={24} fill={C.text} fontSize={15} fontWeight={700}>{n.label}</text>
                    <text x={12} y={44} fill={C.sub} fontSize={11}>{n.desc} · I/F {s.ifs}종</text>
                    <text x={NW - 10} y={24} textAnchor="end" fill="#86efac" fontSize={11}>→ERP {s.inN}</text>
                    <text x={NW - 10} y={44} textAnchor="end" fill="#fcd34d" fontSize={11}>ERP→ {s.outN}</text>
                    {s.failed > 0 && <text x={NW - 10} y={58} textAnchor="end" fill={C.alarm} fontSize={10}>실패 {s.failed}</text>}
                  </g>
                );
              })}

              {/* 범례 */}
              <g transform="translate(330,612)">
                {Object.values(CAT).map((c, i) => (
                  <g key={c.label} transform={`translate(${i * 70},0)`}>
                    <circle r={6} fill={c.color} /><text x={10} y={4} fill={C.sub} fontSize={11}>{c.label}</text>
                  </g>
                ))}
                <g transform="translate(570,0)"><circle r={6} fill={C.alarm} /><text x={10} y={4} fill={C.sub} fontSize={11}>실패</text></g>
              </g>

              {tokens.map((k) => <TokenShape key={k.id} k={k} clock={clock} />)}
            </svg>
          </div>
        </Col>
        <Col xs={24} xl={6}>
          <Card size="small" title="실시간 I/F 전문" styles={{ body: { maxHeight: 640, overflow: "auto", padding: "0 12px" } }}>
            <List size="small" dataSource={feed} locale={{ emptyText: "주문을 보내면 시스템 간 전문이 여기에 흐릅니다" }}
              renderItem={({ id, time, e }) => {
                const c = CAT[IF_CAT[e.if_id] ?? "order"];
                const failed = e.status === "FAILED";
                return (
                  <List.Item key={id} style={{ padding: "6px 0" }}>
                    <div style={{ width: "100%" }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span><Tag color={failed ? "red" : undefined} style={{ borderColor: c.color, color: failed ? undefined : c.color }}>{c.label}</Tag><b>{e.if_id}</b></span>
                        <span style={{ color: "#94a3b8", fontSize: 12 }}>{time}</span>
                      </div>
                      <div style={{ fontSize: 13 }}>
                        {e.direction === "IN" ? `${e.source} → ERP` : `ERP → ${e.target}`} · {e.name}
                        {e.key && <span style={{ color: "#64748b" }}> · {e.key}</span>}
                        {e.detail && <span style={{ color: "#64748b" }}> · {e.detail}</span>}
                        {failed && <div style={{ color: C.alarm, fontSize: 12 }}>실패: {e.error_msg?.slice(0, 60)}</div>}
                      </div>
                    </div>
                  </List.Item>
                );
              }} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
