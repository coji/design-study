import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: {
      alias: {
        ...shared,
        // DevKit は npm にないので、scripts/setup-devkit.mjs が取得してビルドしたものを指す
        '@siwc/local': resolve('vendor/sign-in-with-chatgpt-devkit/packages/local/dist/index.js')
      }
    }
  },
  preload: { resolve: { alias: shared } },
  renderer: {
    resolve: { alias: { ...shared, '@renderer': resolve('src/renderer/src') } },
    plugins: [react()]
  }
})
