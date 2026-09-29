import { ArrowRight, Compass, PlaneTakeoff, ShieldCheck, Sparkles } from 'lucide-react'
import { Brand } from '../../components/Brand'

type LoginPageProps = {
  onLogin: () => void
}

export function LoginPage({ onLogin }: LoginPageProps) {
  return (
    <main className="portal-login">
      <div className="portal-grid" />

      <header className="portal-header">
        <Brand compact />
        <div className="portal-secure">
          <ShieldCheck size={15} />
          <span>Acesso seguro</span>
        </div>
      </header>

      <section className="portal-stage">
        <div className="portal-copy">
          <span className="stage-kicker">Sistema operacional de viagens</span>
          <h1>
            Toda viagem começa
            <span> antes do embarque.</span>
          </h1>
          <p>
            Organize intenção, cotação, reserva, pagamento e experiência do
            viajante em uma única jornada operacional.
          </p>

          <div className="portal-signals">
            <div>
              <PlaneTakeoff size={17} />
              <span>Operação em tempo real</span>
            </div>
            <div>
              <Compass size={17} />
              <span>Radar de destinos</span>
            </div>
            <div>
              <Sparkles size={17} />
              <span>Inteligência assistida</span>
            </div>
          </div>
        </div>

        <div className="portal-entry">
          <div className="portal-entry-ring portal-entry-ring--one" />
          <div className="portal-entry-ring portal-entry-ring--two" />

          <form
            className="portal-card"
            onSubmit={(event) => {
              event.preventDefault()
              onLogin()
            }}
          >
            <span className="stage-kicker">Entrada operacional</span>
            <h2>Acesse o command center</h2>
            <p>Use as credenciais demonstrativas para entrar.</p>

            <label>
              <span>E-mail</span>
              <input type="email" defaultValue="admin@proximodestino.com.br" />
            </label>

            <label>
              <span>Senha</span>
              <input type="password" defaultValue="proximodestino" />
            </label>

            <div className="portal-options">
              <label className="portal-check">
                <input type="checkbox" defaultChecked />
                <span>Manter acesso</span>
              </label>
              <button type="button">Recuperar acesso</button>
            </div>

            <button className="portal-submit" type="submit">
              Entrar no sistema
              <ArrowRight size={17} />
            </button>

            <small>Ambiente demonstrativo do projeto.</small>
          </form>
        </div>
      </section>
    </main>
  )
}
