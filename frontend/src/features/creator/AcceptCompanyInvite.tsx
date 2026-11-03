import { useState, type FormEvent } from 'react'
import './creator.css'

const API_BASE = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '')
type Setup = { manualKey: string; qrDataUrl: string }

export function AcceptCompanyInvite({ onBack }: { onBack: () => void }) {
  const [saving, setSaving] = useState(false)
  const [resume, setResume] = useState(false)
  const [onboardingToken, setOnboardingToken] = useState<string | null>(null)
  const [setup, setSetup] = useState<Setup | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  async function request(path: string, body: object) {
    const response = await fetch(`${API_BASE}/company-invitations/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store',
    })
    if (!response.ok) throw new Error('Não foi possível concluir esta etapa. Confira os dados e a validade; se necessário, retome com sua senha. Após cinco erros de senha, aguarde 15 minutos.')
    return response.json()
  }

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    const form = event.currentTarget
    const data = new FormData(form)
    if (!resume && data.get('password') !== data.get('confirmation')) { setError('As senhas devem ser iguais.'); return }
    const body = resume ? { email: data.get('email'), password: data.get('password') }
      : { token: data.get('token'), password: data.get('password') }
    form.reset(); data.delete('password'); data.delete('confirmation'); data.delete('token')
    setSaving(true); setError('')
    try {
      const result = await request(resume ? 'resume' : 'accept', body) as { onboardingToken: string }
      setOnboardingToken(result.onboardingToken); setSetup(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível preparar o acesso.') }
    finally { setSaving(false) }
  }

  async function beginMfa() {
    if (!onboardingToken || saving) return
    setSaving(true); setError('')
    try {
      const result = await request('mfa/setup', { onboardingToken }) as Setup
      if (!result.qrDataUrl.startsWith('data:image/png;base64,')) throw new Error('Imagem do autenticador indisponível.')
      setSetup({ manualKey: result.manualKey, qrDataUrl: result.qrDataUrl })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao preparar autenticador.') }
    finally { setSaving(false) }
  }

  async function confirmMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!onboardingToken || saving) return
    const form = event.currentTarget
    const code = new FormData(form).get('code')
    form.reset(); setSaving(true); setError('')
    try {
      const result = await request('mfa/confirm', { onboardingToken, code }) as { recoveryCodes: string[] }
      setRecoveryCodes(result.recoveryCodes); setSetup(null); setOnboardingToken(null); setDone(true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao confirmar autenticador.') }
    finally { setSaving(false) }
  }

  return <main className="creator-workspace">
    <section className="creator-panel" aria-labelledby="invite-title">
      <h1 id="invite-title">Preparar acesso da empresa</h1>
      <p>Defina sua senha e configure um aplicativo autenticador. Essas etapas não ativam o acesso à empresa.</p>
      {error ? <p role="alert">{error}</p> : null}
      {done ? <>
        <p role="status">MFA configurado. Seu acesso continua inativo; aguarde a ativação segura da empresa.</p>
        {recoveryCodes ? <section aria-labelledby="recovery-title">
          <h2 id="recovery-title">Guarde os códigos de recuperação</h2>
          <p>Cada código é de uso único. Guarde-os em local privado antes de sair: não serão exibidos novamente.</p>
          <ul>{recoveryCodes.map(code => <li key={code}><code>{code}</code></li>)}</ul>
          <button type="button" onClick={() => setRecoveryCodes(null)}>Já guardei; ocultar códigos</button>
        </section> : null}
      </> : onboardingToken ? <>
        <p role="status">Senha definida. Seu acesso continua inativo. Conclua o MFA em até 15 minutos.</p>
        {setup ? <>
          <h2>Configure seu autenticador</h2>
          <img src={setup.qrDataUrl} alt="QR code para adicionar a conta ao aplicativo autenticador" width={240} height={240} />
          <label className="creator-help">Chave manual<input readOnly value={setup.manualKey} autoComplete="off" /></label>
          <form onSubmit={confirmMfa}><fieldset className="creator-fields" disabled={saving}>
            <label>Código do autenticador<input name="code" required pattern="[0-9]{6}" minLength={6} maxLength={6} inputMode="numeric" autoComplete="one-time-code" /></label>
            <button type="submit">{saving ? 'Confirmando…' : 'Confirmar autenticador'}</button>
          </fieldset></form>
        </> : <button type="button" disabled={saving} onClick={() => void beginMfa()}>Configurar autenticador</button>}
        <button type="button" disabled={saving} onClick={() => { setOnboardingToken(null); setSetup(null); setResume(true); setError('') }}>Retomar com minha senha</button>
      </> : <>
        <form key={resume ? 'resume' : 'invite'} onSubmit={accept}><fieldset className="creator-fields" disabled={saving}>
          {resume ? <label>E-mail de acesso<input name="email" type="email" required maxLength={254} autoComplete="username" /></label> :
            <label>Código do convite<input name="token" required minLength={43} maxLength={43} pattern="[A-Za-z0-9_-]{43}" autoComplete="off" spellCheck={false} /></label>}
          <label>{resume ? 'Senha definida' : 'Nova senha'}<input name="password" type="password" required minLength={16} maxLength={128} autoComplete={resume ? 'current-password' : 'new-password'} /></label>
          {!resume ? <label>Confirmar nova senha<input name="confirmation" type="password" required minLength={16} maxLength={128} autoComplete="new-password" /></label> : null}
          <button type="submit">{saving ? 'Preparando…' : resume ? 'Retomar preparação' : 'Definir minha senha'}</button>
        </fieldset></form>
        <button type="button" disabled={saving} onClick={() => { setResume(value => !value); setError('') }}>{resume ? 'Tenho um convite novo' : 'Já defini minha senha'}</button>
      </>}
      <button type="button" disabled={saving} onClick={onBack}>Voltar ao site</button>
    </section>
  </main>
}
