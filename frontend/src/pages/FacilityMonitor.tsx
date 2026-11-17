import { AimOutlined, CloseOutlined, SyncOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Col, List, Row, Statistic, Tag, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { api } from "../api/client";
import { Movers, Stage, box, cyl, mat, stackLight, webglAvailable, zone } from "../components/three/stage";

type V3 = [number, number, number];

interface Metric { key: string; label: string; value: number; unit: string; lo: number | null; hi: number | null }
interface Facility { code: string; name: string; desc: string; active: boolean; status: "OK" | "WARN"; metrics: Metric[] }
interface FacilityResp {
  server_time: string; load: number; running: string[];
  energy: { power_kw: number; steam_tph: number; air_m3min: number; gas_nm3h: number; cost_per_hour: number };
  facilities: Facility[];
}

/** 시설 배치: 본관(생산동)을 가운데 두고 유틸리티 동을 둘레에 둔 일반적인 골판지 공장 부지. */
const SITE: Record<string, { pos: V3; label: V3; color: string }> = {
  BOILER: { pos: [-60, 0, -48], label: [-60, 16, -48], color: "#f97316" },
  STARCH: { pos: [-30, 0, -48], label: [-30, 11, -48], color: "#eab308" },
  AIR: { pos: [0, 0, -48], label: [0, 10, -48], color: "#22d3ee" },
  ELEC: { pos: [30, 0, -48], label: [30, 11, -48], color: "#facc15" },
  WASTE: { pos: [60, 0, -46], label: [60, 15, -46], color: "#a3a3a3" },
  WATER: { pos: [70, 0, 6], label: [70, 5, 6], color: "#38bdf8" },
  ROLL_WH: { pos: [-38, 0, -14], label: [-38, 6, -14], color: "#d97706" },
  FG_WH: { pos: [-38, 0, 16], label: [-38, 6, 16], color: "#22c55e" },
  SAFETY: { pos: [-50, 0, 46], label: [-50, 5, 46], color: "#ef4444" },
};
const HOME = { camera: [0, 96, 108] as V3, target: [0, 0, -6] as V3 };
/** 시설 → 본관으로 이어지는 배관·전력선(가동 중이면 흐름 입자가 흐른다). */
const LINES: { from: string; color: string; pts: V3[] }[] = [
  { from: "BOILER", color: "#fb923c", pts: [[-56, 6, -42], [-56, 6, -36], [-20, 6, -36], [-20, 6, -28]] },
  { from: "STARCH", color: "#fde047", pts: [[-30, 4, -42], [-30, 4, -33], [-8, 4, -33], [-8, 4, -28]] },
  { from: "AIR", color: "#67e8f9", pts: [[0, 3, -43], [0, 3, -34], [12, 3, -34], [12, 3, -28]] },
  { from: "ELEC", color: "#fef08a", pts: [[30, 7, -43], [30, 7, -35], [26, 7, -35], [26, 7, -28]] },
  { from: "WASTE", color: "#d4d4d4", pts: [[40, 5, -28], [40, 5, -38], [60, 5, -38], [60, 9, -44]] },
  { from: "WATER", color: "#7dd3fc", pts: [[50, 2, 6], [64, 2, 6]] },
];

function building(w: number, h: number, d: number, x: number, z: number, color = "#334155", roof = "#475569") {
  const g = new THREE.Group();
  g.add(box(w, h, d, color, x, 0, z));
  g.add(box(w + 0.6, 0.4, d + 0.6, roof, x, h, z));
  return g;
}

interface Rig { beacon: THREE.MeshBasicMaterial; ring: THREE.Mesh; level?: THREE.Mesh; smoke?: THREE.Mesh[]; fans?: THREE.Object3D[]; light?: ReturnType<typeof stackLight> }

function buildSite(stage: Stage) {
  const { scene } = stage;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(190, 130), new THREE.MeshLambertMaterial({ color: "#13203a" }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const grid = new THREE.GridHelper(190, 38, "#1e2c47", "#172238");
  grid.position.y = 0.01;
  scene.add(grid);
  // 부지 도로
  scene.add(box(190, 0.04, 8, "#1f2937", 0, 0, 36));
  scene.add(box(8, 0.04, 130, "#1f2937", -78, 0, 0));

  // 본관(생산동): 반투명 외피 + 내부 설비 실루엣
  const shell = new THREE.Mesh(new THREE.BoxGeometry(100, 12, 58),
    new THREE.MeshLambertMaterial({ color: "#60a5fa", transparent: true, opacity: 0.08, depthWrite: false }));
  shell.position.set(0, 6, 1);
  scene.add(shell);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(100, 12, 58)),
    new THREE.LineBasicMaterial({ color: "#60a5fa", transparent: true, opacity: 0.5 }));
  edges.position.copy(shell.position);
  scene.add(edges);
  scene.add(zone(-50, -28, 50, 30, "#3b82f6", 0.06));
  scene.add(box(70, 2.6, 3.4, "#475569", 5, 0, -13)); // 골판지기 실루엣
  scene.add(box(18, 2.8, 3.6, "#5b4a86", 28, 0, 8)); // 인쇄기
  scene.add(box(16, 2.6, 3.6, "#7c4a1e", 6, 0, 18)); // 가공기
  // 창고 동(본관 안 왼쪽)
  for (let k = 0; k < 24; k++) scene.add(cyl(0.75, 1.8, "#9a6534", "y", -46 + (k % 6) * 2.2, 0.9, -24 + Math.floor(k / 6) * 3, 12));
  for (let k = 0; k < 18; k++) scene.add(box(1.6, 1.4, 1.6, "#c08a3e", -46 + (k % 6) * 2.4, 0, 8 + Math.floor(k / 6) * 4));

  const rigs: Record<string, Rig> = {};
  const beacon = (code: string, y: number) => {
    const [x, , z] = SITE[code].pos;
    const m = new THREE.MeshBasicMaterial({ color: "#22c55e" });
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.7, 14, 10), m);
    s.position.set(x, y, z);
    scene.add(s);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.5, 4, 40),
      new THREE.MeshBasicMaterial({ color: SITE[code].color, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.05, z);
    scene.add(ring);
    return { beacon: m, ring };
  };
  const group = (code: string, g: THREE.Group) => { scene.add(g); stage.pickable(g, code); };

  // 보일러실: 노통연관식 보일러 2기 + 굴뚝 + 연기
  {
    const [x, , z] = SITE.BOILER.pos;
    const g = new THREE.Group();
    g.add(building(7, 7, 12, x - 5, z, "#3f3f46", "#52525b"));
    for (const dz of [-2.4, 2.4]) {
      g.add(cyl(1.6, 7, "#b45309", "x", x + 4, 2, z + dz));
      g.add(box(0.4, 0.4, 3.4, "#57534e", x + 2, 0, z + dz));
      g.add(box(0.4, 0.4, 3.4, "#57534e", x + 6, 0, z + dz));
    }
    const stack = cyl(0.9, 16, "#71717a", "y", x + 6, 8, z - 7);
    g.add(stack);
    group("BOILER", g);
    const smoke: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshLambertMaterial({ color: "#e2e8f0", transparent: true, opacity: 0.35, depthWrite: false }));
      s.position.set(x + 6, 16 + i * 2, z - 7);
      s.userData.phase = i / 6;
      scene.add(s);
      smoke.push(s);
    }
    rigs.BOILER = { ...beacon("BOILER", 9), smoke };
  }
  // 전분 조리실: 조리 탱크 + 저장 탱크(수위 표시)
  {
    const [x, , z] = SITE.STARCH.pos;
    const g = new THREE.Group();
    g.add(building(10, 5, 10, x - 3, z, "#3f3f46", "#52525b"));
    g.add(cyl(1.4, 4, "#94a3b8", "y", x - 3, 7, z));
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 7, 24),
      new THREE.MeshLambertMaterial({ color: "#e2e8f0", transparent: true, opacity: 0.25, depthWrite: false }));
    tank.position.set(x + 5, 3.5, z);
    g.add(tank);
    const level = cyl(2.05, 1, "#fde047", "y", x + 5, 0.5, z);
    g.add(level);
    group("STARCH", g);
    rigs.STARCH = { ...beacon("STARCH", 9), level };
  }
  // 공기압축기실: 스크루 압축기 3대 + 리시버 탱크
  {
    const [x, , z] = SITE.AIR.pos;
    const g = new THREE.Group();
    g.add(building(12, 4.5, 9, x, z, "#334155", "#475569"));
    const fans: THREE.Object3D[] = [];
    for (let i = 0; i < 3; i++) {
      g.add(box(2.6, 2.4, 2.6, "#0e7490", x - 4 + i * 4, 4.9, z));
      const fan = box(2, 0.1, 0.4, "#cffafe", x - 4 + i * 4, 7.4, z);
      fans.push(fan); g.add(fan);
    }
    g.add(cyl(1.1, 5, "#64748b", "y", x + 8, 2.5, z + 2));
    group("AIR", g);
    rigs.AIR = { ...beacon("AIR", 9), fans };
  }
  // 수배전실: 변압기 + 큐비클
  {
    const [x, , z] = SITE.ELEC.pos;
    const g = new THREE.Group();
    g.add(building(10, 4, 8, x - 2, z, "#334155", "#475569"));
    for (let i = 0; i < 2; i++) {
      g.add(box(2.4, 3, 2.4, "#4b5563", x + 6, 0, z - 2.5 + i * 5));
      for (let k = 0; k < 4; k++) g.add(box(0.12, 2.4, 2.6, "#9ca3af", x + 4.9 + k * 0.7, 0.3, z - 2.5 + i * 5));
    }
    g.add(box(0.3, 9, 0.3, "#94a3b8", x + 10, 0, z));
    g.add(box(4, 0.2, 0.2, "#94a3b8", x + 10, 8.5, z));
    group("ELEC", g);
    rigs.ELEC = { ...beacon("ELEC", 7) };
  }
  // 파지 집진·베일러: 사이클론 + 베일러 + 베일 더미
  {
    const [x, , z] = SITE.WASTE.pos;
    const g = new THREE.Group();
    for (const dx of [-2, 2]) for (const dz of [-2, 2]) g.add(box(0.3, 7, 0.3, "#64748b", x + dx, 0, z + dz));
    g.add(cyl(2.4, 3, "#a1a1aa", "y", x, 9.5, z));
    const cone = new THREE.Mesh(new THREE.ConeGeometry(2.4, 3.5, 20), new THREE.MeshLambertMaterial({ color: "#a1a1aa" }));
    cone.rotation.x = Math.PI;
    cone.position.set(x, 6.25, z);
    g.add(cone);
    g.add(box(7, 2.6, 3, "#4d7c0f", x + 8, 0, z));
    for (let i = 0; i < 6; i++) g.add(box(1.6, 1.2, 1.2, "#a8a29e", x + 5 + (i % 3) * 1.8, Math.floor(i / 3) * 1.2, z + 4));
    group("WASTE", g);
    rigs.WASTE = { ...beacon("WASTE", 13) };
  }
  // 폐수 처리장: 원형 수조
  {
    const [x, , z] = SITE.WATER.pos;
    const g = new THREE.Group();
    for (const [dx, dz, r] of [[-3, -4, 3], [3, -4, 3], [0, 4, 3.6]] as [number, number, number][]) {
      g.add(cyl(r, 2.2, "#475569", "y", x + dx, 1.1, z + dz));
      g.add(cyl(r - 0.3, 0.1, "#0ea5e9", "y", x + dx, 2.21, z + dz));
    }
    group("WATER", g);
    rigs.WATER = { ...beacon("WATER", 5) };
  }
  // 창고 환경 센서(본관 안), 안전(정문 경비실)
  {
    const g1 = new THREE.Group();
    g1.add(box(1, 3, 1, "#d97706", -38, 0, -14));
    group("ROLL_WH", g1);
    rigs.ROLL_WH = { ...beacon("ROLL_WH", 4) };
    const g2 = new THREE.Group();
    g2.add(box(1, 3, 1, "#22c55e", -38, 0, 16));
    group("FG_WH", g2);
    rigs.FG_WH = { ...beacon("FG_WH", 4) };
    const [x, , z] = SITE.SAFETY.pos;
    const g3 = new THREE.Group();
    g3.add(building(6, 3, 5, x, z, "#3f3f46", "#ef4444"));
    g3.add(box(10, 0.3, 0.3, "#fbbf24", x + 9, 1.2, z - 4)); // 차단기
    const light = stackLight(x - 4, 0, z + 3);
    g3.add(light.group);
    group("SAFETY", g3);
    rigs.SAFETY = { ...beacon("SAFETY", 5), light };
  }

  // 배관·전력선
  LINES.forEach((l) => {
    for (let i = 1; i < l.pts.length; i++) {
      const a = new THREE.Vector3(...l.pts[i - 1]), b = new THREE.Vector3(...l.pts[i]);
      const len = a.distanceTo(b);
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, len, 8), mat(l.color, l.color, 0.15));
      pipe.position.copy(a).add(b).multiplyScalar(0.5);
      pipe.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      scene.add(pipe);
    }
  });
  return rigs;
}

