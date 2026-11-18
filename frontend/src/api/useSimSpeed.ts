import { useEffect, useState } from "react";
import { api } from "./client";

/** 레거시 시뮬레이터 배속. 모니터링 화면의 진행 막대·애니메이션 속도를 맞추는 데 쓴다. */
export function useSimSpeed(): number {
  const [speed, setSpeed] = useState(1);
  useEffect(() => {
    const load = () => api<{ speed: number }>("/api/sim/status").then((s) => setSpeed(s.speed)).catch(() => undefined);
    void load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);
  return speed;
}
