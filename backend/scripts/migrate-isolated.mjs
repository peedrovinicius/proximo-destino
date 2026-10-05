// Explicit separate process; never called by API startup or the existing deploy.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const migrationUrl = process.env.MIGRATION_DATABASE_URL
try {
  if (!migrationUrl || !['postgres:', 'postgresql:'].includes(new URL(migrationUrl).protocol)) throw new Error()
} catch {
  console.error('MIGRATION_DATABASE_URL PostgreSQL explícita é obrigatória; nenhuma migration executada.')
  process.exit(2)
}
const env = { ...process.env, DATABASE_URL: migrationUrl }
delete env.MIGRATION_DATABASE_URL
const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
  env, stdio: 'inherit',
})
if (result.error) {
  console.error('Não foi possível iniciar o processo de migrations.')
  process.exit(1)
}
process.exit(result.status ?? 1)
