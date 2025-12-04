import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  base: '/ciphernexus/',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})