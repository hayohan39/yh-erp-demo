import { useEffect, useRef, useState } from "react";

export type Pt = [number, number];

/** 꺾은선 경로 위 t(0~1) 지점 좌표. */
export function pointAt(pts: Pt[], t: number): Pt {
  if (pts.length === 1) return pts[0];
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    seg.push(d);
    total += d;
  }
  let dist = Math.min(Math.max(t, 0), 1) * total;
  for (let i = 0; i < seg.length; i++) {
    if (dist <= seg[i] || i === seg.length - 1) {
      const r = seg[i] ? dist / seg[i] : 0;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * r, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * r];
    }
    dist -= seg[i];
  }
  return pts[pts.length - 1];
}

/** 라벨 폭 추정(한글은 넓게). */
export const textW = (s: string, size = 11) =>
  [...s].reduce((w, c) => w + (/[\u3131-\uD79D]/.test(c) ? size : size * 0.6), 0);

export const polyD = (pts: Pt[]) => pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");

export interface Token {
  id: number;
  pts: Pt[];
  start: number; // performance.now() 기준
  dur: number; // ms
  color: string;
  shape: "dot" | "roll" | "sheet" | "box" | "mail";
  label?: string;
}

/** 이동 토큰 목록 + 움직이는 동안만 도는 애니메이션 시계. */
export function useTokens() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [clock, setClock] = useState(() => performance.now());
  const seq = useRef(1);
  const raf = useRef<number>();

  useEffect(() => {
    if (!tokens.length) return;
    const tick = () => {
      const t = performance.now();
      setClock(t);
      setTokens((ts) => {
        const alive = ts.filter((k) => t - k.start < k.dur + 250);
        return alive.length === ts.length ? ts : alive;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [tokens.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = (t: Omit<Token, "id" | "start">, delay = 0) => {
    const tok = { ...t, id: seq.current++, start: performance.now() + delay };
    setTokens((ts) => [...ts.slice(-80), tok]);
  };
  return { tokens, clock, add };
}

/** 토큰의 현재 위치(시작 전이면 null). */
export function tokenPos(k: Token, clock: number): { p: Pt; t: number } | null {
  const t = (clock - k.start) / k.dur;
  if (t < 0) return null;
  const e = t >= 1 ? 1 : t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease-in-out
  return { p: pointAt(k.pts, e), t };
}

export function TokenShape({ k, clock }: { k: Token; clock: number }) {
  const pos = tokenPos(k, clock);
  if (!pos) return null;
  const [x, y] = pos.p;
  const fade = pos.t > 1 ? Math.max(0, 1 - (pos.t - 1) * 6) : 1;
  return (
    <g transform={`translate(${x},${y})`} opacity={fade} style={{ pointerEvents: "none" }}>
      {k.shape === "roll" && (<><circle r={11} fill="#a16207" stroke="#fde68a" strokeWidth={2} /><circle r={4} fill="#fde68a" /></>)}
      {k.shape === "sheet" && (<><rect x={-14} y={-8} width={28} height={16} rx={2} fill="#d6a756" stroke="#fff7e0" strokeWidth={1.5} /><path d="M-12,-2 q3,-4 6,0 t6,0 t6,0 t6,0" stroke="#7c4a10" fill="none" /></>)}
      {k.shape === "box" && (<><rect x={-12} y={-10} width={24} height={20} fill="#c08a3e" stroke="#fde68a" strokeWidth={1.5} /><path d="M-12,-3 h24 M0,-10 v7" stroke="#7c4a10" /></>)}
      {k.shape === "mail" && (<><rect x={-11} y={-8} width={22} height={16} rx={2} fill={k.color} stroke="#fff" strokeWidth={1.5} /><path d="M-11,-8 l11,8 l11,-8" stroke="#fff" fill="none" strokeWidth={1.5} /></>)}
      {k.shape === "dot" && (<><circle r={13} fill={k.color} opacity={0.25} /><circle r={7} fill={k.color} stroke="#fff" strokeWidth={2} /></>)}
      {k.label && (
        <g transform="translate(0,-20)">
          <rect x={-textW(k.label) / 2 - 7} y={-11} width={textW(k.label) + 14} height={18} rx={9} fill="rgba(15,23,42,.88)" stroke={k.color} />
          <text textAnchor="middle" y={2} fontSize={11} fill="#fff" fontWeight={600}>{k.label}</text>
        </g>
      )}
    </g>
  );
}
