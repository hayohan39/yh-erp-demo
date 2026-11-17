import { Button, Layout, Menu, Spin, Typography } from "antd";
import { MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import { Suspense, lazy, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ADMIN_MENU, MENU, findLabel } from "./menu";
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
// 3D 화면(three.js)은 해당 메뉴를 열 때만 내려받는다.
const EquipmentMonitor = lazy(() => import("./pages/EquipmentMonitor"));
const FacilityMonitor = lazy(() => import("./pages/FacilityMonitor"));
const SystemArchitecture = lazy(() => import("./pages/SystemArchitecture"));
import { DispatchBoard, ShippingRequests } from "./pages/Shipping";
import { Invoices, SalesClose } from "./pages/Settlement";
import { OrderCosts, QuoteCalculator } from "./pages/Cost";

const { Sider, Header, Content } = Layout;

export default function App() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const openKey = MENU.find((m) => m.children?.some((c) => c.key === pathname))?.key;
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 992);
  const [narrow, setNarrow] = useState(() => window.innerWidth < 992);
  const go = (e: { key: string }) => { nav(e.key); if (narrow) setCollapsed(true); };

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <DefectAlerts />
      <Sider
        width={220} theme="dark" breakpoint="lg" collapsedWidth={0} collapsible collapsed={collapsed} trigger={null}
        onBreakpoint={(b) => { setNarrow(b); setCollapsed(b); }}
        style={{ position: narrow ? "fixed" : "sticky", top: 0, left: 0, height: "100vh", overflow: "auto", zIndex: 20 }}
      >
        {/* 접힌 상태(폭 0)에서는 메뉴를 그리지 않는다: 열린 하위 메뉴가 팝업으로 떠 화면을 가리는 문제 방지 */}
        {!collapsed && <div style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
          <div style={{ color: "#fff", padding: "18px 20px", fontWeight: 700, fontSize: 16 }}>YH 통합 ERP</div>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[pathname]}
            defaultOpenKeys={openKey ? [openKey] : []}
            items={MENU}
            onClick={go}
          />
          <div style={{ marginTop: "auto", paddingTop: 16 }}>
            <div style={{ margin: "0 16px", padding: "10px 4px 4px", borderTop: "1px solid rgba(255,255,255,.12)", color: "rgba(255,255,255,.45)", fontSize: 12, display: "flex", justifyContent: "space-between" }}>
              <span>관리자용</span><span>시연·연동 점검</span>
            </div>
            <Menu theme="dark" mode="inline" selectedKeys={[pathname]} items={ADMIN_MENU} onClick={go}
              style={{ background: "transparent", paddingBottom: 12 }} />
          </div>
        </div>}
      </Sider>
      <Layout>
        <Header style={{ background: "#fff", padding: "0 16px", borderBottom: "1px solid #eee", display: "flex", alignItems: "center", gap: 8, position: "sticky", top: 0, zIndex: 10 }}>
          <Button type="text" aria-label="메뉴 열기/닫기" onClick={() => setCollapsed((c) => !c)}
            icon={collapsed ? <MenuUnfoldOutlined style={{ fontSize: 18 }} /> : <MenuFoldOutlined style={{ fontSize: 18 }} />} />
          <Typography.Title level={4} style={{ margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {findLabel(pathname) ?? ""}
          </Typography.Title>
        </Header>
        {narrow && !collapsed && (
          <div onClick={() => setCollapsed(true)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 15 }} />
        )}
        <Content style={{ padding: 16 }}>
          <Suspense fallback={<div style={{ padding: 80, textAlign: "center" }}><Spin size="large" /></div>}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/monitor/equipment" element={<EquipmentMonitor />} />
            <Route path="/monitor/facility" element={<FacilityMonitor />} />
            <Route path="/architecture" element={<SystemArchitecture />} />
            <Route path="/monitor/factory" element={<Navigate to="/monitor/equipment" replace />} />
            <Route path="/monitor/interfaces" element={<Navigate to="/architecture" replace />} />
            <Route path="/sales/orders" element={<SalesOrders />} />
            <Route path="/sales/close" element={<SalesClose />} />
            <Route path="/sales/invoice" element={<Invoices />} />
            <Route path="/shipping/requests" element={<ShippingRequests />} />
            <Route path="/shipping/dispatch" element={<DispatchBoard />} />
            <Route path="/cost/orders" element={<OrderCosts />} />
            <Route path="/cost/quote" element={<QuoteCalculator />} />
            <Route path="/master/:kind" element={<MasterTable />} />
            <Route path="/scheduling/corrugator" element={<CorrugatorPlan />} />
            <Route path="/production/work-orders" element={<WorkOrders />} />
            <Route path="/production/board" element={<ProductionBoard />} />
            <Route path="/quality/defects" element={<Defects />} />
            <Route path="/system/if-monitor" element={<IfMonitor />} />
            <Route path="/system/simulator" element={<SimulatorControl />} />
            <Route path="*" element={<Placeholder />} />
          </Routes>
          </Suspense>
        </Content>
      </Layout>
    </Layout>
  );
}
