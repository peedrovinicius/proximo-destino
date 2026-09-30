import { useState } from 'react'
import { ArrowRight, KeyRound, ShieldCheck } from 'lucide-react'
import { Brand } from '../../components/Brand'
import { loginAdmin } from '../../lib/adminAuth'

type AdminLoginProps = {
  onSubmit: (accessToken: string) => void
  onBack: () => void
}

export function AdminLogin({ onSubmit, onBack }: AdminLoginProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      const result = await loginAdmin(email, password)
      onSubmit(result.accessToken)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao autenticar.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="admin-login-shell">
      <section className="admin-login-card">
        <div className="admin-login-brand">
          <Brand compact />
        </div>

        <div className="admin-login-copy">
          <span className="eyebrow">Acesso administrativo</span>
          <h1>Área restrita da agência</h1>
          <p>Clientes, reservas, pagamentos e dados operacionais ficam disponíveis somente para perfis autorizados.</p>
        </div>

        <form onSubmit={handleSubmit}>
          <label>
            E-mail corporativo
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              required
            />
          </label>

          <label>
            Senha
            <div className="secure-input">
              <KeyRound size={17} />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                minLength={12}
                required
              />
            </div>
          </label>

          <div className="mfa-preview">
            <ShieldCheck size={18} />
            <span>Sessão protegida e acesso restrito por perfil</span>
          </div>

          {error ? <p className="admin-login-error" role="alert">{error}</p> : null}

          <button className="admin-login-submit" type="submit" disabled={submitting}>
            {submitting ? 'Validando acesso…' : 'Entrar com segurança'}
            <ArrowRight size={17} />
          </button>

          <button className="admin-login-back" type="button" onClick={onBack}>
            Voltar ao portal do cliente
          </button>
        </form>
      </section>
    </main>
  )
}
