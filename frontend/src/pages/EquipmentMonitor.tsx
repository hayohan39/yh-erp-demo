import { AimOutlined, CloseOutlined, ReloadOutlined, SyncOutlined } from "@ant-design/icons";
import { Button, Card, Col, Descriptions, List, Progress, Row, Segmented, Space, Statistic, Tag, Tooltip, Typography } from "antd";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { api } from "../api/client";
import { useEvents } from "../api/useEvents";
import DemoActions from "../components/DemoActions";
import { Movers, Stage, webglAvailable } from "../components/three/stage";
import FactoryMap, { Factory, IfEvent, Machine } from "./FactoryMap";
import {
  CORR_SECTIONS, EV_SECTIONS, HOME, MACHINE_POS, PATH, PR_SECTIONS, Plant, V3, ZONES, boardStack, buildPlant, packet,
  palletMesh, rollMesh, setMachineState,
} from "./plant3d";

interface LogRow { id: number; time: string; text: string; color: string }
type TruckState = "NONE" | "DISPATCHED" | "LEAVING";

const C = { run: "#22c55e", idle: "#64748b", alarm: "#ef4444", erp: "#3b82f6", text: "#e2e8f0", sub: "#94a3b8" };
const PROC_KO: Record<string, string> = { CORRUGATE: "골판지기", PRINT: "인쇄", CONVERT: "가공" };
const MACHINES: { code: string; title: string; kind: string }[] = [
  { code: "CG01", title: "골판지기 CG01", kind: "골게터 POP" },
  { code: "PR05", title: "인쇄 5호기 PR05", kind: "플렉소 인쇄·슬로터" },
  { code: "EV01", title: "가공기 EV01", kind: "에볼/썬라이즈 · 다이커터·폴더글루어" },
];
const SECTIONS: Record<string, { label: string; x: number }[]> = { CG01: CORR_SECTIONS, PR05: PR_SECTIONS, EV01: EV_SECTIONS };
const SECTION_Z: Record<string, number> = { CG01: -13, PR05: 10, EV01: 20 };

// ERP ↔ 설비 데이터 패킷이 내려앉는 지점
const IF_SPOT: Record<string, V3> = {
  "IF-EQ-01": [0, 4, -13], "IF-EQ-02": [0, 4, -13], "IF-EQ-05": [30, 3, 10], "IF-EQ-06": [30, 3, 10],
  "IF-EQ-03": [6, 3, 20], "IF-EQ-04": [6, 3, 20], "IF-PMS-01": [-55, 3, -20], "IF-PMS-02": [-55, 3, -20],
  "IF-EXT-03": [54, 2, 0], "IF-EXT-04": [54, 2, 0], "IF-EXT-02": [-55, 3, 19],
};
const FOCUS: Record<string, V3> = {
  ...Object.fromEntries(Object.entries(MACHINE_POS).map(([k, v]) => [k, v.focus])),
  ROLL: [-55, 0, -20], FG: [-28, 0, 16], WIP: [56, 0, 0],
};

const ZONE_LABEL: Record<string, V3> = {
  ROLL: [-55, 0.3, -2], CORR: [26, 0.3, -20], WIP: [60, 0.3, 24], CONV: [32, 0.3, 25], FG: [-28, 0.3, 29], SHIP: [-55, 0.3, 33],
};

function progressOf(m: Machine | undefined, speed: number, offset: number) {
  if (!m?.current) return null;
  const started = Date.parse(m.current.started_at + "Z");
  const elapsed = (Date.now() - offset - started) / 1000;
  return Math.min(Math.max(elapsed / (m.current.expected_minutes / Math.max(speed, 0.1)), 0.02), 0.98);
}

export default function EquipmentMonitor() {
  const gl = webglAvailable();
  const [view, setView] = useState<"3d" | "2d">(gl ? "3d" : "2d");
  const toggle = (
    <Segmented value={view} onChange={(v) => setView(v as "3d" | "2d")}
      options={[{ label: "3D 디지털 트윈", value: "3d", disabled: !gl }, { label: "평면도", value: "2d" }]} />
  );
  if (view === "2d") return <FactoryMap extra={toggle} />;
  return <Equipment3D toggle={toggle} />;
}

