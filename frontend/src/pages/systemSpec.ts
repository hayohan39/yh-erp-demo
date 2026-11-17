/**
 * 시스템 구성도 데이터: 제안서 '2.1 제안의 범위'(시스템 구성.png)의 시스템·모듈·하위 기능과
 * 레거시 I/F 18종의 데이터 명세(실제 게이트웨이·시뮬레이터가 주고받는 필드 기준).
 */
export type Dir = "IN" | "OUT";

export interface ModuleDef { key: string; label: string; scope: "rebuild" | "new"; phase?: string; funcs: string[] }
/** 배열 순서 = 구성도 3x3 배치 순서. 왼쪽 열은 사내 레거시, 오른쪽 열은 설비·외부와 맞닿는 모듈. */
export const MODULES: ModuleDef[] = [
  { key: "master", label: "기준정보", scope: "rebuild", funcs: ["거래처", "공통항목", "원재료비", "가공비", "상자마스터", "운반비", "단가관리"] },
  { key: "sales", label: "영업관리", scope: "rebuild", funcs: ["거래처관리", "수주관리", "수주전용", "판매관리", "전자세금계산서", "크레임 관리", "마감관리", "수금관리"] },
  { key: "ship", label: "출하관리", scope: "rebuild", funcs: ["출하요청", "입·출고", "재고관리", "배차상차", "제품 창고 이동", "제품 사업장 이동", "운반비 관리", "파렛 관리"] },
  { key: "qual", label: "품질관리", scope: "rebuild", funcs: ["시방 관리", "불량대책 관리", "개발비 관리", "성적서 관리", "조판 목형"] },
  { key: "sched", label: "자동 스케쥴링", scope: "new", phase: "2차", funcs: ["기준정보", "원단 스케쥴링", "상자 스케쥴링", "배차 스케쥴링", "원지 자동발주"] },
  { key: "prod", label: "생산관리", scope: "rebuild", funcs: ["생산지시", "생산진도", "생산실적", "외주·매입관리", "재고조정", "작업내역", "공정관리"] },
  { key: "mat", label: "자재관리", scope: "rebuild", funcs: ["원지소요관리", "발주관리", "구매관리", "재고관리", "원지 사업장 이동", "원지 창고 이동", "부자재 관리", "경비관리"] },
  { key: "cost", label: "원가분석", scope: "new", phase: "3차", funcs: ["기준정보", "실제원가", "표준원가", "견적원가", "원가분석"] },
  { key: "mis", label: "경영정보", scope: "rebuild", phase: "월·년", funcs: ["수주분석", "매출분석", "생산분석", "원지매입", "운반비분석"] },
];

export interface SystemDef {
  key: string; // I/F 카탈로그의 system 값
  label: string;
  desc: string;
  group: "legacy" | "equip" | "ext";
  funcs: string[];
  link: { in?: string; out?: string }; // 연결선 라벨(주고받는 데이터 요약)
  modules: string[];
  protocol: string;
}
export const SYSTEMS: SystemDef[] = [
  { key: "OMS", label: "OMS", desc: "주문관리", group: "legacy", funcs: ["주문 현황", "주문 등록", "매출 정산"],
    link: { in: "주문접수", out: "진도정보 · 매출마감" }, modules: ["sales"], protocol: "REST · JSON 봉투" },
  { key: "MES", label: "MES", desc: "생산관리", group: "legacy", funcs: ["생산지시", "생산실적", "창고용량", "인쇄도면", "다운타임", "모니터링"],
    link: { in: "실적보고 · 불량보고", out: "생산지시" }, modules: ["prod", "qual"], protocol: "REST · JSON 봉투" },
  { key: "PMS", label: "PMS", desc: "원지관리", group: "legacy", funcs: ["모니터링", "원지 사용", "원지 추적", "투입 수율", "재고 관리"],
    link: { in: "투입현황 · 사용내역", out: "원지입고 · 골게터 소요량" }, modules: ["mat", "sched", "cost"], protocol: "REST · JSON 봉투" },
  { key: "골게터 POP", label: "골게터 POP", desc: "골판지기 CG01", group: "equip", funcs: ["지시", "실적", "모니터링"],
    link: { in: "실적 · 불량 · 가동", out: "원단 생산지시" }, modules: ["prod", "sched", "qual"], protocol: "POP 어댑터" },
  { key: "에볼/썬라이즈", label: "에볼 · 썬라이즈", desc: "가공기 EV01", group: "equip", funcs: ["지시", "실적", "모니터링"],
    link: { in: "실적 · 불량 · 가동", out: "생산지시" }, modules: ["prod", "qual"], protocol: "설비 어댑터" },
  { key: "인쇄 5호기", label: "인쇄 5호기", desc: "인쇄기 PR05", group: "equip", funcs: ["지시", "실적", "모니터링"],
    link: { in: "실적 · 불량 · 가동", out: "생산지시" }, modules: ["prod", "qual"], protocol: "설비 어댑터" },
  { key: "위아고", label: "위아고", desc: "전자세금계산서", group: "ext", funcs: ["발행", "국세청 전송"],
    link: { in: "승인번호(콜백)", out: "전자세금계산서" }, modules: ["sales"], protocol: "외부 API · 콜백" },
  { key: "로지스팟", label: "로지스팟", desc: "배차 I/F", group: "ext", funcs: ["배차", "상차 확인"],
    link: { in: "배차확정 · 상차완료", out: "상차정보 · 배차요청" }, modules: ["ship"], protocol: "외부 API · 콜백" },
  { key: "오토콘", label: "우성 오토콘", desc: "컨베이어", group: "ext", funcs: ["원단 반송", "상자 지시"],
    link: { in: "상자지시 · 이송완료", out: "원단지시 · 현황" }, modules: ["prod", "sched"], protocol: "PLC 게이트웨이" },
  { key: "더존", label: "더존 시스템", desc: "재무회계", group: "ext", funcs: ["전표", "재무회계"],
    link: { out: "회계 전표(엑셀)" }, modules: ["mis", "sales"], protocol: "파일(CSV) · 수작업 업로드" },
];

