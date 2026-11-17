import { Card, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { codeLabel, num, won } from "../status";

type Row = Record<string, string | number | null>;
type Fmt = "code" | "num" | "won" | "pct" | "mm";
type Col = [string, string, Fmt?];
interface Source { title?: string; url: string; cols: Col[] }

const SOURCES: Record<string, Source[]> = {
  partners: [{ url: "/api/master/partners", cols: [["code", "코드"], ["name", "거래처명"], ["partner_type", "구분", "code"], ["biz_no", "사업자번호"], ["industry", "업종"]] }],
  items: [{ url: "/api/master/items", cols: [["code", "품목코드"], ["name", "품명"], ["customer_code", "거래처"], ["box_style", "형식"], ["length_mm", "장", "mm"], ["width_mm", "폭", "mm"], ["height_mm", "고", "mm"], ["board_spec_code", "원단"], ["print_colors", "도수"], ["unit_price", "단가", "won"], ["std_cost", "표준원가", "won"]] }],
  paper: [
    { title: "원지", url: "/api/master/paper-grades", cols: [["code", "코드"], ["name", "원지명"], ["paper_kind", "구분", "code"], ["basis_weight", "평량(g/m²)", "num"], ["price_per_kg", "kg 단가", "won"]] },
    { title: "원단 규격 (표면지 / 골심지 / 이면지)", url: "/api/master/board-specs", cols: [["code", "코드"], ["flute", "골"], ["outer_liner", "표면지"], ["medium", "골심지"], ["inner_liner", "이면지"]] },
  ],
  equipment: [{ url: "/api/master/equipment", cols: [["code", "코드"], ["name", "설비명"], ["process", "공정", "code"], ["legacy_system", "연동 시스템"], ["capacity_per_hour", "시간당 능력(매)", "num"], ["base_defect_rate", "기본 불량률", "pct"]] }],
};

const FMT: Record<Fmt, (v: unknown) => string> = {
  code: (v) => codeLabel(v as string | null),
  num: (v) => num(v as number | null),
  won: (v) => won(v as number | null),
  pct: (v) => (v == null ? "-" : `${((v as number) * 100).toFixed(1)}%`),
  mm: (v) => (v == null ? "-" : `${v}`),
};
const RIGHT: Fmt[] = ["num", "won", "pct", "mm"];

function MasterGrid({ src }: { src: Source }) {
  const [rows, setRows] = useState<Row[]>();
  useEffect(() => {
    setRows(undefined);
    api<Row[]>(src.url).then(setRows).catch(() => setRows([]));
  }, [src]);
  const columns: ColumnsType<Row> = src.cols.map(([k, t, f]) => ({
    title: t, dataIndex: k, align: f && RIGHT.includes(f) ? "right" : undefined,
    render: f ? (v: unknown) => FMT[f](v) : (v: unknown) => (v ?? "-") as string,
  }));
  return (
    <Card title={src.title} size={src.title ? "small" : undefined}
      extra={rows && <Typography.Text type="secondary">{rows.length}건</Typography.Text>}>
      <Table rowKey="code" dataSource={rows} loading={!rows} size="middle" pagination={{ pageSize: 30, hideOnSinglePage: true }}
        scroll={{ x: "max-content" }} columns={columns} />
    </Card>
  );
}

export default function MasterTable() {
  const { kind = "partners" } = useParams();
  const srcs = SOURCES[kind];
  if (!srcs) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {srcs.map((s) => <MasterGrid key={s.url} src={s} />)}
    </div>
  );
}
