import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConfigProvider } from "antd";
import koKR from "antd/locale/ko_KR";
import "dayjs/locale/ko";
import App from "./App";
import { AuthGate } from "./auth";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider locale={koKR} theme={{ token: { colorPrimary: "#1d4ed8", borderRadius: 6 } }}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthGate><App /></AuthGate>
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>,
);
