import * as THREE from "three";
import { Stage, box, cyl, mat, stackLight, zone } from "../components/three/stage";

/**
 * 골판지 상자 공장 3D 배치(1 단위 = 약 1m).
 * 실제 박스 공장의 U자 흐름을 따랐다:
 *   원지 창고 → 골판지기(웻엔드: 롤스탠드·싱글페이서·브릿지 / 드라이엔드: 글루머신·더블백커·슬리터·커터·스태커)
 *   → 오토콘 컨베이어·원단 대기장 → 인쇄(FFG) → 가공(다이커터·폴더글루어) → 결속·팔레타이저 → 제품 창고 → 출하 도크
 */
export type V3 = [number, number, number];

export const HOME = { camera: [-20, 58, 68] as V3, target: [-8, 0, 0] as V3 };

export const ZONES: { code: string; label: string; x0: number; z0: number; x1: number; z1: number; color: string }[] = [
  { code: "ROLL", label: "원지 창고 (PMS)", x0: -68, z0: -36, x1: -42, z1: -3, color: "#d97706" },
  { code: "CORR", label: "골판지기 라인", x0: -40, z0: -21, x1: 42, z1: -5, color: "#3b82f6" },
  { code: "WIP", label: "오토콘 원단 대기장", x0: 44, z0: -21, x1: 66, z1: 26, color: "#eab308" },
  { code: "CONV", label: "인쇄·가공 라인", x0: -14, z0: 4, x1: 42, z1: 26, color: "#a855f7" },
  { code: "FG", label: "제품 창고", x0: -40, z0: 4, x1: -16, z1: 30, color: "#22c55e" },
  { code: "SHIP", label: "출하장 (로지스팟)", x0: -68, z0: 4, x1: -42, z1: 34, color: "#14b8a6" },
];

/** 골판지기 세부 공정(라벨용). */
export const CORR_SECTIONS: { label: string; x: number }[] = [
  { label: "밀롤 스탠드·스플라이서", x: -31 }, { label: "싱글페이서", x: -21 }, { label: "브릿지", x: -11 },
  { label: "글루머신", x: -1 }, { label: "더블백커(열판)", x: 11 }, { label: "슬리터·스코어러", x: 22.5 },
  { label: "커터", x: 26 }, { label: "스태커", x: 33 },
];
export const PR_SECTIONS: { label: string; x: number }[] = [
  { label: "피더", x: 37 }, { label: "인쇄 유닛", x: 30.4 }, { label: "슬로터", x: 24.4 }, { label: "카운터이젝터", x: 21.5 },
];
export const EV_SECTIONS: { label: string; x: number }[] = [
  { label: "피더", x: 13 }, { label: "로터리 다이커터", x: 9.5 }, { label: "폴더글루어", x: 4 }, { label: "카운터이젝터", x: -0.8 },
];

export const MACHINE_POS: Record<string, { label: V3; focus: V3 }> = {
  CG01: { label: [-6, 8, -17], focus: [0, 0, -13] },
  PR05: { label: [33, 4.5, 9], focus: [30, 0, 10] },
  EV01: { label: [4, 4.5, 21], focus: [6, 0, 20] },
};

// 반송 경로(오토콘·지게차)
export const PATH = {
  rollToStand: [[-46, 1, -10], [-40, 1, -10], [-36, 1, -13]] as V3[],
  toPrint: [[36, 1.4, -13], [52, 1.4, -13], [52, 1.4, 10], [39, 1.4, 10]] as V3[],
  toConvert: [[36, 1.4, -13], [56, 1.4, -13], [56, 1.4, 20], [15, 1.4, 20]] as V3[],
  printToConvert: [[20, 1.4, 10], [17.5, 1.4, 10], [17.5, 1.4, 20], [15, 1.4, 20]] as V3[],
  convertToFg: [[-3, 1.2, 20], [-9, 1.2, 20], [-14, 1.2, 17], [-27, 1.2, 17]] as V3[],
  fgToTruck: [[-28, 1.2, 17], [-38, 1.2, 19], [-50, 1.2, 19], [-69, 1.6, 19]] as V3[],
  truckLeave: [[-76, 0, 19], [-76, 0, 44], [-76, 0, 70]] as V3[],
};

const PAPER_COLOR = (code: string) =>
  code.startsWith("WK") || code.startsWith("KLB") ? "#e9e3d3" : code.startsWith("SK") ? "#8d7a5f" : code.startsWith("K") ? "#9a6534" : "#c79a58";