export interface IfSpec { id: string; system: string; dir: Dir; name: string; when: string; fields: string[]; callback?: string[] }
export const IF_SPECS: IfSpec[] = [
  { id: "IF-OMS-01", system: "OMS", dir: "IN", name: "주문접수", when: "OMS 주문 등록 즉시",
    fields: ["oms_order_no", "customer_code", "order_date", "due_date", "lines[ item_code · qty · unit_price ]"] },
  { id: "IF-OMS-02", system: "OMS", dir: "OUT", name: "진도정보", when: "수주 상태 변경 시(수주확정·생산중·생산완료)",
    fields: ["oms_order_no", "erp_order_no", "status"] },
  { id: "IF-OMS-03", system: "OMS", dir: "OUT", name: "매출마감", when: "세금계산서 승인 시",
    fields: ["oms_order_no", "erp_order_no", "invoice_no", "nts_approval_no", "supply_amount", "vat_amount", "status"] },
  { id: "IF-MES-01", system: "MES", dir: "OUT", name: "생산지시", when: "생산계획 확정 시",
    fields: ["plan_no", "work_orders[ wo_no · item_code · board_spec · qty · routes[ seq · process · equipment_code ] ]"] },
  { id: "IF-MES-02", system: "MES", dir: "IN", name: "생산실적·불량보고", when: "작업지시 완료 시",
    fields: ["wo_no", "good_qty"] },
  { id: "IF-PMS-01", system: "PMS", dir: "IN", name: "원지 투입·사용내역", when: "골판지기 원지 투입 시(롤 단위)",
    fields: ["wo_no", "rolls[ roll_no · paper_code · used_kg ]"] },
  { id: "IF-PMS-02", system: "PMS", dir: "OUT", name: "원지입고·골게터 소요량", when: "생산계획 확정 시",
    fields: ["plan_no", "requirements[ paper_code · kg ]"] },
  { id: "IF-EQ-01", system: "골게터 POP", dir: "OUT", name: "원단 생산지시", when: "생산계획 확정 시(원단 폭 조합 결과)",
    fields: ["plan_no", "runs[ seq · board_spec · roll_width · cuts · length_m · slots[ wo_no · ups · sheets ] ]"] },
  { id: "IF-EQ-02", system: "골게터 POP", dir: "IN", name: "실적·불량·가동상태", when: "작업 시작·종료 시",
    fields: ["wo_no", "process", "event(START)", "good_qty", "defect_qty", "defect_type", "run_minutes"] },
  { id: "IF-EQ-03", system: "에볼/썬라이즈", dir: "OUT", name: "생산지시", when: "생산계획 확정 시",
    fields: ["plan_no", "work_orders[ wo_no · item_code · qty · routes ]"] },
  { id: "IF-EQ-04", system: "에볼/썬라이즈", dir: "IN", name: "실적·불량·가동상태", when: "작업 시작·종료 시",
    fields: ["wo_no", "process", "event(START)", "good_qty", "defect_qty", "defect_type", "run_minutes"] },
  { id: "IF-EQ-05", system: "인쇄 5호기", dir: "OUT", name: "생산지시", when: "생산계획 확정 시(인쇄 품목만)",
    fields: ["plan_no", "work_orders[ wo_no · item_code · qty · routes ]"] },
  { id: "IF-EQ-06", system: "인쇄 5호기", dir: "IN", name: "실적·불량·가동상태", when: "작업 시작·종료 시",
    fields: ["wo_no", "process", "event(START)", "good_qty", "defect_qty", "defect_type", "run_minutes"] },
  { id: "IF-EXT-01", system: "위아고", dir: "OUT", name: "전자세금계산서 발행", when: "매출 마감 시",
    fields: ["invoice_no", "erp_order_no", "issue_date", "supplier{ name · biz_no }", "buyer{ name · biz_no }", "supply_amount", "vat_amount", "total_amount"],
    callback: ["invoice_no", "nts_approval_no", "result"] },
  { id: "IF-EXT-02", system: "로지스팟", dir: "OUT", name: "상차정보·배차요청", when: "출하요청 시",
    fields: ["shipment_no", "erp_order_no", "customer_name", "due_date", "items[ item_code · item_name · qty ]", "total_qty"],
    callback: ["event(DISPATCHED·SHIPPED)", "shipment_no", "carrier_name", "vehicle_no", "driver_name"] },
  { id: "IF-EXT-03", system: "오토콘", dir: "OUT", name: "원단지시·현황", when: "생산계획 확정 시",
    fields: ["plan_no", "transfers[ wo_no · item_code · ups · sheets ]"] },
  { id: "IF-EXT-04", system: "오토콘", dir: "IN", name: "상자지시(원단 이송 완료)", when: "원단 반송 완료 시",
    fields: ["wo_no", "sheets"] },
  { id: "IF-EXT-05", system: "더존", dir: "OUT", name: "회계 전표(엑셀 내보내기)", when: "전표 내보내기 실행 시",
    fields: ["file_name", "vouchers", "lines", "debit_total", "credit_total"] },
];

export const ENVELOPE = ["if_id", "message_id", "source", "target", "sent_at", "payload"];
