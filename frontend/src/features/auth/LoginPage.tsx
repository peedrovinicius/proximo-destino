import { ArrowRight, LockKeyhole, ShieldCheck } from 'lucide-react'
import { Brand } from '../../components/Brand'

type LoginPageProps = {
  onLogin: () => void
}

export function LoginPage({ onLogin }: LoginPageProps) {
  return (
    <main className="login-shell">
      <section className="login-visual">
        <div className="login-visual-content">
          <Brand />
          <div>
            <span className="eyebrow eyebrow--light">Gestão para turismo</span>
            <h1>Da primeira conversa ao embarque.</h1>
            <p>
              Clientes, cotações, reservas, financeiro e operação de viagens
              organizados em um único fluxo.
            </p>
          </div>
          <div className="login-visual-foot">
            <ShieldCheck size={18} />
            <span>Ambiente administrativo protegido</span>
          </div>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <div className="login-mobile-brand">
            <Brand />
          </div>
          <span className="eyebrow">Acesso administrativo</span>
          <h2>Bem-vindo de volta</h2>
          <p>Entre para acompanhar a operação da agência.</p>

          <form onSubmit={(event) => { event.preventDefault(); onLogin() }}>
            <label>
              E-mail
              <input type="email" defaultValue="admin@proximodestino.com.br" />
            </label>

            <label>
              Senha
              <div className="password-field">
                <LockKeyhole size={17} />
                <input type="password" defaultValue="proximodestino" />
              </div>
            </label>

            <div className="login-options">
              <label className="checkbox-row">
                <input type="checkbox" defaultChecked />
                <span>Manter acesso</span>
              </label>
              <button type="button">Esqueci minha senha</button>
            </div>

            <button className="login-submit" type="submit">
              Entrar no painel
              <ArrowRight size={17} />
            </button>
          </form>

          <small className="login-demo-note">Ambiente demonstrativo do projeto.</small>
        </div>
      </section>
    </main>
  )
}
