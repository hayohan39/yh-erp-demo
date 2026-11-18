import { Avatar, Dropdown, Tag } from "antd";
import { BgColorsOutlined, CheckOutlined, LogoutOutlined, SettingOutlined, UserOutlined } from "@ant-design/icons";
import { THEMES, type ThemeKey, useAppTheme } from "../theme";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

/** 헤더 오른쪽 끝: 로그인 사용자 이름, 개인 설정·로그아웃 메뉴. */
export default function UserMenu() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const { theme, setTheme } = useAppTheme();
  return (
    <Dropdown trigger={["click"]} menu={{
      items: [
        { key: "who", disabled: true, label: <span>{user.name} ({user.username}){user.role === "ADMIN" && <Tag color="blue" style={{ marginLeft: 6 }}>관리자</Tag>}</span> },
        { type: "divider" },
        { key: "settings", icon: <SettingOutlined />, label: "개인 설정" },
        {
          key: "theme", icon: <BgColorsOutlined />, label: "화면 테마",
          children: Object.values(THEMES).map((t) => ({
            key: `theme:${t.key}`, label: <span>{t.label} {t.key === theme.key && <CheckOutlined style={{ marginLeft: 6 }} />}</span>,
          })),
        },
        { key: "logout", icon: <LogoutOutlined />, label: "로그아웃" },
      ],
      onClick: ({ key }) => { if (key.startsWith("theme:")) setTheme(key.slice(6) as ThemeKey); if (key === "settings") nav("/settings"); if (key === "logout") logout(); },
    }}>
      <span style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", marginLeft: 8 }}>
        <Avatar size="small" icon={<UserOutlined />} className="user-avatar" />
        <span className="user-menu-name">{user.name}</span>
      </span>
    </Dropdown>
  );
}