export interface MachineRig {
  light: ReturnType<typeof stackLight>;
  spin: THREE.Object3D[]; // 가동 중 회전하는 롤
  glow: THREE.MeshLambertMaterial[]; // 가동 중 빛나는 부분(열판 등)
  frame: THREE.MeshLambertMaterial; // 상태 띠(초록/회색/빨강)
  press?: THREE.Object3D; // 상하 왕복
  pile?: THREE.Object3D; // 스태커 원단 더미
  slats?: THREE.Object3D[]; // 브릿지 위를 흐르는 원단
}

export interface Plant {
  rigs: Record<string, MachineRig>;
  rollGroup: THREE.Group;
  fgGroup: THREE.Group;
  wipGroup: THREE.Group;
  truck: THREE.Group;
  setRolls: (papers: { code: string; stock_kg: number; opening_kg: number }[]) => void;
  setPallets: (n: number) => void;
  setWip: (n: number) => void;
}

/** 그룹 비우기(지오메트리 해제 포함). 같은 내용이면 다시 만들지 않도록 key를 비교한다. */
function refill(g: THREE.Group, key: string, build: () => void) {
  if (g.userData.key === key) return;
  g.userData.key = key;
  g.traverse((o) => { if (o !== g) (o as THREE.Mesh).geometry?.dispose(); });
  g.clear();
  build();
}

function track(points: [number, number][], y = 0.9, w = 1.8) {
  const g = new THREE.Group();
  for (let i = 1; i < points.length; i++) {
    const [x0, z0] = points[i - 1], [x1, z1] = points[i];
    const len = Math.hypot(x1 - x0, z1 - z0) + w;
    const b = box(len, 0.25, w, "#475569", (x0 + x1) / 2, y, (z0 + z1) / 2);
    b.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    g.add(b);
    const rail = box(len, 0.06, 0.12, "#94a3b8", (x0 + x1) / 2, y + 0.25, (z0 + z1) / 2);
    rail.rotation.y = b.rotation.y;
    g.add(rail);
    // 다리
    const n = Math.max(1, Math.floor(len / 5));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      g.add(box(0.2, y, 0.2, "#334155", x0 + (x1 - x0) * t, 0, z0 + (z1 - z0) * t));
    }
  }
  return g;
}

/** 설비 둘레 바닥 테두리(상태 색으로 빛난다). */
function frameStrip(w: number, d: number, x: number, z: number) {
  const m = mat("#475569", "#22c55e", 0);
  const strip = new THREE.Group();
  const t = 0.3;
  strip.add(box(w, 0.08, t, m, x, 0.03, z - d / 2));
  strip.add(box(w, 0.08, t, m, x, 0.03, z + d / 2));
  strip.add(box(t, 0.08, d, m, x - w / 2, 0.03, z));
  strip.add(box(t, 0.08, d, m, x + w / 2, 0.03, z));
  return { strip, m };
}

/** 낮은 둥근 기계 몸체(+상판 색) */
function body(w: number, h: number, d: number, x: number, z: number, color = "#5b6b84", top = "#7c8ba3") {
  const g = new THREE.Group();
  g.add(box(w, h, d, color, x, 0, z));
  g.add(box(w * 0.96, 0.12, d * 0.96, top, x, h, z));
  return g;
}

export function boardStack(h = 1, color = "#c99b5c") {
  const g = new THREE.Group();
  g.add(box(1.6, 0.15, 1.6, "#6b4f2a", 0, 0, 0)); // 팔레트
  g.add(box(1.5, h, 1.5, color, 0, 0.15, 0));
  g.add(box(1.52, 0.04, 1.52, "#e5c38f", 0, 0.15 + h * 0.5, 0));
  return g;
}

export function rollMesh(color = "#9a6534") {
  const g = new THREE.Group();
  g.add(cyl(0.75, 1.8, color, "y", 0, 0.9, 0, 18));
  g.add(cyl(0.18, 1.82, "#3f2a14", "y", 0, 0.9, 0, 8));
  return g;
}

export function palletMesh() {
  const g = new THREE.Group();
  g.add(box(1.6, 0.15, 1.6, "#6b4f2a"));
  g.add(box(1.4, 1.2, 1.4, "#c08a3e", 0, 0.15, 0));
  g.add(box(1.42, 0.05, 1.42, "#f5f5f4", 0, 0.8, 0)); // 결속 밴드
  return g;
}

/** ERP↔설비 데이터 패킷(빛 기둥 + 구슬). */
export function packet(color: string) {
  const g = new THREE.Group();
  const s = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 10), new THREE.MeshBasicMaterial({ color }));
  g.add(s);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(1.1, 14, 10),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false }));
  g.add(halo);
  return g;
}

