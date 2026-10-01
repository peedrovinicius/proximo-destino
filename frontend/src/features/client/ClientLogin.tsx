import { ArrowLeft, ArrowRight, LockKeyhole, Mail, ShieldCheck } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Brand } from '../../components/Brand'
import { loginClientPortal } from '../../lib/clientPortal'

type ClientLoginProps = {
  onSubmit: (accessToken: string) => void
  onBack: () => void
  onAdminAccess: () => void
}

export function ClientLogin({ onSubmit, onBack, onAdminAccess }: ClientLoginProps) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    document.title = 'Acessar viagem | Próximo Destino'
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      const result = await loginClientPortal(email.trim(), code.trim())
      onSubmit(result.accessToken)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível acessar sua viagem.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="client-login-shell">
      <section className="client-login-visual" aria-label="Próximo Destino Turismo e Viagens">
        <div className="client-login-brand-row">
          <Brand compact />
          <button className="client-login-home" type="button" onClick={onBack}>
            <ArrowLeft size={15} />
            Voltar ao início
          </button>
        </div>

        <div className="client-login-copy">
          <span className="client-login-kicker">Portal do viajante</span>
          <h1>Sua viagem, em um só lugar.</h1>
          <p>
            Consulte reserva, dados da viagem e informações do seu atendimento com o
            código recebido no momento da solicitação.
          </p>

          <div className="client-login-benefits" aria-label="Recursos do portal">
            <span>Reserva organizada</span>
            <span>Acesso individual</span>
            <span>Informações centralizadas</span>
          </div>
        </div>

        <span className="client-login-trust">
          <ShieldCheck size={16} />
          Código individual e sessão temporária protegida
        </span>
      </section>

      <section className="client-login-panel">
        <form
          className="client-login-card"
          onSubmit={handleSubmit}
          aria-busy={submitting}
        >
          <div className="client-login-card-heading">
            <span className="client-login-kicker">Acesso seguro</span>
            <h2>Acesse sua viagem</h2>
            <p id="client-login-help">
              Use o mesmo e-mail informado na reserva e o código de acesso recebido.
            </p>
          </div>

          <label>
            E-mail
            <div className="client-login-input">
              <Mail size={17} aria-hidden="true" />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="seu@email.com"
                aria-describedby="client-login-help"
                required
              />
            </div>
          </label>

          <label>
            Código da reserva
            <div className="client-login-input">
              <LockKeyhole size={17} aria-hidden="true" />
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                autoComplete="one-time-code"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="ABCDE-FGHIJ"
                minLength={8}
                maxLength={20}
                aria-describedby="client-login-help"
                required
              />
            </div>
          </label>

          {error ? (
            <p className="client-login-error" role="alert" aria-live="polite">
              {error}
            </p>
          ) : null}

          <button className="client-login-submit" type="submit" disabled={submitting}>
            {submitting ? (
              <>
                <span className="client-login-spinner" aria-hidden="true" />
                Validando acesso...
              </>
            ) : (
              <>
                Ver minha viagem
                <ArrowRight size={17} />
              </>
            )}
          </button>

          <div className="client-login-security">
            <ShieldCheck size={16} aria-hidden="true" />
            <span>Seus dados de acesso são usados apenas para localizar a sua reserva.</span>
          </div>

          <div className="client-login-divider" aria-hidden="true">
            <span />
            <small>Equipe Próximo Destino</small>
            <span />
          </div>

          <button className="client-login-admin" type="button" onClick={onAdminAccess}>
            Acesso administrativo
          </button>
        </form>
      </section>
    </main>
  )
}
