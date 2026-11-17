import { Button, Layout, Menu, Typography } from "antd";
import { MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { MENU, findLabel } from "./menu";
import Dashboard from "./pages/Dashboard";
import IfMonitor from "./pages/IfMonitor";
import SimulatorControl from "./pages/SimulatorControl";
import SalesOrders from "./pages/SalesOrders";
import MasterTable from "./pages/MasterTable";
import Placeholder from "./pages/Placeholder";
import CorrugatorPlan from "./pages/CorrugatorPlan";
import WorkOrders from "./pages/WorkOrders";
import ProductionBoard from "./pages/ProductionBoard";
import Defects from "./pages/Defects";
import DefectAlerts from "./components/DefectAlerts";
import LiveStatus from "./components/LiveStatus";
import FactoryMap from "./pages/FactoryMap";
import IfFlowMap from "./pages/IfFlowMap";
import { DispatchBoard, ShippingRequests } from "./pages/Shipping";
import { Invoices, SalesClose } from "./pages/Settlement";
import { OrderCosts, QuoteCalculator } from "./pages/Cost";
import { StockAdjust, StockBalances, StockMoves, StockTransfer } from "./pages/ext/Inventory";
import { AutoOrder, Expenses, PaperRequirements, PurchaseOrders, Purchases, SubMaterials } from "./pages/ext/Material";
import { Allocation, Claims, Customers, Receivables, SalesLedger } from "./pages/ext/SalesExt";
import {
  Certs, DevCosts, Freight, Outsource, Pallets, Processes, ProductionResults, Specs, Tooling, WorkLogPage,
} from "./pages/ext/OpsExt";
import { CommonCodes, CostRates, Prices } from "./pages/ext/MasterExt";
import { BoxGantt, DispatchPlan, SchedSettings } from "./pages/ext/SchedulingExt";
import { CostAnalysis, StandardCost } from "./pages/ext/CostExt";
import MisAnalysis from "./pages/ext/Mis";

const { Sider, Header, Content } = Layout;

export default function App() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const openKey = MENU.find((m) => m.children?.some((c) => c.key === pathname))?.key;
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 992);
  const [narrow, setNarrow] = useState(() => window.innerWidth < 992);
  // 열린 상위 메뉴를 현재 화면에 맞춘다. 대시보드 카드 등으로 다른 모듈 화면에 가도 해당 메뉴가 펼쳐진다.
  const [openKeys, setOpenKeys] = useState<string[]>(openKey ? [openKey] : []);
  useEffect(() => {
    if (openKey) setOpenKeys((ks) => (ks.includes(openKey) ? ks : [...ks, openKey]));
  }, [openKey]);
  const title = findLabel(pathname);
  useEffect(() => { document.title = title ? `${title} · YH 통합 ERP` : "YH 통합 ERP"; }, [title]);

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <DefectAlerts />
      <Sider
        width={220} theme="dark" breakpoint="lg" collapsedWidth={0} collapsible collapsed={collapsed} trigger={null}
        onBreakpoint={(b) => { setNarrow(b); setCollapsed(b); }}
        style={{ position: narrow ? "fixed" : "sticky", top: 0, left: 0, height: "100vh", overflow: "auto", zIndex: 20 }}
      >
        <div style={{ color: "#fff", padding: "18px 20px", fontWeight: 700, fontSize: 16 }}>YH 통합 ERP</div>
        {/* 접힌 상태에서 Menu를 그리면 펼쳐 둔 하위 메뉴가 팝업으로 본문 위에 떠 있는 문제가 있어 숨긴다 */}
        {!collapsed && (
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[pathname]}
            openKeys={openKeys}
            onOpenChange={setOpenKeys}
            items={MENU}
            onClick={(e) => { nav(e.key); if (narrow) setCollapsed(true); }}
          />
        )}
      </Sider>
      <Layout>
        <Header style={{ background: "#fff", padding: "0 16px", borderBottom: "1px solid #eee", display: "flex", alignItems: "center", gap: 8, position: "sticky", top: 0, zIndex: 10 }}>
          <Button type="text" aria-label="메뉴 열기/닫기" onClick={() => setCollapsed((c) => !c)}
            icon={collapsed ? <MenuUnfoldOutlined style={{ fontSize: 18 }} /> : <MenuFoldOutlined style={{ fontSize: 18 }} />} />
          <Typography.Title level={4} style={{ margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {title ?? ""}
          </Typography.Title>
          <LiveStatus />
        </Header>
        {narrow && !collapsed && (
          <div onClick={() => setCollapsed(true)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 15 }} />
        )}
        <Content style={{ padding: 16 }}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/monitor/factory" element={<FactoryMap />} />
            <Route path="/monitor/interfaces" element={<IfFlowMap />} />
            <Route path="/sales/orders" element={<SalesOrders />} />
            <Route path="/sales/close" element={<SalesClose />} />
            <Route path="/sales/invoice" element={<Invoices />} />
            <Route path="/shipping/requests" element={<ShippingRequests />} />
            <Route path="/shipping/dispatch" element={<DispatchBoard />} />
            <Route path="/cost/orders" element={<OrderCosts />} />
            <Route path="/cost/quote" element={<QuoteCalculator />} />
            <Route path="/master/codes" element={<CommonCodes />} />
            <Route path="/master/material-cost" element={<Prices mode="material" />} />
            <Route path="/master/process-cost" element={<CostRates groups={["PROCESS", "FREIGHT"]} />} />
            <Route path="/master/prices" element={<Prices mode="sales" />} />
            <Route path="/master/:kind" element={<MasterTable />} />
            <Route path="/sales/customers" element={<Customers />} />
            <Route path="/sales/allocation" element={<Allocation />} />
            <Route path="/sales/ledger" element={<SalesLedger />} />
            <Route path="/sales/receivables" element={<Receivables />} />
            <Route path="/sales/claims" element={<Claims />} />
            <Route path="/scheduling/settings" element={<SchedSettings />} />
            <Route path="/scheduling/gantt" element={<BoxGantt />} />
            <Route path="/scheduling/dispatch" element={<DispatchPlan />} />
            <Route path="/scheduling/auto-order" element={<AutoOrder />} />
            <Route path="/production/results" element={<ProductionResults />} />
            <Route path="/production/outsource" element={<Outsource />} />
            <Route path="/production/adjust" element={<StockAdjust />} />
            <Route path="/production/work-log" element={<WorkLogPage />} />
            <Route path="/production/processes" element={<Processes />} />
            <Route path="/quality/specs" element={<Specs />} />
            <Route path="/quality/dev-costs" element={<DevCosts />} />
            <Route path="/quality/certs" element={<Certs />} />
            <Route path="/quality/tooling" element={<Tooling />} />
            <Route path="/material/requirements" element={<PaperRequirements />} />
            <Route path="/material/orders" element={<PurchaseOrders />} />
            <Route path="/material/purchases" element={<Purchases />} />
            <Route path="/material/paper-stock" element={<StockBalances kind="PAPER" />} />
            <Route path="/material/transfer-site" element={<StockTransfer kind="PAPER" mode="site" />} />
            <Route path="/material/transfer-wh" element={<StockTransfer kind="PAPER" mode="warehouse" />} />
            <Route path="/material/sub" element={<SubMaterials />} />
            <Route path="/material/expenses" element={<Expenses />} />
            <Route path="/shipping/moves" element={<StockMoves kind="PRODUCT" />} />
            <Route path="/shipping/stock" element={<StockBalances kind="PRODUCT" />} />
            <Route path="/shipping/transfer-wh" element={<StockTransfer kind="PRODUCT" mode="warehouse" />} />
            <Route path="/shipping/transfer-site" element={<StockTransfer kind="PRODUCT" mode="site" />} />
            <Route path="/shipping/freight" element={<Freight />} />
            <Route path="/shipping/pallets" element={<Pallets />} />
            <Route path="/cost/settings" element={<CostRates groups={["COST", "PROCESS"]} />} />
            <Route path="/cost/standard" element={<StandardCost />} />
            <Route path="/cost/analysis" element={<CostAnalysis />} />
            <Route path="/mis/trend" element={<Navigate to="/mis/sales" replace />} />
            <Route path="/mis/:metric" element={<MisAnalysis />} />
            <Route path="/scheduling/corrugator" element={<CorrugatorPlan />} />
            <Route path="/production/work-orders" element={<WorkOrders />} />
            <Route path="/production/board" element={<ProductionBoard />} />
            <Route path="/quality/defects" element={<Defects />} />
            <Route path="/system/if-monitor" element={<IfMonitor />} />
            <Route path="/system/simulator" element={<SimulatorControl />} />
            <Route path="*" element={<Placeholder />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}
