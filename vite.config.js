import { defineConfig } from 'vite';

const deployTarget = process.env.DSH_DEPLOY;
const base = deployTarget === 'pages' ? '/dsh_go/' : deployTarget === 'package' ? './' : '/';

export default defineConfig({
  base,
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
