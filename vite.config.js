import { defineConfig } from 'vite';

// base 设为仓库名:GitHub Pages 项目页部署在 /dsh_go/ 路径下。
// 本地开发不受影响(vite dev 仍从 / 提供资源)。
export default defineConfig({
  base: process.env.DSH_DEPLOY === 'pages' ? '/dsh_go/' : '/',
  build: {
    // Three.js 是稳定的大依赖,单独缓存;业务代码保持为轻量入口包。
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/three/')) return 'three';
        },
      },
    },
  },
});
