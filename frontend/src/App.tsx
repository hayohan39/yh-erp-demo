import { Layout, Menu, Typography } from "antd";
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

const { Sider, Header, Content } = Layout;

export default function App() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const openKey = MENU.find((m) => m.children?.some((c) => c.key === pathname))?.key;

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <DefectAlerts />
      <Sider width={220} theme="dark" breakpoint="lg" collapsedWidth={0}>
        <div style={{ color: "#fff", padding: "18px 20px", fontWeight: 700, fontSize: 16 }}>YH 통합 ERP</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[pathname]}
          defaultOpenKeys={openKey ? [openKey] : []}
          items={MENU}
          onClick={(e) => nav(e.key)}
        />
      </Sider>
      <Layout>
        <Header style={{ background: "#fff", padding: "0 24px", borderBottom: "1px solid #eee" }}>
          <Typography.Title level={4} style={{ margin: "16px 0" }}>
            {findLabel(pathname) ?? ""}
          </Typography.Title>
        </Header>
        <Content style={{ padding: 24 }}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/sales/orders" element={<SalesOrders />} />
            <Route path="/master/:kind" element={<MasterTable />} />
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
