import { notification } from "antd";
import { useNavigate } from "react-router-dom";
import { useEvents } from "../api/useEvents";

interface DefectEvent { defect_no: string; wo_no: string; process: string; equipment_code: string; defect_type: string; defect_rate: number }

/** 어느 화면에 있든 불량 발생 시 알림을 띄운다. */
export default function DefectAlerts() {
  const nav = useNavigate();
  const [api, holder] = notification.useNotification();
  useEvents(["defect"], (_, data) => {
    const d = data as DefectEvent;
    api.error({
      key: d.defect_no,
      message: `불량 발생 · ${d.process} (${d.equipment_code})`,
      description: `${d.wo_no} ${d.defect_type} 불량률 ${(d.defect_rate * 100).toFixed(1)}%. 클릭하면 대책 등록 화면으로 이동합니다.`,
      duration: 0,
      onClick: () => { nav("/quality/defects"); api.destroy(d.defect_no); },
      style: { cursor: "pointer" },
    });
  });
  return holder;
}
