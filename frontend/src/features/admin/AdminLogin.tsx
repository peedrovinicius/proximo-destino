import { ArrowRight, KeyRound, ShieldCheck } from 'lucide-react'
import { Brand } from '../../components/Brand'

type AdminLoginProps = {
  onSubmit: () => void
  onBack: () => void
}

export function AdminLogin({ onSubmit, onBack }: AdminLoginProps) {
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

        <form
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit()
          }}
        >
          <label>
            E-mail corporativo
            <input type="email" defaultValue="admin@proximodestino.com.br" autoComplete="username" />
          </label>

          <label>
            Senha
            <div className="secure-input">
              <KeyRound size={17} />
              <input type="password" defaultValue="proximodestino" autoComplete="current-password" />
            </div>
          </label>

          <div className="mfa-preview">
            <ShieldCheck size={18} />
            <span>Autenticação multifator obrigatória em produção</span>
          </div>

          <button className="admin-login-submit" type="submit">
            Entrar com segurança
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
