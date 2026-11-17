import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/**
 * 가벼운 3D 무대: 렌더러·카메라·궤도 컨트롤·조명·HTML 라벨 오버레이·클릭 선택.
 * - 그림자·후처리 없음, 픽셀 비율 상한 1.5 → 시연용 노트북에서도 가볍게 돈다.
 * - 화면에서 벗어나면(탭 전환) requestAnimationFrame이 자동으로 멈춘다.
 */
export interface StageOptions {
  camera: [number, number, number];
  target: [number, number, number];
  background?: string;
  fog?: [number, number];
}

type Ticker = (dt: number, t: number) => void;

export class Stage {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  private tickers = new Set<Ticker>();
  private labels = new Map<string, { el: HTMLElement; pos: THREE.Vector3; maxDist?: number }>();
  private pickables: THREE.Object3D[] = [];
  private raf = 0;
  private last = performance.now();
  private ro: ResizeObserver;
  private fly?: { from: THREE.Vector3; to: THREE.Vector3; camFrom: THREE.Vector3; camTo: THREE.Vector3; t: number };
  private v = new THREE.Vector3();
  onPick?: (id: string | null) => void;
  /** WebGL 컨텍스트가 끊기고 복구되지 않을 때 호출(페이지가 무대를 새로 만든다). */
  onContextLost?: () => void;
  autoRotate = false;
  private lostTimer = 0;
  private baseFov = 42;

