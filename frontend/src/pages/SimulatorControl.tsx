import { Button, Card, Descriptions, InputNumber, Popconfirm, Space, Switch, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import { api, post } from "../api/client";

interface SimStatus {
  running: boolean; speed: number; sent: number; failed: number; received: number;
  defect_spike: boolean; production: Record<string, number>;
}

export default function SimulatorControl() {
  const [st, setSt] = useState<SimStatus>();
  const [speed, setSpeed] = useState(1);
  const load = useCallback(() => api<SimStatus>("/api/sim/status").then((s) => { setSt(s); setSpeed(s.speed); }), []);
  useEffect(() => {
    void load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); message.success(ok); } catch (e) { message.error(String(e)); }
    load();
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="레거시 I/F 시뮬레이터">
        <Descriptions column={{ xs: 1, md: 3 }} items={[
          { label: "상태", children: st?.running ? "실행 중" : "정지" },
          { label: "배속", children: `${st?.speed ?? "-"}x` },
          { label: "ERP 송신 / 실패", children: `${st?.sent ?? 0} / ${st?.failed ?? 0}` },
          { label: "ERP 지시 수신", children: st?.received ?? 0 },
          {
            label: "설비 생산 (대기/골판지기/인쇄/가공/완료)",
            children: ["QUEUED", "CORRUGATE", "PRINT", "CONVERT", "DONE"].map((k) => st?.production?.[k] ?? 0).join(" / "),
          },
        ]} />
        <Space wrap style={{ marginTop: 16 }}>
          <Button type="primary" disabled={st?.running} onClick={() => run(() => post("/api/sim/start"), "시작")}>시작</Button>
          <Button disabled={!st?.running} onClick={() => run(() => post("/api/sim/stop"), "정지")}>정지</Button>
          <InputNumber min={0.1} max={60} step={1} value={speed} onChange={(v) => setSpeed(v ?? 1)} addonAfter="배속" />
          <Button onClick={() => run(() => post("/api/sim/speed", { speed }), "배속 변경")}>적용</Button>
        </Space>
      </Card>
      <Card title="수동 발생 (시연용)">
        <Space wrap>
          <Button onClick={() => run(() => post("/api/sim/oms/order"), "OMS 주문 1건 전송")}>OMS 일반 주문</Button>
          <Button type="primary" onClick={() => run(() => post("/api/sim/oms/order?large=true"), "OMS 대형 주문 전송")}>OMS 대형 주문</Button>
          <span>
            다음 인쇄 작업 불량 발생{" "}
            <Switch checked={st?.defect_spike} onChange={(on) => run(() => post("/api/sim/defect-spike", { on }), on ? "다음 인쇄 작업에서 불량이 발생합니다" : "취소")} />
          </span>
          <Popconfirm title="모든 거래 데이터를 지우고 기준정보 상태로 되돌립니다." onConfirm={() => run(() => post("/api/sim/reset"), "초기화 완료")}>
            <Button danger>데모 초기화</Button>
          </Popconfirm>
        </Space>
      </Card>
    </Space>
  );
}
