import { Alert, Button, Card, Form, Input, Spin, Typography } from "antd";
import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { TOKEN_KEY, api, errMsg, getToken, post } from "./api/client";

export interface User {
  id: number;
  username: string;
  name: string;
  department: string | null;
  role: "ADMIN" | "USER";
  active: boolean;
  created_at: string;
  last_login_at: string | null;
}

interface AuthCtx { user: User; setUser: (u: User) => void; logout: () => void }
const Ctx = createContext<AuthCtx | null>(null);
export const useAuth = () => useContext(Ctx)!;

function saveToken(t: string | null) {
  try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* 저장 불가 환경 */ }
}

/** 로그인 전에는 로그인 화면만 보여주고, 로그인하면 ERP 전체(children)를 연다. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(getToken() ? undefined : null);
  const logout = useCallback(() => { saveToken(null); setUser(null); }, []);

  useEffect(() => {
    if (user !== undefined) return;
    api<User>("/api/auth/me").then(setUser).catch(() => { saveToken(null); setUser(null); });
  }, [user]);
  useEffect(() => {
    window.addEventListener("auth:expired", logout);
    return () => window.removeEventListener("auth:expired", logout);
  }, [logout]);

  if (user === undefined) return <div style={{ padding: 120, textAlign: "center" }}><Spin size="large" /></div>;
  if (user === null) return <Login onLogin={(t, u) => { saveToken(t); setUser(u); }} />;
  return <Ctx.Provider value={{ user, setUser, logout }}>{children}</Ctx.Provider>;
}

function Login({ onLogin }: { onLogin: (token: string, u: User) => void }) {
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => { document.title = "로그인 · YH 통합 ERP"; }, []);
  const submit = async (v: { username: string; password: string }) => {
    setBusy(true); setErr(undefined);
    try {
      const r = await post<{ token: string; user: User }>("/api/auth/login", v);
      onLogin(r.token, r.user);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      background: "linear-gradient(135deg, #1b1e22 0%, #22262b 55%, #0b4f5c 100%)" }}>
      <Card style={{ width: "100%", maxWidth: 380, boxShadow: "0 20px 50px rgba(0,0,0,.35)" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <Typography.Title level={3} style={{ margin: 0 }}>YH 통합 ERP</Typography.Title>
          <Typography.Text type="secondary">골판지 통합 생산·영업 관리 시스템</Typography.Text>
        </div>
        {err && <Alert type="error" showIcon message={err} style={{ marginBottom: 16 }} />}
        <Form layout="vertical" onFinish={submit} requiredMark={false} autoComplete="on">
          <Form.Item name="username" label="아이디" rules={[{ required: true, message: "아이디를 입력하세요" }]}>
            <Input prefix={<UserOutlined />} size="large" autoFocus autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="비밀번호" rules={[{ required: true, message: "비밀번호를 입력하세요" }]}>
            <Input.Password prefix={<LockOutlined />} size="large" autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" size="large" block loading={busy}>로그인</Button>
        </Form>
      </Card>
    </div>
  );
}