  constructor(private host: HTMLElement, opt: StageOptions) {
    const w = host.clientWidth || 800, h = host.clientHeight || 500;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(w, h);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.style.display = "block";
    host.prepend(this.renderer.domElement);

    this.scene.background = new THREE.Color(opt.background ?? "#0b1220");
    if (opt.fog) this.scene.fog = new THREE.Fog(opt.background ?? "#0b1220", opt.fog[0], opt.fog[1]);
    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.5, 600);
    this.camera.position.set(...opt.camera);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(...opt.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 190;
    this.controls.autoRotateSpeed = 0.5;
    this.controls.update();

    this.scene.add(new THREE.HemisphereLight("#cfe3ff", "#1b2233", 1.6));
    const sun = new THREE.DirectionalLight("#ffffff", 1.6);
    sun.position.set(-40, 80, 50);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight("#7aa2ff", 0.6);
    rim.position.set(60, 30, -60);
    this.scene.add(rim);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.fitFov(w / h);
    this.camera.updateProjectionMatrix();

    // 모바일에서 탭 전환·메모리 부족으로 컨텍스트가 끊기면 three.js가 복구를 시도한다.
    // 1.5초 안에 복구되지 않으면 무대를 새로 만들도록 알린다.
    this.renderer.domElement.addEventListener("webglcontextlost", () => {
      window.clearTimeout(this.lostTimer);
      this.lostTimer = window.setTimeout(() => this.onContextLost?.(), 1500);
    });
    this.renderer.domElement.addEventListener("webglcontextrestored", () => window.clearTimeout(this.lostTimer));

    // 클릭(드래그가 아닌 짧은 탭)만 선택으로 본다
    let down: [number, number] | null = null;
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; this.controls.autoRotate = false; });
    el.addEventListener("pointerup", (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      this.onPick?.(this.pick(e));
    });

    const loop = (now: number) => {
      const dt = Math.min((now - this.last) / 1000, 0.1);
      this.last = now;
      this.tickers.forEach((f) => f(dt, now / 1000));
      this.stepFly(dt);
      this.controls.autoRotate = this.autoRotate;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.placeLabels();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  tick(f: Ticker) { this.tickers.add(f); return () => this.tickers.delete(f); }

  /** 클릭 가능한 물체 등록: 이 물체(와 자식)를 누르면 id가 onPick으로 전달된다. */
  pickable(obj: THREE.Object3D, id: string) {
    obj.userData.pickId = id;
    this.pickables.push(obj);
  }

  /** HTML 라벨을 3D 좌표에 붙인다(React가 그린 div를 ref로 넘긴다). */
  setLabel(id: string, el: HTMLElement | null, pos?: [number, number, number], maxDist?: number) {
    if (!el) { this.labels.delete(id); return; }
    const prev = this.labels.get(id);
    this.labels.set(id, { el, pos: pos ? new THREE.Vector3(...pos) : prev?.pos ?? new THREE.Vector3(), maxDist: maxDist ?? prev?.maxDist });
  }

  /** 카메라를 대상 쪽으로 부드럽게 이동. */
  flyTo(target: [number, number, number], distance = 38) {
    const to = new THREE.Vector3(...target);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.fly = { from: this.controls.target.clone(), to, camFrom: this.camera.position.clone(),
      camTo: to.clone().add(dir.multiplyScalar(distance)), t: 0 };
  }

  flyHome(cam: [number, number, number], target: [number, number, number]) {
    this.fly = { from: this.controls.target.clone(), to: new THREE.Vector3(...target), camFrom: this.camera.position.clone(),
      camTo: new THREE.Vector3(...cam), t: 0 };
  }

  private stepFly(dt: number) {
    if (!this.fly) return;
    const f = this.fly;
    f.t = Math.min(f.t + dt / 0.9, 1);
    const e = f.t < 0.5 ? 2 * f.t * f.t : 1 - Math.pow(-2 * f.t + 2, 2) / 2;
    this.controls.target.lerpVectors(f.from, f.to, e);
    this.camera.position.lerpVectors(f.camFrom, f.camTo, e);
    if (f.t >= 1) this.fly = undefined;
  }

  private pick(e: PointerEvent): string | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObjects(this.pickables, true)[0];
    let o: THREE.Object3D | null = hit?.object ?? null;
    while (o && !o.userData.pickId) o = o.parent;
    return (o?.userData.pickId as string) ?? null;
  }

  private placeLabels() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    this.labels.forEach(({ el, pos, maxDist }) => {
      this.v.copy(pos).project(this.camera);
      const behind = this.v.z > 1;
      const x = (this.v.x * 0.5 + 0.5) * w, y = (-this.v.y * 0.5 + 0.5) * h;
      const d = this.camera.position.distanceTo(pos);
      const off = behind || x < -150 || x > w + 150 || y < -80 || y > h + 80 || (maxDist !== undefined && d > maxDist);
      el.style.display = off ? "none" : "";
      if (!off) {
        el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
        // 멀수록 흐리게 → 원근감
        el.style.opacity = String(Math.max(0.55, Math.min(1, 90 / d)));
        el.style.zIndex = String(1000 - Math.round(d));
      }
    });
  }

  /**
   * 세로로 긴(폭이 좁은) 화면에서는 가로 시야가 좁아져 공장 양 끝이 잘린다.
   * 가로세로 1.2:1 화면과 같은 가로 시야가 나오도록 세로 시야각을 넓힌다(상한 65°).
   */
  private fitFov(aspect: number) {
    const ref = 1.2;
    if (aspect >= ref) { this.camera.fov = this.baseFov; return; }
    const half = Math.atan(Math.tan((this.baseFov * Math.PI) / 360) * ref / aspect);
    this.camera.fov = Math.min(65, (half * 360) / Math.PI);
  }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.fitFov(w / h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.lostTimer);
    this.ro.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
    });
    clearShared();
    this.renderer.dispose();
    // 컨텍스트를 바로 반납(가비지 수집을 기다리면 화면을 오갈 때 컨텍스트가 쌓인다)
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

let glOk: boolean | undefined;
/**
 * WebGL 지원 여부(한 번만 검사해 기억).
 * 예전에는 화면이 다시 그려질 때마다 시험용 캔버스로 WebGL 컨텍스트를 새로 만들고 반납하지 않아,
 * 브라우저 한도(모바일은 특히 낮음)를 넘으면 가장 오래된 컨텍스트, 곧 3D 맵 자신이 끊겨
 * 라벨만 남고 물체가 사라졌다.
 */
export function webglAvailable(): boolean {
  if (glOk !== undefined) return glOk;
  try {
    const c = document.createElement("canvas");
    const g = window.WebGLRenderingContext ? (c.getContext("webgl2") || c.getContext("webgl")) : null;
    glOk = !!g;
    g?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    glOk = false;
  }
  return glOk;
}

// ---------------------------------------------------------------- 저폴리 모델 도우미
const matCache = new Map<string, THREE.MeshLambertMaterial>();
/** 같은 색은 재질을 공유(그리기 비용 절감). emissive가 필요한 것은 mat()로 따로 만든다. */
export function shared(color: string) {
  let m = matCache.get(color);
  if (!m) { m = new THREE.MeshLambertMaterial({ color }); matCache.set(color, m); }
  return m;
}
export function clearShared() { matCache.forEach((m) => m.dispose()); matCache.clear(); }

