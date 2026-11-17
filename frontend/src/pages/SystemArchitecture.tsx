import { ApiOutlined, CloseOutlined, CodeOutlined } from "@ant-design/icons";
import { Button, Card, Col, Empty, Row, Space, Table, Tag, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { useEvents } from "../api/useEvents";
import { Pt, TokenShape, textW, useTokens } from "../components/anim";
import { ENVELOPE, IF_SPECS, IfSpec, MODULES, SYSTEMS, SystemDef } from "./systemSpec";

interface IfStat { if_id: string; system: string; direction: string; name: string; total: number; failed: number }
interface IfEvent { id: number; if_id: string; direction: string; source: string; target: string; status: string; name: string; key: string }
type Sel = { kind: "sys" | "mod"; key: string } | null;

// ---- 배치(viewBox 1400 x 860)
const ERP = { x: 470, y: 64, w: 430, h: 636 };
const TILE = { x: ERP.x + 16, y: ERP.y + 84, w: 126, h: 148, gap: 10 };
const GW = { x: ERP.x + 16, y: ERP.y + 84 + 3 * 148 + 2 * 10 + 14, w: ERP.w - 32, h: 66 };
const BOX: Record<string, { x: number; y: number; w: number; h: number }> = {
  OMS: { x: 30, y: 92, w: 250, h: 150 },
  MES: { x: 30, y: 294, w: 250, h: 170 },
  PMS: { x: 30, y: 516, w: 250, h: 150 },
  "골게터 POP": { x: 1100, y: 92, w: 270, h: 62 },
  "에볼/썬라이즈": { x: 1100, y: 166, w: 270, h: 62 },
  "인쇄 5호기": { x: 1100, y: 240, w: 270, h: 62 },
  위아고: { x: 1100, y: 372, w: 270, h: 62 },
  로지스팟: { x: 1100, y: 446, w: 270, h: 62 },
  오토콘: { x: 1100, y: 520, w: 270, h: 62 },
  더존: { x: 1100, y: 594, w: 270, h: 62 },
};
const GROUP = {
  legacy: { color: "#34d399", label: "사내 레거시", tag: "I/F 수정" },
  equip: { color: "#38bdf8", label: "생산 설비", tag: "기존 유지" },
  ext: { color: "#a78bfa", label: "외부 시스템", tag: "기존 유지" },
};
const IN_C = "#4ade80", OUT_C = "#fbbf24", NEW_C = "#f59e0b", ERP_C = "#60a5fa";

type Cubic = [Pt, Pt, Pt, Pt];
function cubic(a: Pt, b: Pt): Cubic {
  const mx = (a[0] + b[0]) / 2;
  return [a, [mx, a[1]], [mx, b[1]], b];
}
const cubicD = (c: Cubic) => `M${c[0][0]},${c[0][1]} C${c[1][0]},${c[1][1]} ${c[2][0]},${c[2][1]} ${c[3][0]},${c[3][1]}`;
function cubicAt(c: Cubic, t: number): Pt {
  const u = 1 - t;
  const f = (i: 0 | 1) => u * u * u * c[0][i] + 3 * u * u * t * c[1][i] + 3 * u * t * t * c[2][i] + t * t * t * c[3][i];
  return [f(0), f(1)];
}
const sample = (c: Cubic, n = 24): Pt[] => Array.from({ length: n + 1 }, (_, i) => cubicAt(c, i / n));

/** 시스템별 IN(→ERP)·OUT(ERP→) 연결선. */
function links(s: SystemDef) {
  const b = BOX[s.key];
  const left = b.x < ERP.x;
  const sy = b.y + b.h / 2;
  const ey = 382 + (sy - 382) * 0.72;
  const nx = left ? b.x + b.w : b.x, ex = left ? ERP.x : ERP.x + ERP.w;
  const inC = cubic([nx, sy - 6], [ex, ey - 6]);
  const outC = cubic([ex, ey + 6], [nx, sy + 6]);
  return { inC, outC, left };
}

function Pill({ at, text, color, dim }: { at: Pt; text: string; color: string; dim: boolean }) {
  const w = textW(text, 11) + 16;
  return (
    <g transform={`translate(${at[0]},${at[1]})`} opacity={dim ? 0.25 : 1} style={{ transition: "opacity .3s" }}>
      <rect x={-w / 2} y={-9} width={w} height={18} rx={9} fill="rgba(8,13,28,.92)" stroke={color} strokeOpacity={0.8} />
      <text textAnchor="middle" y={4} fontSize={11} fill={color} fontWeight={600}>{text}</text>
    </g>
  );
}

/** 긴 기능 목록을 폭에 맞춰 줄바꿈. */
function wrap(items: string[], width: number, size = 11) {
  const lines: string[] = [];
  let cur = "";
  items.forEach((it) => {
    const next = cur ? `${cur} · ${it}` : it;
    if (textW(next, size) > width && cur) { lines.push(cur); cur = it; } else cur = next;
  });
  if (cur) lines.push(cur);
  return lines;
}

export default function SystemArchitecture() {
  const [stats, setStats] = useState<IfStat[]>([]);
  const [sel, setSel] = useState<Sel>(null);
  const [hover, setHover] = useState<Sel>(null);
  const [hot, setHot] = useState<Record<string, number>>({});
  const [sample_, setSample] = useState<{ if_id: string; body: string } | null>(null);
  const [, setTick] = useState(0);
  const { tokens, clock, add } = useTokens();
  const timer = useRef<number>();

  const load = useCallback(() => api<IfStat[]>("/api/monitor/interfaces").then(setStats).catch(() => undefined), []);
  const reload = useCallback(() => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => void load(), 400); }, [load]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 600); return () => clearInterval(t); }, []);

  const L = useMemo(() => Object.fromEntries(SYSTEMS.map((s) => [s.key, links(s)])), []);

  useEvents(["if_message", "reset"], (name, raw) => {
    if (name === "reset") { setHot({}); reload(); return; }
    const e = raw as IfEvent;
    if (e.status === "RECEIVED") return;
    const sysKey = e.direction === "IN" ? e.source : e.target;
    const l = L[sysKey];
    if (l) {
      const failed = e.status === "FAILED";
      add({ pts: sample(e.direction === "IN" ? l.inC : l.outC), dur: 1600, color: failed ? "#ef4444" : e.direction === "IN" ? IN_C : OUT_C,
        shape: e.direction === "IN" ? "dot" : "mail", label: e.if_id.replace("IF-", "") });
      setHot((h) => ({ ...h, [sysKey]: Date.now() }));
    }
    reload();
  });

  const active = sel ?? hover;
  const sysOn = (s: SystemDef) => !active || (active.kind === "sys" ? active.key === s.key : s.modules.includes(active.key));
  const modOn = (k: string) => !active || (active.kind === "mod" ? active.key === k : SYSTEMS.find((s) => s.key === active.key)?.modules.includes(k));
  const isHot = (k: string) => Date.now() - (hot[k] ?? 0) < 1800;
  const cnt = (sys: string, dir: string) => stats.filter((x) => x.system === sys && x.direction === dir).reduce((a, b) => a + b.total, 0);
  const total = stats.reduce((a, b) => a + b.total, 0);
  const statOf = (id: string) => stats.find((s) => s.if_id === id);

  const showSample = async (if_id: string) => {
    const list = await api<{ id: number }[]>(`/api/if/messages?if_id=${if_id}&limit=1`).catch(() => []);
    if (!list.length) { setSample({ if_id, body: "아직 주고받은 전문이 없습니다. 시연에서 주문을 보내면 실제 전문이 쌓입니다." }); return; }
    const m = await api<{ payload: unknown }>(`/api/if/messages/${list[0].id}`);
    setSample({ if_id, body: JSON.stringify(m.payload, null, 2) });
  };
  const choose = (s: Sel) => { setSel(s); setSample(null); };

  return (
    <div>
      <Row gutter={12}>
        <Col xs={24} xxl={18}>
          <div style={{ borderRadius: 14, overflow: "hidden", overflowX: "auto", background: "#070d1c" }}>
            <svg viewBox="0 0 1400 860" style={{ width: "100%", minWidth: 960, display: "block" }} onClick={() => choose(null)}>
              <style>{CSS}</style>
              <defs>
                <radialGradient id="sa-bg" cx="50%" cy="40%" r="75%">
                  <stop offset="0" stopColor="#13234a" /><stop offset="1" stopColor="#070d1c" />
                </radialGradient>
                <pattern id="sa-dots" width="22" height="22" patternUnits="userSpaceOnUse">
                  <circle cx="1" cy="1" r="1" fill="#1e2b4d" />
                </pattern>
                <linearGradient id="sa-erp" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#1e3a8a" stopOpacity=".55" /><stop offset="1" stopColor="#312e81" stopOpacity=".35" />
                </linearGradient>
                <linearGradient id="sa-card" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#ffffff" stopOpacity=".09" /><stop offset="1" stopColor="#ffffff" stopOpacity=".02" />
                </linearGradient>
                <linearGradient id="sa-tile" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#2563eb" stopOpacity=".5" /><stop offset="1" stopColor="#1e3a8a" stopOpacity=".35" />
                </linearGradient>
                <linearGradient id="sa-new" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#d97706" stopOpacity=".55" /><stop offset="1" stopColor="#78350f" stopOpacity=".35" />
                </linearGradient>
                <filter id="sa-glow" x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="6" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>
              <rect width="1400" height="860" fill="url(#sa-bg)" />
              <rect width="1400" height="860" fill="url(#sa-dots)" />

              {/* 제목·범례 */}
              <text x={30} y={40} fill="#f8fafc" fontSize={22} fontWeight={800}>YH 통합 ERP 시스템 구성</text>
              <text x={30} y={62} fill="#94a3b8" fontSize={12}>레거시 10개 시스템 · I/F 18종 · 누적 전문 {total.toLocaleString()}건 — 시스템이나 모듈을 누르면 주고받는 데이터 명세가 나옵니다</text>
              <g transform="translate(905,36)">
                {[["ERP 재구축", ERP_C], ["신규 구축", NEW_C], ["레거시 I/F 수정", GROUP.legacy.color], ["설비", GROUP.equip.color], ["외부", GROUP.ext.color]].map(([l, c], i) => (
                  <g key={l} transform={`translate(${[0, 92, 172, 290, 346][i]},0)`}>
                    <rect width={12} height={12} rx={3} fill={c} y={-10} /><text x={17} fill="#cbd5e1" fontSize={12}>{l}</text>
                  </g>
                ))}
              </g>
              <text x={30} y={84} fill={GROUP.legacy.color} fontSize={13} fontWeight={700}>사내 레거시 (서브 시스템)</text>
              <text x={1100} y={84} fill={GROUP.equip.color} fontSize={13} fontWeight={700}>생산 설비</text>
              <text x={1100} y={364} fill={GROUP.ext.color} fontSize={13} fontWeight={700}>외부 시스템</text>

              {/* 연결선 */}
              {SYSTEMS.map((s) => {
                const l = L[s.key];
                const on = sysOn(s);
                const hotNow = isHot(s.key);
                const dim = !on;
                return (
                  <g key={`l-${s.key}`} opacity={dim ? 0.18 : 1} style={{ transition: "opacity .3s" }}>
                    {s.link.in && <>
                      <path d={cubicD(l.inC)} stroke={IN_C} strokeOpacity={0.25} strokeWidth={hotNow ? 6 : 4} fill="none" />
                      <path d={cubicD(l.inC)} stroke={IN_C} strokeWidth={2} fill="none" className="sa-flow" filter={active && on ? "url(#sa-glow)" : undefined} />
                    </>}
                    {s.link.out && <>
                      <path d={cubicD(l.outC)} stroke={OUT_C} strokeOpacity={0.25} strokeWidth={hotNow ? 6 : 4} fill="none" />
                      <path d={cubicD(l.outC)} stroke={OUT_C} strokeWidth={2} fill="none" className="sa-flow" filter={active && on ? "url(#sa-glow)" : undefined} />
                    </>}
                  </g>
                );
              })}
              {/* 급여 → SECOM (1차 범위 외) */}
              <g opacity={0.6}>
                <path d="M280,790 L1100,790" stroke="#64748b" strokeDasharray="6 8" strokeWidth={2} fill="none" />
                <Pill at={[690, 790]} text="근태카드 · 1차 범위 외" color="#94a3b8" dim={false} />
              </g>

              {/* ERP 본체 */}
              <g>
                <rect x={ERP.x - 10} y={ERP.y - 10} width={ERP.w + 20} height={ERP.h + 20} rx={26} fill="none" stroke="#3b82f6" strokeOpacity={0.35} strokeDasharray="4 10" className="sa-ring" />
                <rect x={ERP.x} y={ERP.y} width={ERP.w} height={ERP.h} rx={20} fill="url(#sa-erp)" stroke="#60a5fa" strokeOpacity={0.7} strokeWidth={1.5} />
                <text x={ERP.x + ERP.w / 2} y={ERP.y + 38} textAnchor="middle" fill="#fff" fontSize={22} fontWeight={800}>YH 통합 ERP</text>
                <text x={ERP.x + ERP.w / 2} y={ERP.y + 60} textAnchor="middle" fill="#93c5fd" fontSize={12}>React · FastAPI · PostgreSQL · 실시간 이벤트(SSE)</text>
                {MODULES.map((m, i) => {
                  const x = TILE.x + (i % 3) * (TILE.w + TILE.gap), y = TILE.y + Math.floor(i / 3) * (TILE.h + TILE.gap);
                  const on = modOn(m.key);
                  const isSel = sel?.kind === "mod" && sel.key === m.key;
                  const lines = wrap(m.funcs, TILE.w - 20).slice(0, 5);
                  return (
                    <g key={m.key} className="sa-hit" opacity={on ? 1 : 0.28} style={{ transition: "opacity .3s" }}
                      onClick={(e) => { e.stopPropagation(); choose({ kind: "mod", key: m.key }); }}
                      onMouseEnter={() => setHover({ kind: "mod", key: m.key })} onMouseLeave={() => setHover(null)}>
                      <rect x={x} y={y} width={TILE.w} height={TILE.h} rx={12} fill={m.scope === "new" ? "url(#sa-new)" : "url(#sa-tile)"}
                        stroke={isSel ? "#fff" : m.scope === "new" ? NEW_C : "#60a5fa"} strokeOpacity={isSel ? 1 : 0.6} strokeWidth={isSel ? 2 : 1} />
                      <text x={x + 10} y={y + 24} fill="#fff" fontSize={14} fontWeight={700}>{m.label}</text>
                      {m.phase && <text x={x + TILE.w - 10} y={y + 23} textAnchor="end" fill={m.scope === "new" ? "#fde68a" : "#bfdbfe"} fontSize={10}>{m.scope === "new" ? `신규 · ${m.phase}` : m.phase}</text>}
                      {lines.map((ln, k) => <text key={k} x={x + 10} y={y + 46 + k * 18} fill="#cbd5e1" fontSize={11}>{ln}</text>)}
                    </g>
                  );
                })}
                <g>
                  <rect x={GW.x} y={GW.y} width={GW.w} height={GW.h} rx={12} fill="#0b1530" stroke="#38bdf8" strokeOpacity={0.6} />
                  <text x={GW.x + 14} y={GW.y + 25} fill="#e0f2fe" fontSize={14} fontWeight={700}>I/F 게이트웨이</text>
                  <text x={GW.x + 120} y={GW.y + 25} fill="#7dd3fc" fontSize={11}>18종 · 이력 저장 · 실패 재처리 · 중복 차단</text>
                  <text x={GW.x + 14} y={GW.y + 48} fill="#94a3b8" fontSize={11}>공통 봉투 {`{ ${ENVELOPE.join(", ")} }`}</text>
                </g>
              </g>

              {/* 시스템 노드 */}
              {SYSTEMS.map((s) => {
                const b = BOX[s.key];
                const g = GROUP[s.group];
                const on = sysOn(s);
                const isSel = sel?.kind === "sys" && sel.key === s.key;
                const hotNow = isHot(s.key);
                const big = s.group === "legacy";
                const lines = big ? wrap(s.funcs, b.w - 36, 12).slice(0, 3) : [];
                return (
                  <g key={s.key} className="sa-hit" opacity={on ? 1 : 0.3} style={{ transition: "opacity .3s" }}
                    onClick={(e) => { e.stopPropagation(); choose({ kind: "sys", key: s.key }); }}
                    onMouseEnter={() => setHover({ kind: "sys", key: s.key })} onMouseLeave={() => setHover(null)}>
                    <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={14} fill="url(#sa-card)" stroke={g.color}
                      strokeOpacity={isSel || hotNow ? 1 : 0.55} strokeWidth={isSel ? 2.5 : hotNow ? 2.5 : 1.2} filter={hotNow ? "url(#sa-glow)" : undefined} />
                    <rect x={b.x} y={b.y + 12} width={4} height={b.h - 24} rx={2} fill={g.color} />
                    <text x={b.x + 18} y={b.y + 27} fill="#f8fafc" fontSize={big ? 18 : 15} fontWeight={800}>{s.label}</text>
                    {big && <text x={b.x + 18 + textW(s.label, 18) * 1.12 + 10} y={b.y + 27} fill="#94a3b8" fontSize={12}>{s.desc}</text>}
                    {big ? (
                      <>
                        {lines.map((ln, k) => <text key={k} x={b.x + 18} y={b.y + 54 + k * 19} fill="#cbd5e1" fontSize={12}>{ln}</text>)}
                        <text x={b.x + 18} y={b.y + b.h - 16} fill="#64748b" fontSize={11}>{s.protocol}</text>
                      </>
                    ) : (
                      <text x={b.x + 18} y={b.y + 48} fill="#94a3b8" fontSize={11}>{s.desc} · {s.funcs.join(" · ")}</text>
                    )}
                    <text x={b.x + b.w - 12} y={b.y + (big ? b.h - 34 : 27)} textAnchor="end" fill={IN_C} fontSize={11}>→ERP {cnt(s.key, "IN")}</text>
                    <text x={b.x + b.w - 12} y={b.y + (big ? b.h - 16 : 48)} textAnchor="end" fill={OUT_C} fontSize={11}>ERP→ {cnt(s.key, "OUT")}</text>
                  </g>
                );
              })}
              {/* 급여·SECOM */}
              {[["급여관리", "급여 계산 · 급여 대장", 30, 250], ["SECOM", "근태정보", 1100, 270]].map(([t, d, x, w]) => (
                <g key={t as string} opacity={0.55}>
                  <rect x={x as number} y={760} width={w as number} height={60} rx={12} fill="url(#sa-card)" stroke="#64748b" strokeDasharray="5 5" />
                  <text x={(x as number) + 18} y={786} fill="#cbd5e1" fontSize={15} fontWeight={700}>{t}</text>
                  <text x={(x as number) + 18} y={806} fill="#94a3b8" fontSize={11}>{d}</text>
                </g>
              ))}

              {/* 연결선 데이터 라벨(위에 그려 가리지 않게) */}
              {SYSTEMS.map((s) => {
                const l = L[s.key];
                const dim = !sysOn(s);
                // 노드 쪽(선 간격이 넓은 곳)에 라벨을 둔다
                const pIn = cubicAt(l.inC, 0.32), pOut = cubicAt(l.outC, 0.68);
                return (
                  <g key={`p-${s.key}`} style={{ pointerEvents: "none" }}>
                    {s.link.in && <Pill at={[pIn[0], pIn[1] - 11]} text={`${l.left ? "▸" : "◂"} ${s.link.in}`} color={IN_C} dim={dim} />}
                    {s.link.out && <Pill at={[pOut[0], pOut[1] + 11]} text={`${l.left ? "◂" : "▸"} ${s.link.out}`} color={OUT_C} dim={dim} />}
                  </g>
                );
              })}

              {tokens.map((k) => <TokenShape key={k.id} k={k} clock={clock} />)}
            </svg>
          </div>
        </Col>
        <Col xs={24} xxl={6}>
          <Detail sel={sel} statOf={statOf} sample={sample_} onSample={showSample} onClose={() => choose(null)} onPick={choose} />
        </Col>
      </Row>

      <Card size="small" title={<Space><ApiOutlined />I/F 데이터 명세 (18종)</Space>} style={{ marginTop: 12 }}
        extra={<Typography.Text type="secondary">방향은 ERP 기준 · IN = 레거시 → ERP · OUT = ERP → 레거시</Typography.Text>}>
        <Table<IfSpec> size="small" rowKey="id" pagination={false} dataSource={IF_SPECS} scroll={{ x: 1000 }}
          onRow={(r) => ({ onClick: () => choose({ kind: "sys", key: r.system }), style: { cursor: "pointer" } })}
          rowClassName={(r) => (sel?.kind === "sys" && sel.key === r.system ? "ant-table-row-selected" : "")}
          columns={[
            { title: "I/F ID", dataIndex: "id", width: 100, render: (v) => <b>{v}</b> },
            { title: "시스템", dataIndex: "system", width: 110, render: (v) => SYSTEMS.find((s) => s.key === v)?.label ?? v },
            { title: "방향", dataIndex: "dir", width: 90, render: (v, r) => <Space size={2}><Tag color={v === "IN" ? "green" : "gold"}>{v === "IN" ? "→ ERP" : "ERP →"}</Tag>{r.callback && <Tag>콜백</Tag>}</Space> },
            { title: "데이터", dataIndex: "name", width: 160 },
            { title: "발생 시점", dataIndex: "when", width: 200 },
            { title: "주요 항목", dataIndex: "fields", render: (v: string[]) => <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#475569" }}>{v.join(", ")}</span> },
            { title: "누적", width: 80, align: "right", render: (_, r) => { const s = statOf(r.id); return <span>{s?.total ?? 0}{s?.failed ? <span style={{ color: "#ef4444" }}> / 실패 {s.failed}</span> : null}</span>; } },
          ]} />
      </Card>
    </div>
  );
}

