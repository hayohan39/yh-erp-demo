import { Table } from "antd";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";

type Row = Record<string, string | number | null>;

const SOURCES: Record<string, { url: string; cols: [string, string][] }> = {
  partners: { url: "/api/master/partners", cols: [["code", "코드"], ["name", "거래처명"], ["partner_type", "구분"], ["biz_no", "사업자번호"], ["industry", "업종"]] },
  items: { url: "/api/master/items", cols: [["code", "품목코드"], ["name", "품명"], ["customer_code", "거래처"], ["box_style", "형식"], ["length_mm", "장"], ["width_mm", "폭"], ["height_mm", "고"], ["board_spec_code", "원단"], ["print_colors", "도수"], ["unit_price", "단가"], ["std_cost", "표준원가"]] },
  paper: { url: "/api/master/paper-grades", cols: [["code", "코드"], ["name", "원지명"], ["paper_kind", "구분"], ["basis_weight", "평량"], ["price_per_kg", "kg단가"]] },
  warehouses: { url: "/api/master/warehouses", cols: [["code", "코드"], ["name", "창고명"], ["site", "사업장"], ["kind", "구분(PAPER 원지 · PRODUCT 제품 · SUB 부자재)"]] },
  equipment: { url: "/api/master/equipment", cols: [["code", "코드"], ["name", "설비명"], ["process", "공정"], ["legacy_system", "연동 시스템"], ["capacity_per_hour", "시간당 능력"], ["base_defect_rate", "기본 불량률"]] },
};

export default function MasterTable() {
  const { kind = "partners" } = useParams();
  const src = SOURCES[kind];
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if (src) api<Row[]>(src.url).then(setRows);
  }, [src]);
  if (!src) return null;
  return (
    <Table rowKey="code" dataSource={rows} size="middle" pagination={{ pageSize: 30 }} scroll={{ x: true }}
      columns={src.cols.map(([k, t]) => ({ title: t, dataIndex: k }))} />
  );
}