export const mat = (color: string, emissive = "#000000", intensity = 0) =>
  new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity: intensity });

export function box(w: number, h: number, d: number, m: THREE.Material | string, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof m === "string" ? shared(m) : m);
  mesh.position.set(x, y + h / 2, z);
  return mesh;
}

/** 원기둥. axis: y(세운 롤) · x · z(눕힌 롤). */
export function cyl(r: number, len: number, m: THREE.Material | string, axis: "x" | "y" | "z" = "y", x = 0, y = 0, z = 0, seg = 20) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), typeof m === "string" ? shared(m) : m);
  if (axis === "x") mesh.rotation.z = Math.PI / 2;
  if (axis === "z") mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  return mesh;
}

/** 바닥 구역 판(반투명 색 + 테두리). */
export function zone(x0: number, z0: number, x1: number, z1: number, color: string, opacity = 0.16) {
  const g = new THREE.Group();
  const w = x1 - x0, d = z1 - z0;
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  plate.rotation.x = -Math.PI / 2;
  plate.position.set(x0 + w / 2, 0.02, z0 + d / 2);
  g.add(plate);
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, 0.01, d)),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 }));
  edge.position.set(x0 + w / 2, 0.03, z0 + d / 2);
  g.add(edge);
  return g;
}

/** 경광등(스택 라이트): 초록=가동, 주황=대기, 빨강=경보. 반환된 set으로 상태를 바꾼다. */
export function stackLight(x: number, y: number, z: number) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.add(cyl(0.08, 1.2, "#475569", "y", 0, 0.6, 0, 8));
  const colors = ["#ef4444", "#f59e0b", "#22c55e"];
  const lamps = colors.map((c, i) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.32, 12), mat(c, c, 0));
    m.position.y = 1.35 + (2 - i) * 0.34;
    g.add(m);
    return m;
  });
  const set = (state: "RUN" | "IDLE" | "ALARM", blink: boolean) => {
    lamps.forEach((l, i) => {
      const on = (state === "ALARM" && i === 0 && blink) || (state === "IDLE" && i === 1) || (state === "RUN" && i === 2);
      const m = l.material as THREE.MeshLambertMaterial;
      m.emissiveIntensity = on ? 1.4 : 0.03;
      m.color.set(on ? colors[i] : "#334155");
    });
  };
  return { group: g, set };
}

/** 경로(꺾은선) 위 t 지점. */
export function along(pts: THREE.Vector3[], t: number, out = new THREE.Vector3()) {
  if (pts.length === 1) return out.copy(pts[0]);
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) { const d = pts[i].distanceTo(pts[i - 1]); seg.push(d); total += d; }
  let dist = Math.min(Math.max(t, 0), 1) * total;
  for (let i = 0; i < seg.length; i++) {
    if (dist <= seg[i] || i === seg.length - 1) return out.lerpVectors(pts[i], pts[i + 1], seg[i] ? dist / seg[i] : 0);
    dist -= seg[i];
  }
  return out.copy(pts[pts.length - 1]);
}

/** 경로를 따라 이동하는 물체(원단 더미·팔레트·롤·데이터 패킷). 도착하면 장면에서 지운다. */
export class Movers {
  private list: { obj: THREE.Object3D; pts: THREE.Vector3[]; start: number; dur: number; spin?: boolean }[] = [];
  constructor(private scene: THREE.Scene) {}
  add(obj: THREE.Object3D, pts: [number, number, number][], dur: number, delay = 0, spin = false) {
    obj.visible = false;
    this.scene.add(obj);
    this.list.push({ obj, pts: pts.map((p) => new THREE.Vector3(...p)), start: performance.now() / 1000 + delay, dur, spin });
  }
  step(t: number) {
    this.list = this.list.filter((m) => {
      const k = (t - m.start) / m.dur;
      if (k < 0) return true;
      if (k > 1.05) {
        this.scene.remove(m.obj);
        m.obj.traverse((o) => { const x = o as THREE.Mesh; x.geometry?.dispose(); });
        return false;
      }
      m.obj.visible = true;
      const e = k >= 1 ? 1 : k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      along(m.pts, e, m.obj.position);
      if (m.spin) m.obj.rotation.y += 0.05;
      return true;
    });
  }
  get size() { return this.list.length; }
}