function Detail({ sel, statOf, sample, onSample, onClose, onPick }: {
  sel: Sel; statOf: (id: string) => IfStat | undefined; sample: { if_id: string; body: string } | null;
  onSample: (id: string) => void; onClose: () => void; onPick: (s: Sel) => void;
}) {
  const close = <Button size="small" type="text" icon={<CloseOutlined />} onClick={onClose} />;
  if (!sel) {
    const inN = IF_SPECS.filter((s) => s.dir === "IN").length;
    return (
      <Card size="small" title="시스템 구성 한눈에">
        <Space direction="vertical" style={{ width: "100%" }}>
          <Typography.Text>ERP가 중심에서 <b>레거시 3개</b>(OMS·MES·PMS), <b>설비 3대</b>, <b>외부 4개</b> 시스템과 공통 봉투 규격의 I/F 18종으로 연결됩니다.</Typography.Text>
          <div><Tag color="green">→ ERP {inN}종</Tag><Tag color="gold">ERP → {IF_SPECS.length - inN}종</Tag><Tag>콜백 2종</Tag></div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            초록 선은 레거시가 ERP로 보내는 데이터(주문·실적·원지 사용), 노란 선은 ERP가 내려보내는 데이터(지시·진도·정산)입니다. 실제 전문이 오가면 선 위로 흐름이 지나갑니다.
          </Typography.Text>
          <Typography.Text strong>모듈 바로 보기</Typography.Text>
          <div>{MODULES.map((m) => <Tag key={m.key} color={m.scope === "new" ? "orange" : "blue"} style={{ cursor: "pointer", marginBottom: 4 }} onClick={() => onPick({ kind: "mod", key: m.key })}>{m.label}</Tag>)}</div>
        </Space>
      </Card>
    );
  }
  if (sel.kind === "mod") {
    const m = MODULES.find((x) => x.key === sel.key)!;
    const sys = SYSTEMS.filter((s) => s.modules.includes(m.key));
    return (
      <Card size="small" title={<Space>{m.label}<Tag color={m.scope === "new" ? "orange" : "blue"}>{m.scope === "new" ? `신규 구축${m.phase ? ` · ${m.phase}` : ""}` : "재구축"}</Tag></Space>} extra={close}>
        <Typography.Text strong>하위 기능</Typography.Text>
        <div style={{ margin: "6px 0 12px" }}>{m.funcs.map((f) => <Tag key={f} style={{ marginBottom: 4 }}>{f}</Tag>)}</div>
        <Typography.Text strong>연동 시스템</Typography.Text>
        {sys.length ? sys.map((s) => (
          <div key={s.key} style={{ marginTop: 6, cursor: "pointer" }} onClick={() => onPick({ kind: "sys", key: s.key })}>
            <b>{s.label}</b> <span style={{ color: "#64748b" }}>{s.desc}</span>
            <div style={{ fontSize: 12 }}>
              {s.link.in && <span style={{ color: "#16a34a" }}>▸ {s.link.in} </span>}
              {s.link.out && <span style={{ color: "#b45309" }}>◂ {s.link.out}</span>}
            </div>
          </div>
        )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="ERP 내부 데이터로 동작합니다" />}
      </Card>
    );
  }
  const s = SYSTEMS.find((x) => x.key === sel.key)!;
  const specs = IF_SPECS.filter((x) => x.system === s.key);
  return (
    <Card size="small" title={<Space>{s.label}<span style={{ color: "#64748b", fontWeight: 400 }}>{s.desc}</span></Space>} extra={close}
      styles={{ body: { maxHeight: 760, overflow: "auto" } }}>
      <div style={{ marginBottom: 8 }}>
        <Tag color={s.group === "legacy" ? "green" : s.group === "equip" ? "cyan" : "purple"}>{GROUP[s.group].label} · {GROUP[s.group].tag}</Tag>
        <Tag>{s.protocol}</Tag>
      </div>
      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>
        연결 모듈: {s.modules.map((k) => MODULES.find((m) => m.key === k)?.label).join(", ")}
      </div>
      {specs.map((sp) => {
        const st = statOf(sp.id);
        return (
          <div key={sp.id} style={{ border: "1px solid #e2e8f0", borderLeft: `4px solid ${sp.dir === "IN" ? "#22c55e" : "#f59e0b"}`, borderRadius: 8, padding: "8px 10px", marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span><b>{sp.id}</b> <Tag color={sp.dir === "IN" ? "green" : "gold"} style={{ marginLeft: 4 }}>{sp.dir === "IN" ? `${s.label} → ERP` : `ERP → ${s.label}`}</Tag></span>
              <span style={{ fontSize: 12, color: "#64748b" }}>{st?.total ?? 0}건</span>
            </div>
            <div style={{ fontWeight: 600, marginTop: 2 }}>{sp.name}</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>발생: {sp.when}</div>
            <div style={{ marginTop: 6 }}>{sp.fields.map((f) => <code key={f} className="sa-field">{f}</code>)}</div>
            {sp.callback && (
              <div style={{ marginTop: 4, fontSize: 12 }}>
                <span style={{ color: "#16a34a" }}>콜백 ↩ </span>{sp.callback.map((f) => <code key={f} className="sa-field">{f}</code>)}
              </div>
            )}
            <Button size="small" type="link" icon={<CodeOutlined />} style={{ padding: 0, marginTop: 4 }} onClick={() => onSample(sp.id)}>최근 전문 보기</Button>
            {sample?.if_id === sp.id && (
              <pre style={{ background: "#0f172a", color: "#e2e8f0", fontSize: 11, padding: 8, borderRadius: 6, maxHeight: 220, overflow: "auto", margin: "4px 0 0" }}>{sample.body}</pre>
            )}
          </div>
        );
      })}
    </Card>
  );
}

const CSS = `
.sa-flow{stroke-dasharray:2 12;stroke-linecap:round;animation:sa-flow 1s linear infinite}
@keyframes sa-flow{to{stroke-dashoffset:-14}}
.sa-ring{animation:sa-ring 30s linear infinite;transform-box:fill-box;transform-origin:center}
@keyframes sa-ring{to{stroke-dashoffset:-280}}
.sa-hit{cursor:pointer}
.sa-field{display:inline-block;font-size:11px;background:#f1f5f9;color:#334155;border-radius:4px;padding:0 5px;margin:0 4px 4px 0}
`;
