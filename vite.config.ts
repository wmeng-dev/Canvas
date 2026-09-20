import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import * as path from 'path'

// 渲染进程（React）由 Vite 构建；主进程（Electron）由 tsc 编译到 dist-electron。
export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
  },
})