function truckMesh() {
  const g = new THREE.Group();
  g.add(box(9, 3.2, 2.6, "#0f766e", -1.5, 0.9, 0)); // 적재함
  g.add(box(9.05, 0.15, 2.65, "#5eead4", -1.5, 4.1, 0));
  g.add(box(2.6, 2.6, 2.5, "#14b8a6", 4.5, 0.9, 0)); // 캡
  g.add(box(0.1, 1, 2.2, "#ccfbf1", 5.85, 2.2, 0)); // 앞유리
  for (const x of [-5, -3, 4.5]) for (const z of [-1.2, 1.2]) g.add(cyl(0.55, 0.4, "#111827", "z", x, 0.55, z, 12));
  return g;
}

export function buildPlant(stage: Stage): Plant {
  const { scene } = stage;

  // ---- 바닥·건물
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(176, 100), new THREE.MeshLambertMaterial({ color: "#121c30" }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const grid = new THREE.GridHelper(176, 44, "#1e2c47", "#18233a");
  (grid.position as THREE.Vector3).y = 0.01;
  scene.add(grid);
  ZONES.forEach((z) => scene.add(zone(z.x0, z.z0, z.x1, z.z1, z.color, 0.1)));
  // 외벽(낮게) + 기둥 → 공장 건물 느낌, 시야는 가리지 않게
  const wallM = new THREE.MeshLambertMaterial({ color: "#334155", transparent: true, opacity: 0.55 });
  scene.add(box(140, 1.4, 0.4, wallM, 0, 0, -38));
  scene.add(box(140, 1.4, 0.4, wallM, 0, 0, 37));
  scene.add(box(0.4, 1.4, 75, wallM, 70, 0, 0));
  scene.add(box(0.4, 1.4, 22, wallM, -70, 0, -27)); // 출하 도크 쪽은 비운다
  for (let x = -66; x <= 66; x += 12) {
    scene.add(box(0.6, 6, 0.6, "#3b4a63", x, 0, -38));
    scene.add(box(0.6, 6, 0.6, "#3b4a63", x, 0, 37));
  }
  // 도크 문
  for (const z of [10, 19, 28]) scene.add(box(0.5, 4.5, 4, "#1f2937", -70, 0, z));

  const rigs: Record<string, MachineRig> = {};

  // ---- 골판지기 CG01 (z=-13 축으로 길게)
  {
    const Z = -13;
    const spin: THREE.Object3D[] = [];
    const glow: THREE.MeshLambertMaterial[] = [];
    const g = new THREE.Group();
    // 밀롤 스탠드 3대(각각 롤 2개: 운전 롤 + 대기 롤 → 스플라이서로 무정지 교체)
    for (const x of [-36, -31, -26]) {
      for (const dz of [-1.7, 1.7]) g.add(box(0.35, 3.2, 0.35, "#64748b", x, 0, Z + dz));
      g.add(box(0.4, 0.4, 3.8, "#64748b", x, 3.2, Z));
      const r1 = cyl(0.8, 2.6, "#9a6534", "z", x - 0.9, 1.6, Z); spin.push(r1); g.add(r1);
      const r2 = cyl(0.65, 2.6, "#c79a58", "z", x + 0.9, 1.4, Z); g.add(r2);
      g.add(box(1.2, 1, 3, "#475569", x + 2.2, 2.4, Z)); // 스플라이서
    }
    // 싱글페이서
    g.add(body(4.2, 3.4, 3.6, -21, Z, "#3f5f8a", "#5b7db0"));
    for (const [dx, y] of [[-0.8, 2.2], [0.8, 2.2], [0, 1.2]] as [number, number][]) {
      const r = cyl(0.55, 3.8, "#cbd5e1", "z", -21 + dx, y, Z); spin.push(r); g.add(r);
    }
    // 브릿지(원단 버퍼) — 높이 띄운 평판과 흐르는 원단 조각
    g.add(box(16, 0.3, 2.8, "#475569", -11, 4.2, Z));
    for (let x = -18; x <= -4; x += 3.5) for (const dz of [-1.2, 1.2]) g.add(box(0.25, 4.2, 0.25, "#334155", x, 0, Z + dz));
    const slats: THREE.Object3D[] = [];
    for (let i = 0; i < 9; i++) {
      const s = box(1.3, 0.08, 2.3, "#c99b5c", -18 + i * 1.8, 4.5, Z);
      s.rotation.z = 0.12; slats.push(s); g.add(s);
    }
    // 글루머신
    g.add(body(2.6, 2.6, 3.4, -1, Z, "#3f5f8a", "#5b7db0"));
    const gr = cyl(0.45, 3.6, "#fde68a", "z", -1, 1.7, Z); spin.push(gr); g.add(gr);
    // 더블백커 — 열판(가동 시 붉게)
    g.add(body(18, 1.2, 3.4, 11, Z, "#334155", "#475569"));
    for (let i = 0; i < 8; i++) {
      const m = mat("#7f1d1d", "#ef4444", 0); glow.push(m);
      g.add(box(1.9, 0.1, 2.6, m, 3.2 + i * 2.2, 1.32, Z));
    }
    g.add(box(18, 0.06, 2.4, "#c99b5c", 11, 1.45, Z)); // 원단 시트
    g.add(box(18, 0.25, 3.2, "#1f2937", 11, 2.1, Z)); // 상부 벨트
    // 슬리터·스코어러, 커터
    g.add(body(2.2, 2.8, 3.6, 22.5, Z, "#3f5f8a", "#5b7db0"));
    for (const y of [1.2, 2]) { const r = cyl(0.35, 3.8, "#e2e8f0", "z", 22.5, y, Z); spin.push(r); g.add(r); }
    g.add(body(2.2, 2.6, 3.4, 26, Z, "#3f5f8a", "#5b7db0"));
    const knife = cyl(0.5, 3.6, "#f1f5f9", "z", 26, 1.6, Z); spin.push(knife); g.add(knife);
    // 스태커 + 원단 더미
    g.add(box(5, 1, 3, "#475569", 31, 0, Z));
    const pile = box(2.2, 1, 2.2, "#c99b5c", 35.2, 0, Z);
    g.add(pile);
    const fs = frameStrip(76, 6, -0.5, Z);
    g.add(fs.strip);
    const light = stackLight(-24, 0, Z - 3.2);
    g.add(light.group);
    scene.add(g);
    stage.pickable(g, "CG01");
    rigs.CG01 = { light, spin, glow, frame: fs.m, pile, slats };
  }

  // ---- 오토콘 컨베이어 + 원단 대기장
  scene.add(track([[36, -13], [56, -13], [56, 20], [15, 20]]));
  scene.add(track([[52, -13], [52, 10], [39, 10]]));
  scene.add(track([[20, 10], [17.5, 10], [17.5, 20]]));
  scene.add(track([[-3, 20], [-9, 20], [-14, 17], [-27, 17]], 0.6));
  const wipGroup = new THREE.Group();
  scene.add(wipGroup);
  stage.pickable(wipGroup, "WIP");

  // ---- 인쇄 5호기 PR05 (플렉소 인쇄·슬로터, 오른쪽 → 왼쪽)
  {
    const Z = 10;
    const g = new THREE.Group();
    const spin: THREE.Object3D[] = [];
    g.add(body(3, 2.4, 3.8, 37, Z, "#4c3a78", "#6d58a8")); // 피더
    ["#0ea5e9", "#ec4899", "#facc15", "#1f2937"].forEach((c, i) => {
      const x = 34 - i * 2.4;
      g.add(body(2.2, 3, 3.8, x, Z, "#4c3a78", c));
      const r = cyl(0.5, 3.9, c, "z", x, 1.8, Z); spin.push(r); g.add(r);
    });
    g.add(body(2.4, 2.6, 3.8, 24.4, Z, "#4c3a78", "#6d58a8")); // 슬로터
    g.add(body(2.6, 1.6, 3, 21.5, Z, "#3b2f5e", "#6d58a8")); // 카운터이젝터
    const fs = frameStrip(19, 5.4, 29.5, Z);
    g.add(fs.strip);
    const light = stackLight(39.2, 0, Z - 2.4);
    g.add(light.group);
    scene.add(g);
    stage.pickable(g, "PR05");
    rigs.PR05 = { light, spin, glow: [], frame: fs.m };
  }

  // ---- 가공기 EV01 (로터리 다이커터 + 폴더글루어)
  {
    const Z = 20;
    const g = new THREE.Group();
    const spin: THREE.Object3D[] = [];
    g.add(body(3, 2.4, 3.8, 13, Z, "#7c4a1e", "#a16207"));
    g.add(body(3.6, 3.6, 4, 9.5, Z, "#7c4a1e", "#a16207"));
    const die = cyl(1.1, 4.1, "#fbbf24", "z", 9.5, 2.3, Z); spin.push(die); g.add(die);
    g.add(body(6, 1.3, 3.2, 4, Z, "#5b3716", "#a16207"));
    const press = box(5.6, 0.4, 2.6, "#e2e8f0", 4, 1.8, Z); g.add(press);
    g.add(body(2.6, 1.8, 3, -0.8, Z, "#5b3716", "#a16207"));
    const fs = frameStrip(17, 5.4, 6, Z);
    g.add(fs.strip);
    const light = stackLight(15, 0, Z + 2.4);
    g.add(light.group);
    scene.add(g);
    stage.pickable(g, "EV01");
    rigs.EV01 = { light, spin, glow: [], frame: fs.m, press };
  }

  // ---- 결속기·팔레타이저
  scene.add(body(3, 2.6, 3, -9, 20, "#334155", "#64748b"));
  scene.add(box(0.2, 3.2, 3.2, "#94a3b8", -10.5, 0, 20));

  // ---- 원지 창고: 지종별 롤(세운 롤, 2단 적재)
  const rollGroup = new THREE.Group();
  scene.add(rollGroup);
  stage.pickable(rollGroup, "ROLL");
  const setRolls = (papers: { code: string; stock_kg: number; opening_kg: number }[]) => {
    const counts = papers.map((p) => Math.max(0, Math.round((p.stock_kg / p.opening_kg) * 16)));
    refill(rollGroup, counts.join(","), () => papers.forEach((p, row) => {
      const color = PAPER_COLOR(p.code);
      for (let k = 0; k < counts[row]; k++) {
        const r = rollMesh(color);
        r.position.set(-64 + (k % 8) * 2.3, k >= 8 ? 1.8 : 0, -33 + row * 3.6);
        rollGroup.add(r);
      }
    }));
  };
  // 클램프 지게차(정지 모형)
  {
    const f = new THREE.Group();
    f.add(box(2, 1.2, 1.4, "#f59e0b", 0, 0.3, 0));
    f.add(box(0.2, 2.6, 1.2, "#334155", 1.1, 0.3, 0));
    f.add(box(0.8, 1.4, 0.15, "#94a3b8", 1.6, 0.6, 0.55));
    f.add(box(0.8, 1.4, 0.15, "#94a3b8", 1.6, 0.6, -0.55));
    f.position.set(-44, 0, -8);
    scene.add(f);
  }

  // ---- 제품 창고: 랙 + 팔레트
  const fgGroup = new THREE.Group();
  scene.add(fgGroup);
  stage.pickable(fgGroup, "FG");
  for (const z of [8, 14, 24]) {
    for (let x = -38; x <= -18; x += 4) for (const dz of [-1, 1]) scene.add(box(0.15, 4.2, 0.15, "#64748b", x, 0, z + dz));
    for (const y of [0.1, 2.1]) for (const dz of [-1, 1]) scene.add(box(20.2, 0.14, 0.14, "#ea580c", -28, y, z + dz));
  }
  const slots: V3[] = [];
  for (const y of [0.22, 2.22]) for (const z of [8, 14, 24]) for (let x = -36; x <= -20; x += 2) slots.push([x, y, z]);
  const setPallets = (n: number) => {
    const k = Math.min(n, slots.length);
    refill(fgGroup, String(k), () => {
      for (let i = 0; i < k; i++) {
        const p = palletMesh();
        p.position.set(...slots[i]);
        fgGroup.add(p);
      }
    });
  };
  const setWip = (n: number) => {
    const k = Math.min(n * 2, 16);
    refill(wipGroup, String(k), () => {
      for (let i = 0; i < k; i++) {
        const s = boardStack(0.8 + (i % 3) * 0.3);
        s.position.set(59 + (i % 4) * 2.1, 0, -8 + Math.floor(i / 4) * 2.6);
        wipGroup.add(s);
      }
    });
  };

  // ---- 출하 도크 트럭(배차 시 등장)
  const truck = truckMesh();
  truck.position.set(-76, 0, 19);
  truck.rotation.y = Math.PI;
  truck.visible = false;
  scene.add(truck);

  return { rigs, rollGroup, fgGroup, wipGroup, truck, setRolls, setPallets, setWip };
}

export function setMachineState(r: MachineRig, state: "RUN" | "IDLE" | "ALARM", blink: boolean) {
  r.light.set(state, blink);
  const c = state === "ALARM" ? "#ef4444" : state === "RUN" ? "#22c55e" : "#475569";
  r.frame.color.set(c);
  r.frame.emissive.set(c);
  r.frame.emissiveIntensity = state === "IDLE" ? 0 : state === "ALARM" ? (blink ? 1 : 0.2) : 0.6;
  r.glow.forEach((m) => { m.emissiveIntensity = state === "IDLE" ? 0.05 : 0.8; });
}

