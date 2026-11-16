import { useEffect, useRef } from "react";

/** ERP SSE(/api/events) 구독. 지정한 이벤트가 오면 콜백을 부른다. */
export function useEvents(names: string[], onEvent: (name: string, data: unknown) => void) {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  const key = names.join(",");
  useEffect(() => {
    const es = new EventSource("/api/events");
    const listeners = key.split(",").map((n) => {
      const fn = (e: MessageEvent) => cb.current(n, JSON.parse(e.data));
      es.addEventListener(n, fn);
      return [n, fn] as const;
    });
    return () => {
      listeners.forEach(([n, fn]) => es.removeEventListener(n, fn));
      es.close();
    };
  }, [key]);
}
