import {
  App as AntApp, Button, Card, Col, Descriptions, Form, Input, Modal, Popconfirm, Row, Select, Space, Switch, Table, Tag,
} from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useState } from "react";
import { api, errMsg, post, send } from "../api/client";
import { useAuth, type User } from "../auth";

const when = (v: string | null) => (v ? v.slice(0, 16).replace("T", " ") : "-");

/** 개인 설정: 내 정보·비밀번호 변경, 관리자는 사용자 등록·관리까지. */
export default function Settings() {
  const { user } = useAuth();
  return (
    <AntApp>
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}><Profile /></Col>
          <Col xs={24} lg={12}><PasswordCard /></Col>
        </Row>
        {user.role === "ADMIN" && <UserAdmin />}
      </Space>
    </AntApp>
  );
}

function Profile() {
  const { user, setUser } = useAuth();
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const save = async (v: { name: string; department?: string }) => {
    try { setUser(await send<User>("PUT", "/api/auth/me", v)); message.success("내 정보를 저장했습니다"); }
    catch (e) { message.error(errMsg(e)); }
  };
  return (
    <Card title="내 정보" size="small" style={{ height: "100%" }}>
      <Descriptions size="small" column={1} style={{ marginBottom: 12 }} items={[
        { key: "id", label: "아이디", children: user.username },
        { key: "role", label: "권한", children: user.role === "ADMIN" ? <Tag color="blue">관리자</Tag> : <Tag>일반 사용자</Tag> },
        { key: "last", label: "최근 로그인", children: when(user.last_login_at) },
      ]} />
      <Form form={form} layout="vertical" initialValues={{ name: user.name, department: user.department ?? "" }} onFinish={save}>
        <Row gutter={12}>
          <Col xs={24} sm={12}><Form.Item name="name" label="이름" rules={[{ required: true, message: "이름을 입력하세요" }]}><Input /></Form.Item></Col>
          <Col xs={24} sm={12}><Form.Item name="department" label="부서"><Input /></Form.Item></Col>
        </Row>
        <Button type="primary" htmlType="submit">저장</Button>
      </Form>
    </Card>
  );
}

function PasswordCard() {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const save = async (v: { current_password: string; new_password: string }) => {
    try {
      await post("/api/auth/password", { current_password: v.current_password, new_password: v.new_password });
      message.success("비밀번호를 변경했습니다"); form.resetFields();
    } catch (e) { message.error(errMsg(e)); }
  };
  return (
    <Card title="비밀번호 변경" size="small" style={{ height: "100%" }}>
      <Form form={form} layout="vertical" onFinish={save}>
        <Form.Item name="current_password" label="현재 비밀번호" rules={[{ required: true, message: "현재 비밀번호를 입력하세요" }]}>
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Form.Item name="new_password" label="새 비밀번호" rules={[{ required: true, min: 4, message: "4자 이상 입력하세요" }]}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item name="confirm" label="새 비밀번호 확인" dependencies={["new_password"]} rules={[
          { required: true, message: "한 번 더 입력하세요" },
          ({ getFieldValue }) => ({ validator: (_, v) => (v === getFieldValue("new_password") ? Promise.resolve() : Promise.reject(new Error("새 비밀번호와 같지 않습니다"))) }),
        ]}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit">변경</Button>
      </Form>
    </Card>
  );
}

interface NewUser { username: string; password: string; name: string; department?: string; role: "ADMIN" | "USER" }

