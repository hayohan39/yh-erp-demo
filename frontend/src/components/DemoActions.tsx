import { Button, Segmented, Space, Switch, Tooltip, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import { api, post } from "../api/client";

interface SimStatus { speed: number; defect_spike: boolean }

/** 맵 화면에서 바로 시연을 진행하는 버튼 묶음: 주문 발생 → 계획 수립·확정, 배속, 불량 발생. */
export default function DemoActions({ onSpeed }: { onSpeed?: (s: number) => void }) {
  const [st, setSt] = useState<SimStatus>();
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<SimStatus>("/api/sim/status").then((s) => { setSt(s); onSpeed?.(s.speed); }).catch(() => undefined), [onSpeed]);
  useEffect(() => {
    void load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); message.success(ok); } catch (e) { message.error(String(e).replace(/^Error: \d+ /, "")); }
    setBusy(false);
    void load();
  };
  const planAndConfirm = async () => {
    const plan = await post<{ plan_no: string; runs: unknown[] }>("/api/scheduling/plans");
    await post(`/api/scheduling/plans/${plan.plan_no}/confirm`);
  };

  return (
    <Space wrap size={8}>
      <Button onClick={() => act(() => post("/api/sim/oms/order"), "OMS 주문 1건 수신")} disabled={busy}>① OMS 주문</Button>
      <Button onClick={() => act(() => post("/api/sim/oms/order?large=true"), "OMS 대형 주문 수신")} disabled={busy}>① OMS 대형 주문</Button>
      <Tooltip title="대기 수주로 원단 폭 조합 계획을 만들고 바로 확정해 생산지시를 내립니다">
        <Button type="primary" onClick={() => act(planAndConfirm, "계획 확정, 생산지시 송신")} disabled={busy}>② 계획 수립·확정</Button>
      </Tooltip>
      <span style={{ marginLeft: 4 }}>배속</span>
      <Segmented size="small" value={st?.speed}
        options={[1, 5, 10, 20].map((v) => ({ label: `${v}x`, value: v }))}
        onChange={(v) => act(() => post("/api/sim/speed", { speed: Number(v) }), `배속 ${v}x`)} />
      <Tooltip title="다음 인쇄 작업 1건에서 불량률 6~9%가 발생합니다">
        <span>불량 발생 <Switch size="small" checked={st?.defect_spike}
          onChange={(on) => act(() => post("/api/sim/defect-spike", { on }), on ? "다음 인쇄 작업에서 불량 발생" : "취소")} /></span>
      </Tooltip>
    </Space>
  );
}
