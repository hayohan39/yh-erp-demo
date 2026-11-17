import { Button, Card, Empty, Space, Table, Tag, Typography, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import { api, post } from "../api/client";
import { useEvents } from "../api/useEvents";
import { dt, won } from "../status";

interface Closable {
  order_no: string; customer_name: string; shipment_no: string | null; shipped_at: string | null;
  supply_amount: number; vat_amount: number; order_amount: number;
}
interface Invoice {
  invoice_no: string; order_no: string; customer_name: string; biz_no: string; supply_amount: number;
  vat_amount: number; total_amount: number; status: string; nts_approval_no: string | null;
  voucher_exported: boolean; created_at: string; issued_at: string | null;
}
interface Voucher {
  voucher_no: number; date: string; side: string; account_code: string; account_name: string; partner: string;
  debit: number; credit: number; memo: string; invoice_no: string;
}

/** 영업관리 → 매출 마감: 출하완료 수주를 마감하고 위아고에 세금계산서 발행을 요청한다. */
export function SalesClose() {
  const [rows, setRows] = useState<Closable[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<Closable[]>("/api/settlement/closable").then((r) => { setRows(r); setSel(r.map((x) => x.order_no)); }), []);
  useEffect(() => void load(), [load]);
  useEvents(["sales_order", "reset"], () => void load());

  const close = async () => {
    setBusy(true);
    try {
      const r = await post<{ invoices: string[] }>("/api/settlement/close", { order_nos: sel });
      message.success(`매출 마감 ${r.invoices.length}건 → 위아고 세금계산서 발행 요청`);
    } catch (e) { message.error(String(e)); }
    setBusy(false);
    void load();
  };
  const sum = (k: "supply_amount" | "vat_amount") => rows.filter((r) => sel.includes(r.order_no)).reduce((a, b) => a + b[k], 0);

  return (
    <Card title="매출 마감 대상 (출하완료)" extra={
      <Space>
        <Typography.Text>공급가액 <b>{won(sum("supply_amount"))}</b> · 부가세 {won(sum("vat_amount"))}</Typography.Text>
        <Button type="primary" disabled={!sel.length} loading={busy} onClick={close}>매출 마감 · 세금계산서 발행</Button>
      </Space>}>
      {rows.length === 0 ? <Empty description="출하완료된 수주가 없습니다" /> : (
        <Table rowKey="order_no" dataSource={rows} pagination={false} size="middle" scroll={{ x: true }}
          rowSelection={{ selectedRowKeys: sel, onChange: (k) => setSel(k as string[]) }}
          columns={[
            { title: "수주번호", dataIndex: "order_no" },
            { title: "거래처", dataIndex: "customer_name" },
            { title: "출하번호", dataIndex: "shipment_no" },
            { title: "출발", dataIndex: "shipped_at", render: dt },
            { title: "수주 금액", dataIndex: "order_amount", align: "right", render: won },
            { title: "공급가액(출하 기준)", dataIndex: "supply_amount", align: "right", render: won },
            { title: "부가세", dataIndex: "vat_amount", align: "right", render: won },
          ]} />
      )}
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
        공급가액은 실제 출하한 양품 수량 × 단가입니다. 마감하면 위아고(IF-EXT-01)로 발행을 요청하고, 국세청 승인번호가 오면 OMS에 매출마감(IF-OMS-03)을 통보합니다.
      </Typography.Paragraph>
    </Card>
  );
}

/** 영업관리 → 세금계산서: 발행 현황과 더존 전표 내보내기. */
export function Invoices() {
  const [rows, setRows] = useState<Invoice[]>([]);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    void api<Invoice[]>("/api/settlement/invoices").then(setRows);
    void api<Voucher[]>("/api/settlement/vouchers").then(setVouchers);
  }, []);
  useEffect(() => load(), [load]);
  useEvents(["invoice", "sales_order", "voucher", "reset"], () => load());

  const exportCsv = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/settlement/vouchers/export", { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).detail ?? res.statusText);
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "douzone_voucher.csv";
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      a.click();
      URL.revokeObjectURL(url);
      message.success(`더존 전표 ${res.headers.get("X-Voucher-Count")}건을 엑셀(CSV)로 내보냈습니다`);
    } catch (e) { message.error(String(e)); }
    setBusy(false);
    load();
  };
  const pending = rows.filter((r) => r.status === "ISSUED" && !r.voucher_exported).length;

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="전자세금계산서 (위아고)">
        <Table rowKey="invoice_no" dataSource={rows} size="middle" pagination={{ pageSize: 10 }} scroll={{ x: true }}
          locale={{ emptyText: "발행 내역이 없습니다" }}
          columns={[
            { title: "계산서번호", dataIndex: "invoice_no" },
            { title: "수주번호", dataIndex: "order_no" },
            { title: "공급받는자", dataIndex: "customer_name", render: (v, r) => <span>{v}<br /><small style={{ color: "#64748b" }}>{r.biz_no}</small></span> },
            { title: "공급가액", dataIndex: "supply_amount", align: "right", render: won },
            { title: "부가세", dataIndex: "vat_amount", align: "right", render: won },
            { title: "합계", dataIndex: "total_amount", align: "right", render: won },
            { title: "국세청 승인번호", dataIndex: "nts_approval_no", render: (v) => v ?? <Tag color="processing">승인 대기</Tag> },
            { title: "발행", dataIndex: "issued_at", render: dt },
            { title: "상태", dataIndex: "status", render: (s, r) => s === "ISSUED"
              ? <Space size={4}><Tag color="green">발행 완료</Tag>{r.voucher_exported && <Tag>전표 전송</Tag>}</Space>
              : <Tag color="orange">발행 요청</Tag> },
          ]} />
      </Card>
      <Card title="더존 회계 전표" extra={
        <Button type="primary" disabled={!pending} loading={busy} onClick={exportCsv}>새 전표 {pending}건 엑셀 내보내기</Button>}>
        <Table rowKey={(r) => `${r.invoice_no}-${r.account_code}`} dataSource={vouchers} size="small" pagination={{ pageSize: 12 }} scroll={{ x: true }}
          locale={{ emptyText: "세금계산서가 발행되면 매출 전표가 자동으로 만들어집니다" }}
          columns={[
            { title: "전표", dataIndex: "voucher_no" },
            { title: "일자", dataIndex: "date" },
            { title: "구분", dataIndex: "side", render: (v) => <Tag color={v === "차변" ? "blue" : "magenta"}>{v}</Tag> },
            { title: "계정", dataIndex: "account_name", render: (v, r) => `${r.account_code} ${v}` },
            { title: "거래처", dataIndex: "partner" },
            { title: "차변", dataIndex: "debit", align: "right", render: (v) => (v ? won(v) : "") },
            { title: "대변", dataIndex: "credit", align: "right", render: (v) => (v ? won(v) : "") },
            { title: "적요", dataIndex: "memo" },
          ]} />
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          더존은 수작업 연계 대상이라 일반전표 업로드 양식(CSV)으로 내보내고, 내보낸 이력은 I/F 모니터에 IF-EXT-05로 남습니다.
        </Typography.Paragraph>
      </Card>
    </Space>
  );
}
