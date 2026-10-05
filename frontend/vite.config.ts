import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const configuredApi = process.env.AUTH_API_ORIGIN || env.VITE_API_URL
  const api = new URL(configuredApi?.startsWith('http') ? configuredApi : 'https://proximo-destino-api-production.up.railway.app')
  if (!['http:', 'https:'].includes(api.protocol) || api.username || api.password) throw new Error('Origem da API inválida')
  return {
  plugins: [react()],
  preview: {
    // Fixed server-configured destination. Never derive the target from a request.
    proxy: { '/api/v1/auth': { target: api.origin, changeOrigin: true } },
    allowedHosts: ['proximo-destino-web-production.up.railway.app'],
    headers: {
      'Strict-Transport-Security': 'max-age=31536000',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
      'Content-Security-Policy-Report-Only': [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' https: data: blob:",
        "font-src 'self' data:",
        "connect-src 'self' https://proximo-destino-api-production.up.railway.app",
        "frame-src 'self' https://www.google.com https://maps.google.com",
        "form-action 'self'",
      ].join('; '),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('/react/') || id.includes('/react-dom/')) {
            return 'react-vendor'
          }
          if (id.includes('/lucide-react/')) {
            return 'icons-vendor'
          }
          return 'vendor'
        },
      },
    },
  },
  }
})