function UserAdmin() {
  const { user: me } = useAuth();
  const { message } = AntApp.useApp();
  const [rows, setRows] = useState<User[]>();
  const [adding, setAdding] = useState(false);
  const [pwFor, setPwFor] = useState<User | null>(null);
  const [addForm] = Form.useForm<NewUser>();
  const [pwForm] = Form.useForm<{ password: string }>();
  const load = useCallback(() => { api<User[]>("/api/users").then(setRows).catch((e) => message.error(errMsg(e))); }, [message]);
  useEffect(load, [load]);

  const patch = async (u: User, body: Partial<User> & { password?: string }, ok: string) => {
    try { await send("PATCH", `/api/users/${u.id}`, body); message.success(ok); load(); }
    catch (e) { message.error(errMsg(e)); }
  };
  const create = async (v: NewUser) => {
    try {
      await post("/api/users", v);
      message.success(`${v.name}(${v.username}) 사용자를 등록했습니다`);
      setAdding(false); addForm.resetFields(); load();
    } catch (e) { message.error(errMsg(e)); }
  };
  const remove = async (u: User) => {
    try { await send("DELETE", `/api/users/${u.id}`); message.success("삭제했습니다"); load(); }
    catch (e) { message.error(errMsg(e)); }
  };

  return (
    <Card title="사용자 관리" size="small"
      extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>사용자 등록</Button>}>
      <Table<User> rowKey="id" size="small" dataSource={rows} loading={!rows} pagination={false} scroll={{ x: 760 }}
        columns={[
          { title: "아이디", dataIndex: "username" },
          { title: "이름", dataIndex: "name" },
          { title: "부서", dataIndex: "department", render: (v) => v ?? "-" },
          {
            title: "권한", dataIndex: "role", width: 150,
            render: (v, u) => (
              <Select size="small" value={v} style={{ width: 130 }} disabled={u.id === me.id}
                options={[{ value: "ADMIN", label: "관리자" }, { value: "USER", label: "일반 사용자" }]}
                onChange={(role) => patch(u, { role }, "권한을 바꿨습니다")} />
            ),
          },
          {
            title: "사용", dataIndex: "active", width: 70,
            render: (v, u) => <Switch size="small" checked={v} disabled={u.id === me.id}
              onChange={(active) => patch(u, { active }, active ? "사용으로 바꿨습니다" : "사용 중지했습니다")} />,
          },
          { title: "최근 로그인", dataIndex: "last_login_at", render: when, width: 140 },
          {
            title: "", key: "act", width: 170,
            render: (_, u) => (
              <Space size={4}>
                <Button size="small" onClick={() => { pwForm.resetFields(); setPwFor(u); }}>비밀번호 초기화</Button>
                {u.id !== me.id && (
                  <Popconfirm title={`${u.name} 사용자를 삭제할까요?`} okText="삭제" cancelText="취소" onConfirm={() => remove(u)}>
                    <Button size="small" danger>삭제</Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]} />

      <Modal title="사용자 등록" open={adding} okText="등록" cancelText="취소" onOk={() => addForm.submit()}
        onCancel={() => setAdding(false)} destroyOnClose>
        <Form form={addForm} layout="vertical" initialValues={{ role: "USER" }} onFinish={create} preserve={false}>
          <Form.Item name="username" label="아이디" rules={[
            { required: true, message: "아이디를 입력하세요" },
            { pattern: /^[A-Za-z0-9._-]{3,50}$/, message: "영문·숫자·._- 로 3자 이상" },
          ]}><Input autoComplete="off" /></Form.Item>
          <Form.Item name="password" label="초기 비밀번호" rules={[{ required: true, min: 4, message: "4자 이상 입력하세요" }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="name" label="이름" rules={[{ required: true, message: "이름을 입력하세요" }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="department" label="부서"><Input placeholder="예: 영업팀" /></Form.Item></Col>
          </Row>
          <Form.Item name="role" label="권한">
            <Select options={[{ value: "USER", label: "일반 사용자" }, { value: "ADMIN", label: "관리자 (사용자 등록 가능)" }]} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={`비밀번호 초기화 · ${pwFor?.name ?? ""}`} open={!!pwFor} okText="변경" cancelText="취소"
        onOk={() => pwForm.submit()} onCancel={() => setPwFor(null)} destroyOnClose>
        <Form form={pwForm} layout="vertical" preserve={false}
          onFinish={async (v) => { if (pwFor) await patch(pwFor, { password: v.password }, "비밀번호를 바꿨습니다"); setPwFor(null); }}>
          <Form.Item name="password" label="새 비밀번호" rules={[{ required: true, min: 4, message: "4자 이상 입력하세요" }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
