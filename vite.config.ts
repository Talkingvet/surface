import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' so the built app also works from file:// inside Electron
export default defineConfig({
  plugins: [react()],
  base: './',
})
