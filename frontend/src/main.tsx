import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConfigProvider } from "antd";
import koKR from "antd/locale/ko_KR";
import "dayjs/locale/ko";
import App from "./App";
import { AuthGate } from "./auth";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./styles.css";
import { THEMES, ThemeCtx, type ThemeKey, initialTheme, saveTheme } from "./theme";

function Root() {
  const [key, setKey] = useState<ThemeKey>(initialTheme);
  const theme = THEMES[key];
  useEffect(() => { document.documentElement.dataset.theme = key; }, [key]);
  const setTheme = (k: ThemeKey) => { saveTheme(k); setKey(k); };
  return (
    <ThemeCtx.Provider value={{ theme, setTheme }}>
      <ConfigProvider locale={koKR} theme={theme.antd}>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AuthGate><App /></AuthGate>
        </BrowserRouter>
      </ConfigProvider>
    </ThemeCtx.Provider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
