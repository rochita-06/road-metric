import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')

  if (mode === 'production' && !env.VITE_API_BASE_URL?.trim()) {
    throw new Error(
      'VITE_API_BASE_URL is missing from the production build environment. Set it for this Vercel deployment environment and redeploy.',
    )
  }

  return {
    plugins: [react()],
  }
})
