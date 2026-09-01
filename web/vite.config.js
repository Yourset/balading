import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  define: {
    // 每次构建生成新时间戳，用于 SW 注册 URL（绕过浏览器对旧 sw.js 的永久缓存，强制更新）
    __BUILD_TS__: JSON.stringify(Date.now())
  },
  build: {
    // dist 同时保存 APK 下载包与测试图片，构建时不得清空这些非 Vite 产物。
    emptyOutDir: false
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      // 开发期：/api 全部转发到本地认证网关（网关再校验设备凭据并反代到 DSH 3080）
      '/api': { target: 'http://127.0.0.1:8788', changeOrigin: false }
    }
  }
})