function Spark({ data, color, lo, hi }: { data: number[]; color: string; lo: number | null; hi: number | null }) {
  if (data.length < 2) return <svg width="100%" height={34} />;
  const min = Math.min(...data, lo ?? Infinity), max = Math.max(...data, hi ?? -Infinity);
  const span = max - min || 1;
  const W = 160, H = 34;
  const y = (v: number) => H - 3 - ((v - min) / span) * (H - 6);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * W},${y(v)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
      {hi !== null && <line x1={0} x2={W} y1={y(hi)} y2={y(hi)} stroke="#ef4444" strokeDasharray="3 3" strokeWidth={1} />}
      {lo !== null && <line x1={0} x2={W} y1={y(lo)} y2={y(lo)} stroke="#ef4444" strokeDasharray="3 3" strokeWidth={1} />}
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const out = (m: Metric) => (m.lo !== null && m.value < m.lo) || (m.hi !== null && m.value > m.hi);
const fmt = (m: Metric) => `${m.value.toLocaleString()}${m.unit ? " " + m.unit : ""}`;

export default function FacilityMonitor() {
  const gl = webglAvailable();
  const [d, setD] = useState<FacilityResp>();
  const [sel, setSel] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [glKey, setGlKey] = useState(0); // WebGL 컨텍스트가 끊기면 올려서 무대를 새로 만든다
  const hist = useRef(new Map<string, number[]>());
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage>();
  const labelEls = useRef(new Map<string, { el: HTMLElement; pos: V3 }>());
  const live = useRef<FacilityResp>();

  const load = useCallback(() => api<FacilityResp>("/api/monitor/facility").then((r) => {
    r.facilities.forEach((f) => f.metrics.forEach((m) => {
      const k = `${f.code}.${m.key}`;
      const a = hist.current.get(k) ?? [];
      a.push(m.value);
      if (a.length > 60) a.shift();
      hist.current.set(k, a);
    }));
    live.current = r;
    setD(r);
  }).catch(() => undefined), []);
  useEffect(() => { void load(); const t = setInterval(load, 2000); return () => clearInterval(t); }, [load]);

  useEffect(() => {
    if (!gl || !host.current) return;
    const s = new Stage(host.current, { camera: HOME.camera, target: HOME.target, background: "#0b1220", fog: [170, 300] });
    stage.current = s;
    s.onContextLost = () => setGlKey((k) => k + 1);
    const rigs = buildSite(s);
    const mv = new Movers(s.scene);
    labelEls.current.forEach((v, id) => s.setLabel(id, v.el, v.pos));
    s.onPick = (id) => { setSel(id); if (id) s.flyTo(SITE[id].pos, 42); };
    const lastEmit: Record<string, number> = {};
    s.tick((dt, t) => {
      const r = live.current;
      const by = Object.fromEntries((r?.facilities ?? []).map((f) => [f.code, f]));
      const blink = Math.floor(t * 2.5) % 2 === 0;
      for (const [code, rig] of Object.entries(rigs)) {
        const f = by[code];
        const warn = f?.status === "WARN";
        rig.beacon.color.set(warn ? (blink ? "#f59e0b" : "#78350f") : f?.active ? "#22c55e" : "#64748b");
        const sc = 1 + ((t * (warn ? 1.6 : 0.6)) % 1) * 0.6;
        rig.ring.scale.set(sc, sc, sc);
        (rig.ring.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - ((t * (warn ? 1.6 : 0.6)) % 1));
        (rig.ring.material as THREE.MeshBasicMaterial).color.set(warn ? "#f59e0b" : SITE[code].color);
        if (rig.light) rig.light.set(warn ? "ALARM" : "RUN", blink);
        if (rig.fans && f?.active) rig.fans.forEach((o, i) => { if (i < (f.metrics.find((m) => m.key === "units")?.value ?? 1)) o.rotation.y += dt * 12; });
        if (rig.level && f) {
          const lv = (f.metrics.find((m) => m.key === "level")?.value ?? 50) / 100;
          const h = Math.max(0.1, lv * 6.8);
          rig.level.scale.y = h; rig.level.position.y = h / 2;
          ((rig.level.material as THREE.MeshLambertMaterial).color).set(warn ? "#f59e0b" : "#fde047");
        }
        if (rig.smoke) {
          const steam = (f?.metrics.find((m) => m.key === "steam")?.value ?? 2) / 6;
          rig.smoke.forEach((sm) => {
            const k = (t * 0.25 + sm.userData.phase) % 1;
            sm.position.y = 16 + k * 12;
            sm.position.x = SITE.BOILER.pos[0] + 6 + k * 4;
            sm.scale.setScalar(0.6 + k * 2.2 * (0.5 + steam));
            (sm.material as THREE.MeshLambertMaterial).opacity = 0.4 * (1 - k) * Math.min(1, steam + 0.2);
          });
        }
      }
      // 배관 흐름 입자: 시설이 가동 중일 때만, 부하에 비례해 촘촘하게
      LINES.forEach((l) => {
        const f = by[l.from];
        if (!f?.active) return;
        const every = 0.9 - Math.min(0.6, (r?.load ?? 0) * 0.6);
        if (t - (lastEmit[l.from] ?? 0) < every) return;
        lastEmit[l.from] = t;
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), new THREE.MeshBasicMaterial({ color: l.color }));
        mv.add(dot, l.pts, 2.4);
      });
      mv.step(t);
    });
    return () => { s.dispose(); stage.current = undefined; };
  }, [gl, glKey]);
  useEffect(() => { if (stage.current) stage.current.autoRotate = spinning; }, [spinning]);

  const label = (id: string, pos: V3) => (el: HTMLDivElement | null) => {
    if (el) labelEls.current.set(id, { el, pos }); else labelEls.current.delete(id);
    stage.current?.setLabel(id, el, pos);
  };
  const choose = (code: string | null) => {
    setSel(code);
    if (code) stage.current?.flyTo(SITE[code].pos, 42); else stage.current?.flyHome(HOME.camera, HOME.target);
  };

  const facs = d?.facilities ?? [];
  const warnN = facs.filter((f) => f.status === "WARN").length;
  const selF = facs.find((f) => f.code === sel);

  return (
    <div>
      <style>{CSS}</style>
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        {[
          ["현재 전력", d?.energy.power_kw.toLocaleString() ?? "-", "kW"],
          ["스팀 공급", d?.energy.steam_tph ?? "-", "t/h"],
          ["압축공기", d?.energy.air_m3min ?? "-", "m³/min"],
          ["에너지 비용", d ? Math.round(d.energy.cost_per_hour / 1000).toLocaleString() : "-", "천원/h"],
          ["주의 시설", warnN, `/ ${facs.length || 9}`],
        ].map(([t, v, u], i) => (
          <Col key={t as string} flex="1 1 150px">
            <Card size="small"><Statistic title={t} value={v as string} suffix={u} prefix={i === 0 ? <ThunderboltOutlined /> : undefined}
              valueStyle={i === 4 && warnN ? { color: "#d97706" } : undefined} /></Card>
          </Col>
        ))}
      </Row>
      <Row gutter={12}>
        <Col xs={24} xl={18}>
          {gl ? (
            <div ref={host} style={{ position: "relative", isolation: "isolate", height: "min(62vh, 600px)", minHeight: 400, borderRadius: 10, overflow: "hidden", background: "#0b1220" }}>
              {Object.entries(SITE).map(([code, s]) => {
                const f = facs.find((x) => x.code === code);
                const warn = f?.status === "WARN";
                const c = warn ? "#f59e0b" : f?.active ? "#22c55e" : "#64748b";
                return (
                  <div key={code} ref={label(code, s.label)} className="fc-card" onClick={() => choose(code)}
                    style={{ borderColor: warn ? "#f59e0b" : s.color, boxShadow: warn ? "0 0 16px #f59e0b88" : undefined }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span className={warn ? "fc-dot fc-blink" : "fc-dot"} style={{ background: c }} /><b>{f?.name ?? code}</b>
                    </div>
                    {f?.metrics.slice(0, 1).map((m) => (
                      <div key={m.key} className="fc-m"><span>{m.label}</span><b style={{ color: out(m) ? "#f59e0b" : undefined }}>{fmt(m)}</b></div>
                    ))}
                  </div>
                );
              })}
              <div style={{ position: "absolute", left: 12, top: 12, display: "flex", gap: 6, zIndex: 2000 }}>
                <Button size="small" icon={<AimOutlined />} onClick={() => choose(null)}>전체</Button>
                <Button size="small" type={spinning ? "primary" : "default"} icon={<SyncOutlined spin={spinning} />} onClick={() => setSpinning((x) => !x)}>자동 회전</Button>
              </div>
              <div className="fc-legend">
                <span><i style={{ background: "#22c55e" }} />정상 가동</span><span><i style={{ background: "#f59e0b" }} />주의(관리 범위 이탈)</span>
                <span><i style={{ background: "#64748b" }} />대기</span>
                <span style={{ opacity: 0.7 }}>배관 위 입자 = 스팀·전분·압축공기·전력 공급 흐름</span>
              </div>
            </div>
          ) : <Alert type="warning" showIcon message="이 브라우저는 3D(WebGL)를 지원하지 않아 계측 카드로만 표시합니다." />}
        </Col>
        <Col xs={24} xl={6}>
          {selF ? (
            <Card size="small" title={selF.name} extra={<Button size="small" type="text" icon={<CloseOutlined />} onClick={() => choose(null)} />}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{selF.desc}</Typography.Text>
              <div style={{ margin: "6px 0 10px" }}>
                <Tag color={selF.status === "WARN" ? "orange" : selF.active ? "green" : "default"}>{selF.status === "WARN" ? "주의" : selF.active ? "정상 가동" : "대기"}</Tag>
              </div>
              {selF.metrics.map((m) => (
                <div key={m.key} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span>{m.label}</span><b style={{ color: out(m) ? "#d97706" : undefined }}>{fmt(m)}</b>
                  </div>
                  <Spark data={hist.current.get(`${selF.code}.${m.key}`) ?? []} color={out(m) ? "#d97706" : "#3b82f6"} lo={m.lo} hi={m.hi} />
                  {(m.lo !== null || m.hi !== null) && <div style={{ fontSize: 11, color: "#94a3b8" }}>관리 범위 {m.lo ?? "-"} ~ {m.hi ?? "-"} {m.unit}</div>}
                </div>
              ))}
            </Card>
          ) : (
            <Card size="small" title="시설 상태" styles={{ body: { padding: "0 12px" } }}>
              <List size="small" dataSource={facs} renderItem={(f) => (
                <List.Item style={{ cursor: "pointer", padding: "8px 0" }} onClick={() => choose(f.code)}>
                  <div style={{ width: "100%" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <b>{f.name}</b>
                      <Tag color={f.status === "WARN" ? "orange" : f.active ? "green" : "default"} style={{ marginRight: 0 }}>{f.status === "WARN" ? "주의" : f.active ? "가동" : "대기"}</Tag>
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b" }}>{f.metrics[0].label} {fmt(f.metrics[0])}</div>
                  </div>
                </List.Item>
              )} />
            </Card>
          )}
        </Col>
      </Row>
      <div className="fc-grid">
        {facs.map((f) => {
          const m = f.metrics[0];
          return (
            <div key={f.code}>
              <Card size="small" hoverable onClick={() => choose(f.code)} style={{ borderColor: f.status === "WARN" ? "#f59e0b" : undefined }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 8, flex: "none", background: f.status === "WARN" ? "#f59e0b" : f.active ? "#22c55e" : "#94a3b8" }} />
                  <b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</b>
                </div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{m.value.toLocaleString()} <span style={{ fontSize: 12, fontWeight: 400 }}>{m.unit}</span></div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>{m.label}</div>
                <Spark data={hist.current.get(`${f.code}.${m.key}`) ?? []} color={f.status === "WARN" ? "#d97706" : "#3b82f6"} lo={m.lo} hi={m.hi} />
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const CSS = `
.fc-grid{display:grid;gap:12px;margin-top:12px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
@media (min-width:1400px){.fc-grid{grid-template-columns:repeat(9,1fr)}}
.fc-card{position:absolute;left:0;top:0;will-change:transform;white-space:nowrap;min-width:120px;font-size:12px;color:#e2e8f0;padding:4px 9px;border-radius:10px;border:1.5px solid;background:rgba(15,23,42,.85);backdrop-filter:blur(4px);cursor:pointer}
.fc-card:hover{background:rgba(30,41,59,.95)}
.fc-m{display:flex;justify-content:space-between;gap:10px;color:#94a3b8;font-size:11px}
.fc-m b{color:#e2e8f0}
.fc-dot{width:9px;height:9px;border-radius:9px;display:inline-block}
.fc-blink{animation:fc-blink .8s step-start infinite}
@keyframes fc-blink{50%{opacity:.2}}
.fc-legend{position:absolute;left:12px;bottom:10px;display:flex;flex-wrap:wrap;gap:12px;font-size:11px;color:#cbd5e1;z-index:2000;pointer-events:none}
.fc-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
`;