function Equipment3D({ toggle }: { toggle: ReactNode }) {
  const [f, setF] = useState<Factory>();
  const [speed, setSpeed] = useState(1);
  const [offset, setOffset] = useState(0);
  const [flash, setFlash] = useState<Record<string, number>>({});
  const [log, setLog] = useState<LogRow[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [glKey, setGlKey] = useState(0); // WebGL 컨텍스트가 끊기면 올려서 무대를 새로 만든다
  const [, setTick] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage>();
  const plant = useRef<Plant>();
  const movers = useRef<Movers>();
  const labelEls = useRef(new Map<string, { el: HTMLElement; pos: V3; maxDist?: number }>());
  const live = useRef<{ states: Record<string, "RUN" | "IDLE" | "ALARM">; pile: number; truck: TruckState; truckT: number }>(
    { states: {}, pile: 0, truck: "NONE", truckT: 0 });
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

  // ---- 3D 무대 생성(한 번)
  useEffect(() => {
    if (!host.current) return;
    const s = new Stage(host.current, { camera: HOME.camera, target: HOME.target, background: "#0b1220", fog: [140, 260] });
    const p = buildPlant(s);
    const mv = new Movers(s.scene);
    stage.current = s; plant.current = p; movers.current = mv;
    s.onContextLost = () => setGlKey((k) => k + 1);
    labelEls.current.forEach((v, id) => s.setLabel(id, v.el, v.pos, v.maxDist));
    s.onPick = (id) => {
      setSel(id);
      if (id && FOCUS[id]) s.flyTo(FOCUS[id], id === "CG01" ? 62 : 36);
    };
    const leave = PATH.truckLeave.map((q) => new THREE.Vector3(...q));
    s.tick((dt, t) => {
      const L = live.current;
      const blink = Math.floor(t * 2.5) % 2 === 0;
      for (const [code, rig] of Object.entries(p.rigs)) {
        const st = L.states[code] ?? "IDLE";
        setMachineState(rig, st, blink);
        if (st === "IDLE") continue;
        rig.spin.forEach((o) => o.rotateY(dt * 4));
        rig.slats?.forEach((o) => { o.position.x += dt * 3.2; if (o.position.x > -3.5) o.position.x -= 16.2; });
        if (rig.press) rig.press.position.y = 1.8 + Math.abs(Math.sin(t * 4)) * 0.5;
      }
      const pile = p.rigs.CG01.pile;
      if (pile) { const h = 0.15 + L.pile * 2.2; pile.scale.y = h; pile.position.y = h / 2; }
      // 트럭: 배차 확정 → 도크에 정차, 상차 완료 → 출발
      if (L.truck === "NONE") p.truck.visible = false;
      else {
        p.truck.visible = true;
        if (L.truck === "DISPATCHED") { p.truck.position.set(-76, 0, 19); p.truck.rotation.y = Math.PI; }
        else {
          L.truckT = Math.min(L.truckT + dt / 4, 1);
          const k = L.truckT;
          const pos = new THREE.Vector3();
          const i = k < 0.5 ? 0 : 1, kk = k < 0.5 ? k * 2 : (k - 0.5) * 2;
          pos.lerpVectors(leave[i], leave[i + 1], kk);
          p.truck.position.copy(pos);
          p.truck.rotation.y = Math.PI / 2 + Math.PI;
        }
      }
      mv.step(t);
    });
    return () => { s.dispose(); stage.current = undefined; };
  }, [glKey]);

  useEffect(() => { if (stage.current) stage.current.autoRotate = spinning; }, [spinning]);

  const label = (id: string, pos: V3, maxDist?: number) => (el: HTMLDivElement | null) => {
    if (el) labelEls.current.set(id, { el, pos, maxDist }); else labelEls.current.delete(id);
    stage.current?.setLabel(id, el, pos, maxDist);
  };

  // ---- 데이터 → 장면 상태
  const mm = Object.fromEntries((f?.machines ?? []).map((m) => [m.code, m])) as Record<string, Machine>;
  const isFlash = (code: string) => Date.now() - (flash[code] ?? 0) < 8000;
  const stateOf = (code: string) => (isFlash(code) || (mm[code]?.open_defects ?? 0) > 0 ? "ALARM" : mm[code]?.status === "RUN" ? "RUN" : "IDLE");
  MACHINES.forEach(({ code }) => { live.current.states[code] = stateOf(code); });
  live.current.pile = progressOf(mm.CG01, speed, offset) ?? (mm.CG01?.done ? 0.15 : 0);
  useEffect(() => {
    if (!f || !plant.current) return;
    plant.current.setRolls(f.papers);
    plant.current.setPallets(Math.ceil(f.products.total_qty / 2500));
    plant.current.setWip(f.conveyor.in_transit);
  }, [f]);

  // ---- 실시간 이벤트 → 이동 물체·로그
  const addLog = (text: string, color: string) =>
    setLog((l) => [{ id: logSeq.current++, time: new Date().toLocaleTimeString("ko-KR", { hour12: false }), text, color }, ...l].slice(0, 40));
  const dur = (base: number) => Math.max(1.2, base / Math.sqrt(Math.max(speed, 1) / 2));
  const move = (obj: THREE.Object3D, pts: V3[], base: number, delay = 0) => movers.current?.add(obj, pts, dur(base), delay);
  const drop = (spot: V3, out: boolean, failed: boolean) => {
    const color = failed ? C.alarm : out ? "#f59e0b" : C.run;
    const top: V3 = [spot[0], 24, spot[2]];
    move(packet(color), out ? [top, spot] : [spot, top], 1.4);
  };

  useEvents(["if_message", "production", "defect", "work_order", "shipment", "invoice", "reset"], (name, raw) => {
    const d = raw as Record<string, string>;
    if (name === "reset") { setLog([]); live.current.truck = "NONE"; reload(); return; }
    if (name === "if_message") {
      const e = raw as IfEvent;
      if (e.status === "RECEIVED") return;
      const failed = e.status === "FAILED";
      const spot = IF_SPOT[e.if_id];
      if (spot) drop(spot, e.direction === "OUT", failed);
      if (e.if_id === "IF-PMS-01") {
        [0, 0.35, 0.7].forEach((delay) => move(rollMesh(), PATH.rollToStand, 2.2, delay));
        addLog(`PMS 원지 롤 3개 투입 (${e.key})`, "#d97706");
      }
      if (e.if_id === "IF-MES-01") addLog(`ERP → MES 생산지시 ${e.key}`, C.erp);
      if (e.if_id === "IF-EQ-01") addLog("ERP → 골게터 POP 원단 생산지시", "#f59e0b");
      if (e.if_id === "IF-OMS-01") addLog("OMS 신규 주문 수신", C.erp);
      if (failed) addLog(`I/F 실패 ${e.if_id} ${e.name}`, C.alarm);
      reload();
      return;
    }
    if (name === "production") {
      const proc = d.process;
      if (proc === "TRANSFER") {
        const toPrint = d.next_process === "PRINT";
        move(boardStack(1.1), toPrint ? PATH.toPrint : PATH.toConvert, toPrint ? 3.6 : 4.4);
        addLog(`오토콘: ${d.wo_no} 원단 ${Number(d.sheets).toLocaleString()}매 이송 → ${toPrint ? "인쇄 5호기" : "가공기"}`, "#eab308");
      } else if (proc === "DONE") {
        move(palletMesh(), PATH.convertToFg, 2.6);
        addLog(`${d.wo_no} 생산 완료 → 결속·팔레타이징 → 제품 창고`, C.run);
      } else if (d.event === "START") {
        addLog(`${PROC_KO[proc] ?? proc} 가동 시작: ${d.wo_no}`, C.text);
      } else {
        if (proc === "PRINT") move(boardStack(1, "#d6b27a"), PATH.printToConvert, 2.2);
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
        live.current.truck = "DISPATCHED";
        addLog(`로지스팟 배차 확정: ${d.vehicle_no} 도크 도착`, "#14b8a6");
      }
      if (d.status === "SHIPPED") {
        [0, 0.4, 0.8].forEach((delay) => move(palletMesh(), PATH.fgToTruck, 2, delay));
        live.current.truck = "DISPATCHED";
        window.setTimeout(() => { live.current.truck = "LEAVING"; live.current.truckT = 0; }, dur(2) * 1000 + 900);
        window.setTimeout(() => { live.current.truck = "NONE"; }, dur(2) * 1000 + 5500);
        addLog(`상차 완료·출발: ${d.vehicle_no} ${Number(d.qty).toLocaleString()}매`, "#14b8a6");
      }
    }
    if (name === "invoice") addLog(`세금계산서 발행 완료 ${d.invoice_no}`, "#a855f7");
    reload();
  });

  const wos = f?.work_orders;
  const home = () => { setSel(null); stage.current?.flyHome(HOME.camera, HOME.target); };
  const choose = (id: string) => { setSel(id); if (FOCUS[id]) stage.current?.flyTo(FOCUS[id], id === "CG01" ? 62 : 36); };

  return (
    <div>
      <Card size="small" style={{ marginBottom: 12 }} styles={{ body: { display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between" } }}>
        <DemoActions onSpeed={setSpeed} />
        {toggle}
      </Card>
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        {[
          ["생산지시 진행", `${wos?.in_prod ?? 0} / ${wos?.total ?? 0}`, "건"],
          ["생산 완료", wos?.done ?? 0, "건"],
          ["설비 가동", `${(f?.machines ?? []).filter((m) => m.status === "RUN").length} / ${f?.machines.length ?? 3}`, "대"],
          ["원지 투입", (f?.paper_used_kg ?? 0).toLocaleString(), "kg"],
          ["제품 재고", (f?.products.total_qty ?? 0).toLocaleString(), "매"],
        ].map(([t, v, u]) => (
          <Col key={t as string} flex="1 1 150px">
            <Card size="small"><Statistic title={t} value={v as string} suffix={u} /></Card>
          </Col>
        ))}
      </Row>
      <Row gutter={12}>
        <Col xs={24} xl={18}>
          <div ref={host} style={{ position: "relative", isolation: "isolate", height: "min(66vh, 640px)", minHeight: 420, borderRadius: 10, overflow: "hidden", background: "#0b1220" }}>
            <style>{LABEL_CSS}</style>
            {/* 구역 라벨 */}
            {ZONES.map((z) => (
              <div key={z.code} ref={label(`z:${z.code}`, ZONE_LABEL[z.code])}
                className="pl-zone" style={{ borderColor: z.color, color: z.color }}>
                {z.label}
                {z.code === "ROLL" && f && <b> · {Math.round(f.papers.reduce((a, p) => a + p.stock_kg, 0) / 1000).toLocaleString()}t</b>}
                {z.code === "FG" && f && <b> · {f.products.total_qty.toLocaleString()}매</b>}
                {z.code === "WIP" && f && <b> · 이송 {f.conveyor.in_transit}건</b>}
              </div>
            ))}
            {/* 세부 공정 라벨(가까이 볼 때만) */}
            {Object.entries(SECTIONS).flatMap(([code, list]) => list.map((s) => (
              <div key={`${code}-${s.label}`} ref={label(`s:${code}:${s.label}`, [s.x, 0.4, SECTION_Z[code] + 3.2], 80)} className="pl-sec">{s.label}</div>
            )))}
            {/* 설비 상태 카드 */}
            {MACHINES.map(({ code, title, kind }) => {
              const m = mm[code];
              const st = stateOf(code);
              const p = progressOf(m, speed, offset);
              const color = st === "ALARM" ? C.alarm : st === "RUN" ? C.run : C.idle;
              return (
                <div key={code} ref={label(`m:${code}`, MACHINE_POS[code].label)} className="pl-card"
                  style={{ borderColor: color, boxShadow: st !== "IDLE" ? `0 0 18px ${color}66` : undefined }}
                  onClick={() => choose(code)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className={st === "ALARM" ? "pl-dot pl-blink" : "pl-dot"} style={{ background: color }} />
                    <b>{title}</b>
                    <span style={{ marginLeft: "auto", color, fontWeight: 700 }}>{st === "ALARM" ? "경보" : st === "RUN" ? "가동" : "대기"}</span>
                  </div>
                  <div className="pl-sub">{kind}</div>
                  {m?.current ? (
                    <>
                      <div>{m.current.wo_no} · {m.current.item_name.slice(0, 14)}</div>
                      <div className="pl-bar"><i style={{ width: `${(p ?? 0) * 100}%`, background: color }} /></div>
                      <div className="pl-sub">{Math.round((p ?? 0) * 100)}% · 투입 {m.current.qty.toLocaleString()}매 · 대기 {m.queue}건</div>
                    </>
                  ) : <div className="pl-sub">대기 {m?.queue ?? 0}건 · 완료 {m?.done ?? 0}건</div>}
                  <div className="pl-sub">양품 {(m?.good_qty ?? 0).toLocaleString()} · 불량률 <span style={{ color: (m?.defect_rate ?? 0) >= 0.03 ? C.alarm : undefined }}>{((m?.defect_rate ?? 0) * 100).toFixed(1)}%</span></div>
                </div>
              );
            })}
            {/* 조작 */}
            <div style={{ position: "absolute", left: 12, top: 12, display: "flex", gap: 6, zIndex: 2000 }}>
              <Tooltip title="전체 보기"><Button size="small" icon={<AimOutlined />} onClick={home}>전체</Button></Tooltip>
              <Button size="small" type={spinning ? "primary" : "default"} icon={<SyncOutlined spin={spinning} />} onClick={() => setSpinning((x) => !x)}>자동 회전</Button>
              {MACHINES.map((m) => <Button key={m.code} size="small" onClick={() => choose(m.code)}>{m.code}</Button>)}
            </div>
            <div className="pl-legend">
              <span><i style={{ background: C.run }} />가동</span><span><i style={{ background: "#f59e0b" }} />대기</span>
              <span><i style={{ background: C.alarm }} />경보</span>
              <span><i style={{ background: "#f59e0b", borderRadius: 9 }} />ERP→설비 지시</span>
              <span><i style={{ background: C.run, borderRadius: 9 }} />설비→ERP 실적</span>
              <span style={{ opacity: 0.7 }}>드래그: 회전 · 휠: 확대 · 설비 클릭: 상세</span>
            </div>
          </div>
        </Col>
        <Col xs={24} xl={6}>
          <Detail sel={sel} f={f} mm={mm} stateOf={stateOf} speed={speed} offset={offset} onClose={home} />
          <Card size="small" title="현장 이벤트" style={{ marginTop: 12 }} styles={{ body: { maxHeight: sel ? 300 : 520, overflow: "auto", padding: "0 12px" } }}>
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

function Detail({ sel, f, mm, stateOf, speed, offset, onClose }: {
  sel: string | null; f?: Factory; mm: Record<string, Machine>; stateOf: (c: string) => string; speed: number; offset: number; onClose: () => void;
}) {
  if (!sel) {
    return (
      <Card size="small" title="설비 상세">
        <Typography.Text type="secondary">3D 화면에서 설비나 창고를 누르면 실시간 상세가 여기에 나옵니다.</Typography.Text>
        <div style={{ marginTop: 8, fontSize: 12, color: "#64748b" }}>
          배치는 실제 골판지 상자 공장의 U자 흐름을 따랐습니다: 원지 창고 → 골판지기(웻엔드·드라이엔드) → 오토콘 → 인쇄 → 가공 → 제품 창고 → 출하 도크.
        </div>
      </Card>
    );
  }
  const extra = <Button size="small" type="text" icon={<CloseOutlined />} onClick={onClose} />;
  const m = mm[sel];
  if (m) {
    const st = stateOf(sel);
    const p = progressOf(m, speed, offset);
    return (
      <Card size="small" title={MACHINES.find((x) => x.code === sel)?.title} extra={extra}>
        <Space style={{ marginBottom: 8 }}>
          <Tag color={st === "ALARM" ? "red" : st === "RUN" ? "green" : "default"}>{st === "ALARM" ? "경보" : st === "RUN" ? "가동" : "대기"}</Tag>
          <Tag>{m.legacy_system}</Tag>
        </Space>
        {m.current && <Progress percent={Math.round((p ?? 0) * 100)} size="small" status={st === "ALARM" ? "exception" : "active"} />}
        <Descriptions size="small" column={1} style={{ marginTop: 8 }} items={[
          { label: "작업", children: m.current ? `${m.current.wo_no} · ${m.current.item_name}` : "없음" },
          { label: "투입", children: m.current ? `${m.current.qty.toLocaleString()}매` : "-" },
          { label: "대기/완료", children: `${m.queue}건 / ${m.done}건` },
          { label: "양품/불량", children: `${m.good_qty.toLocaleString()} / ${m.defect_qty.toLocaleString()}` },
          { label: "불량률", children: <span style={{ color: m.defect_rate >= 0.03 ? C.alarm : undefined }}>{(m.defect_rate * 100).toFixed(2)}%</span> },
          { label: "미조치 불량", children: `${m.open_defects}건` },
          { label: "세부 공정", children: SECTIONS[sel].map((s) => s.label).join(" → ") },
        ]} />
      </Card>
    );
  }
  if (sel === "ROLL") {
    return (
      <Card size="small" title="원지 창고 (PMS)" extra={extra}>
        {(f?.papers ?? []).map((p) => (
          <div key={p.code} style={{ marginBottom: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}><span>{p.name}</span><span>{Math.round(p.stock_kg).toLocaleString()}kg</span></div>
            <Progress percent={Math.round((p.stock_kg / p.opening_kg) * 100)} size="small" showInfo={false} strokeColor={p.stock_kg / p.opening_kg < 0.5 ? "#f97316" : "#d97706"} />
          </div>
        ))}
      </Card>
    );
  }
  if (sel === "FG") {
    return (
      <Card size="small" title="제품 창고" extra={extra}>
        <Statistic title="총 재고" value={f?.products.total_qty ?? 0} suffix="매" />
        <List size="small" dataSource={f?.products.items ?? []} locale={{ emptyText: "재고 없음" }}
          renderItem={(s) => <List.Item style={{ padding: "4px 0" }}><span>{s.item_name}</span><b>{s.qty.toLocaleString()}</b></List.Item>} />
      </Card>
    );
  }
  return (
    <Card size="small" title="오토콘 원단 대기장" extra={extra}>
      <Statistic title="컨베이어 이송·대기 중" value={f?.conveyor.in_transit ?? 0} suffix="건" prefix={<ReloadOutlined />} />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>골판지기에서 나온 원단을 인쇄기 또는 가공기로 자동 반송합니다(IF-EXT-03/04).</Typography.Text>
    </Card>
  );
}

const LABEL_CSS = `
.pl-zone,.pl-sec,.pl-card{position:absolute;left:0;top:0;will-change:transform;white-space:nowrap}
.pl-zone{font-size:12px;font-weight:700;padding:2px 10px;border:1px solid;border-radius:999px;background:rgba(11,18,32,.75);pointer-events:none}
.pl-sec{font-size:11px;color:#cbd5e1;padding:1px 6px;border-radius:4px;background:rgba(15,23,42,.7);pointer-events:none}
.pl-card{min-width:190px;font-size:12px;color:#e2e8f0;padding:8px 10px;border-radius:10px;border:1.5px solid;background:rgba(15,23,42,.86);backdrop-filter:blur(4px);cursor:pointer;transition:box-shadow .3s}
.pl-card:hover{background:rgba(30,41,59,.95)}
.pl-sub{color:#94a3b8;font-size:11px}
.pl-dot{width:9px;height:9px;border-radius:9px;display:inline-block}
.pl-blink{animation:pl-blink .8s step-start infinite}
@keyframes pl-blink{50%{opacity:.2}}
.pl-bar{height:6px;border-radius:6px;background:#1e293b;margin:4px 0 2px;overflow:hidden}
.pl-bar i{display:block;height:100%;border-radius:6px;transition:width .5s}
.pl-legend{position:absolute;left:12px;bottom:10px;display:flex;flex-wrap:wrap;gap:12px;font-size:11px;color:#cbd5e1;z-index:2000;pointer-events:none}
.pl-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
`;
