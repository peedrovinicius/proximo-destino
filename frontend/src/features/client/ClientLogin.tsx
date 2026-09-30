import { ArrowRight, LockKeyhole, ShieldCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Brand } from '../../components/Brand'
import { loginClientPortal } from '../../lib/clientPortal'

type ClientLoginProps = {
  onSubmit: (accessToken: string) => void
  onAdminAccess: () => void
}

export function ClientLogin({ onSubmit, onAdminAccess }: ClientLoginProps) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      const result = await loginClientPortal(email, code)
      onSubmit(result.accessToken)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível acessar sua viagem.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="client-login-shell">
      <section className="client-login-visual">
        <Brand compact />
        <div>
          <span className="eyebrow">Sua viagem, organizada</span>
          <h1>Tudo que você precisa até o próximo destino.</h1>
          <p>Consulte sua reserva e os dados da viagem com o código recebido no momento da solicitação.</p>
        </div>
        <span className="client-login-trust"><ShieldCheck size={16} /> Código individual e sessão temporária protegida</span>
      </section>

      <section className="client-login-panel">
        <form className="client-login-card" onSubmit={handleSubmit}>
          <span className="eyebrow">Portal do viajante</span>
          <h2>Acesse sua viagem</h2>
          <p>Use o e-mail informado na reserva e o código de acesso recebido.</p>

          <label>
            E-mail
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>

          <label>
            Código da reserva
            <div className="secure-input">
              <LockKeyhole size={17} />
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                autoComplete="one-time-code"
                placeholder="ABCDE-FGHIJ"
                minLength={8}
                maxLength={20}
                required
              />
            </div>
          </label>

          {error ? <p className="admin-login-error" role="alert">{error}</p> : null}

          <button className="client-login-submit" type="submit" disabled={submitting}>
            {submitting ? 'Validando acesso...' : 'Ver minha viagem'}
            <ArrowRight size={17} />
          </button>

          <button className="client-login-admin" type="button" onClick={onAdminAccess}>
            Acesso administrativo
          </button>
        </form>
      </section>
    </main>
  )
}
