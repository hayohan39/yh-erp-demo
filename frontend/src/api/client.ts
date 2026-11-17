/** 서버 오류 응답에서 사람이 읽을 메시지만 꺼낸다. FastAPI는 {"detail": "..."} 또는 검증 오류 배열을 준다. */
function errorText(status: number, body: string): string {
  try {
    const j = JSON.parse(body);
    const d = j?.detail ?? j?.message;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) return d.map((x) => x?.msg ?? String(x)).join(", ");
  } catch { /* JSON이 아니면 아래로 */ }
  if (status >= 500) return "서버 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.";
  return body || `요청이 실패했습니다 (${status})`;
}

export class ApiError extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
    this.name = "ApiError";
  }
  toString() { return this.message; }
}

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, "서버에 연결할 수 없습니다. 네트워크 상태를 확인하세요.");
  }
  if (!res.ok) throw new ApiError(res.status, errorText(res.status, await res.text()));
  return res.json() as Promise<T>;
}

export const post = <T = unknown>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

/** message.error 등에 넘길 오류 문구. */
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
