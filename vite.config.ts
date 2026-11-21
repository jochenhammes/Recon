import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Cross-origin isolation (SharedArrayBuffer → several CPU threads for ONNX Runtime) for `npm run dev` and
// `npm run preview`; on GitHub Pages public/coi-serviceworker.js adds these headers.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

// https://vite.dev/config/
export default defineConfig({
  base: '/Recon/',
  plugins: [react()],
  server: { headers: isolation },
  preview: { headers: isolation },
})
