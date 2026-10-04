import { useState, type FormEvent } from 'react'
import { ArrowRight, KeyRound, ShieldCheck } from 'lucide-react'
import { Brand } from '../../components/Brand'
import {
  loginAdmin,
  loginCreator,
  setupMfa,
  verifyMfa,
  verifyMfaSetup,
  type MfaSetupResult,
} from '../../lib/adminAuth'

type AdminLoginProps = {
  audience?: 'company' | 'creator'
  onSubmit: (accessToken: string) => void
  onBack: () => void
}

type Stage = 'credentials' | 'mfa' | 'setup' | 'recovery'

export function AdminLogin({ onSubmit, onBack, audience = 'company' }: AdminLoginProps) {
  const [stage, setStage] = useState<Stage>('credentials')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [challengeToken, setChallengeToken] = useState('')
  const [setup, setSetup] = useState<MfaSetupResult | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [pendingAccessToken, setPendingAccessToken] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      const result = await (audience === 'creator' ? loginCreator : loginAdmin)(email, password)

      if (result.status === 'authenticated') {
        onSubmit(result.accessToken)
        return
      }

      setChallengeToken(result.challengeToken)
      setPassword('')

      if (result.status === 'mfa_setup_required') {
        const setupResult = await setupMfa(result.challengeToken)
        setSetup(setupResult)
        setStage('setup')
      } else {
        setStage('mfa')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao autenticar.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      if (stage === 'setup') {
        const result = await verifyMfaSetup(challengeToken, code)
        setRecoveryCodes(result.recoveryCodes ?? [])
        setPendingAccessToken(result.accessToken)
        setCode('')
        setStage('recovery')
        return
      }

      const result = await verifyMfa(challengeToken, code)
      onSubmit(result.accessToken)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Código inválido.')
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
          <span className="eyebrow">{audience === 'creator' ? 'Gestão da plataforma' : 'Acesso administrativo'}</span>
          <h1>
            {stage === 'credentials' && (audience === 'creator' ? 'Área exclusiva do Criador' : 'Área restrita da agência')}
            {stage === 'mfa' && 'Confirme sua identidade'}
            {stage === 'setup' && 'Ative a autenticação em duas etapas'}
            {stage === 'recovery' && 'Guarde seus códigos de recuperação'}
          </h1>
          <p>
            {stage === 'credentials' && (audience === 'creator' ? 'Cadastre as empresas que usarão o sistema. Este acesso não inclui os dados operacionais das empresas.' : 'Clientes, reservas, pagamentos e dados operacionais ficam disponíveis somente para perfis autorizados.')}
            {stage === 'mfa' && 'Digite o código do aplicativo autenticador ou um código de recuperação ainda não utilizado.'}
            {stage === 'setup' && 'Escaneie o QR Code no seu aplicativo autenticador e confirme o código de 6 dígitos.'}
            {stage === 'recovery' && 'Estes códigos aparecem apenas agora. Guarde-os em um local seguro e separado da sua senha.'}
          </p>
        </div>

        {stage === 'credentials' ? (
          <form onSubmit={handleCredentials}>
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
              <span>MFA obrigatório para administradores</span>
            </div>

            {error ? <p className="admin-login-error" role="alert">{error}</p> : null}

            <button className="admin-login-submit" type="submit" disabled={submitting}>
              {submitting ? 'Validando acesso…' : 'Continuar'}
              <ArrowRight size={17} />
            </button>

            <button className="admin-login-back" type="button" onClick={onBack}>
              Voltar ao portal do cliente
            </button>
          </form>
        ) : null}

        {stage === 'setup' && setup ? (
          <>
            <div className="mfa-setup-box">
              <img src={setup.qrDataUrl} alt="QR Code para configurar o autenticador" />
              <div>
                <strong>Chave manual</strong>
                <code>{setup.manualKey}</code>
              </div>
            </div>
            <form onSubmit={handleMfa}>
              <label>
                Código de 6 dígitos
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  minLength={6}
                  maxLength={6}
                  required
                />
              </label>
              {error ? <p className="admin-login-error" role="alert">{error}</p> : null}
              <button className="admin-login-submit" type="submit" disabled={submitting}>
                {submitting ? 'Confirmando…' : 'Ativar MFA'}
                <ShieldCheck size={17} />
              </button>
            </form>
          </>
        ) : null}

        {stage === 'mfa' ? (
          <form onSubmit={handleMfa}>
            <label>
              Código do autenticador ou recuperação
              <input
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                minLength={6}
                maxLength={32}
                required
              />
            </label>
            {error ? <p className="admin-login-error" role="alert">{error}</p> : null}
            <button className="admin-login-submit" type="submit" disabled={submitting}>
              {submitting ? 'Verificando…' : 'Verificar e entrar'}
              <ArrowRight size={17} />
            </button>
            <button className="admin-login-back" type="button" onClick={() => {
              setStage('credentials')
              setChallengeToken('')
              setCode('')
              setError('')
            }}>
              Voltar
            </button>
          </form>
        ) : null}

        {stage === 'recovery' ? (
          <div className="recovery-codes-panel">
            <div className="recovery-codes-grid">
              {recoveryCodes.map((recoveryCode) => (
                <code key={recoveryCode}>{recoveryCode}</code>
              ))}
            </div>
            <p>Se você perder o autenticador, cada código poderá ser usado uma única vez.</p>
            <button
              className="admin-login-submit"
              type="button"
              onClick={() => onSubmit(pendingAccessToken)}
            >
              Salvei os códigos e entrar
              <ArrowRight size={17} />
            </button>
          </div>
        ) : null}
      </section>
    </main>
  )
}
