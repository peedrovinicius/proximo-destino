import { ArrowRight, LockKeyhole, ShieldCheck } from 'lucide-react'
import { Brand } from '../../components/Brand'

type ClientLoginProps = {
  onSubmit: () => void
  onAdminAccess: () => void
}

export function ClientLogin({ onSubmit, onAdminAccess }: ClientLoginProps) {
  return (
    <main className="client-login-shell">
      <section className="client-login-visual">
        <Brand compact />
        <div>
          <span className="eyebrow">Sua viagem, organizada</span>
          <h1>Tudo que você precisa até o próximo destino.</h1>
          <p>Roteiro, documentos, parcelas, horários e suporte da agência em um único lugar.</p>
        </div>
        <span className="client-login-trust"><ShieldCheck size={16} /> Seus dados protegidos por sessão segura</span>
      </section>

      <section className="client-login-panel">
        <form
          className="client-login-card"
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit()
          }}
        >
          <span className="eyebrow">Portal do viajante</span>
          <h2>Acesse sua viagem</h2>
          <p>Entre com os dados cadastrados pela agência.</p>

          <label>
            E-mail
            <input type="email" defaultValue="marina@exemplo.com" autoComplete="username" />
          </label>

          <label>
            Senha
            <div className="secure-input">
              <LockKeyhole size={17} />
              <input type="password" defaultValue="viagem2026" autoComplete="current-password" />
            </div>
          </label>

          <button className="client-login-submit" type="submit">
            Ver minha viagem
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
