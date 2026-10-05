import { useState, type FormEvent } from 'react'
import './creator.css'

const API_BASE = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '')

export function AcceptCompanyInvite({ onBack }: { onBack: () => void }) {
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    const form = event.currentTarget
    const data = new FormData(form)
    if (data.get('password') !== data.get('confirmation')) { setError('As senhas devem ser iguais.'); return }
    const body = JSON.stringify({ token: data.get('token'), password: data.get('password') })
    form.reset(); data.delete('password'); data.delete('confirmation'); data.delete('token')
    setSaving(true); setError('')
    try {
      const response = await fetch(`${API_BASE}/company-invitations/accept`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body, cache: 'no-store',
      })
      if (!response.ok) throw new Error('Não foi possível definir a senha. Confira o código, a validade e a disponibilidade do convite.')
      setDone(true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível definir a senha.') }
    finally { setSaving(false) }
  }

  return <main className="creator-workspace">
    <section className="creator-panel" aria-labelledby="invite-title">
      <h1 id="invite-title">Preparar acesso da empresa</h1>
      <p>Use o código recebido do Criador para definir sua senha. O código vale por 24 horas e pode ser usado uma vez.</p>
      {error ? <p role="alert">{error}</p> : null}
      {done ? <p role="status">Senha definida. Seu acesso continua inativo; aguarde a configuração de MFA e a ativação segura da empresa.</p> :
        <form onSubmit={accept}><fieldset className="creator-fields" disabled={saving}>
          <label>Código do convite<input name="token" required minLength={43} maxLength={43} pattern="[A-Za-z0-9_-]{43}" autoComplete="off" spellCheck={false} /></label>
          <label>Nova senha<input name="password" type="password" required minLength={16} maxLength={128} autoComplete="new-password" /></label>
          <label>Confirmar nova senha<input name="confirmation" type="password" required minLength={16} maxLength={128} autoComplete="new-password" /></label>
          <button type="submit">{saving ? 'Definindo senha…' : 'Definir minha senha'}</button>
        </fieldset></form>}
      <button type="button" disabled={saving} onClick={onBack}>Voltar ao site</button>
    </section>
  </main>
}
