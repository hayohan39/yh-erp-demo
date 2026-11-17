import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 개발 서버도 클라우드 VM/컨테이너에서 띄운다. /api는 ERP, /api/sim은 시뮬레이터로 프록시.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      "/api/sim": "http://localhost:8100",
      "/api": "http://localhost:8000",
    },
  },
});
