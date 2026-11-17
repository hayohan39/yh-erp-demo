import { Badge, Tooltip } from "antd";
import { useEffect, useState } from "react";
import { api } from "../api/client";

interface SimStatus { running: boolean; speed: number }

/** 헤더 오른쪽: 레거시 시뮬레이터 가동 여부와 배속. 시연 중 "지금 데이터가 흐르고 있는지"를 한눈에 보여준다. */
export default function LiveStatus() {
  const [st, setSt] = useState<SimStatus | null>();
  useEffect(() => {
    const load = () => api<SimStatus>("/api/sim/status").then(setSt).catch(() => setSt(null));
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  if (st === undefined) return null;
  const [status, text, tip] = st === null
    ? ["error", "연동 끊김", "레거시 시뮬레이터에 연결할 수 없습니다"] as const
    : st.running
      ? ["processing", `실시간 연동 중 · ${st.speed}x`, "레거시 시스템(시뮬레이터)이 데이터를 보내고 있습니다"] as const
      : ["default", "연동 대기", "레거시 시뮬레이터가 정지 상태입니다"] as const;
  return (
    <Tooltip title={tip}>
      <span style={{ marginLeft: "auto", whiteSpace: "nowrap", fontSize: 13 }}><Badge status={status} text={text} /></span>
    </Tooltip>
  );
}
