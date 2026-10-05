import { useEffect, useState, type FormEvent } from 'react'

type Admin = { id: string; isActive: boolean; inviteUsedAt?: string | null; user: {
  id: string; displayName: string | null; email: string; isActive: boolean; mfaEnabled?: boolean;
} }
const API_BASE = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '')

export function CompanyAdminForm({ companyId, companyName, token, onClose }: {
  companyId: string; companyName: string; token: string; onClose: () => void;
}) {
  const [admins, setAdmins] = useState<Admin[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [invite, setInvite] = useState<{ membershipId: string; token: string; expiresAt: string } | null>(null)
  const url = `${API_BASE}/platform/companies/${encodeURIComponent(companyId)}/admins`

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError('')
    void fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Não foi possível carregar os administradores.')
        const result = await response.json() as Admin[]
        if (!controller.signal.aborted) setAdmins(result)
      }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Falha ao carregar.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [url, token])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    const form = event.currentTarget
    const data = new FormData(form)
    const body = JSON.stringify({ displayName: data.get('displayName'), email: data.get('email'), password: data.get('password') })
    // Password is never React state, browser storage, URL, or notification content.
    form.reset(); data.delete('password')
    setSaving(true); setError(''); setNotice('')
    try {
      const response = await fetch(url, { method: 'POST', body,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
      const result = await response.json() as Admin & { message?: string | string[] }
      if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join(' ') : result.message || 'Falha ao cadastrar administrador.')
      setAdmins(current => [result, ...current].slice(0, 100))
      setNotice('Administrador cadastrado, com acesso inativo. Nenhum convite foi enviado.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao cadastrar administrador.') }
    finally { setSaving(false) }
  }

  async function invitation(admin: Admin, revoke = false) {
    if (saving) return
    setSaving(true); setError(''); setNotice(''); setInvite(null)
    try {
      const response = await fetch(`${url}/${encodeURIComponent(admin.id)}/invitation${revoke ? '/revoke' : ''}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
      })
      if (!response.ok) throw new Error('Não foi possível alterar o convite deste administrador pendente.')
      if (revoke) setNotice('Convite revogado. A preparação temporária de MFA também foi revogada; os códigos anteriores não podem mais ser usados.')
      else {
        const result = await response.json() as { token: string; expiresAt: string }
        setInvite({ membershipId: admin.id, token: result.token, expiresAt: result.expiresAt })
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao alterar convite.') }
    finally { setSaving(false) }
  }

  return <section className="creator-panel" aria-labelledby="company-admin-title">
    <h2 id="company-admin-title">Administradores de {companyName}</h2>
    <p className="creator-help">Cadastre uma conta nova. O login permanece bloqueado até a ativação segura da empresa. Contas existentes não serão alteradas.</p>
    {error ? <p role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {invite ? <div className="creator-fields">
      <p>Entregue este código ao administrador por um canal privado. Um novo convite invalida o anterior. Válido até {new Date(invite.expiresAt).toLocaleString('pt-BR')}.</p>
      <label>Código exibido somente nesta emissão<input readOnly value={invite.token} autoComplete="off" spellCheck={false} /></label>
      <p>O administrador deve abrir <a href="?screen=company-invite">Definir senha da empresa</a> e informar o código. Nenhum e-mail foi enviado.</p>
      <button type="button" onClick={() => setInvite(null)}>Ocultar código</button>
    </div> : null}
    <form onSubmit={save}><fieldset className="creator-fields" disabled={saving}>
      <label>Nome do administrador<input name="displayName" required minLength={2} maxLength={160} autoComplete="name" /></label>
      <label>E-mail de acesso<input name="email" type="email" required maxLength={254} autoComplete="off" /></label>
      <label>Senha inicial<input name="password" type="password" required minLength={16} maxLength={128} autoComplete="new-password" aria-describedby="admin-password-help" /></label>
      <p id="admin-password-help" className="creator-help">Use pelo menos 16 caracteres. A senha não será exibida após salvar.</p>
      <button type="submit">{saving ? 'Cadastrando…' : 'Cadastrar administrador pendente'}</button>
      <button type="button" onClick={onClose}>Fechar</button>
    </fieldset></form>
    {loading ? <p role="status">Carregando administradores…</p> : admins.length ? <ul className="creator-company-list">
      {admins.map(admin => <li key={admin.id}><strong>{admin.user.displayName || 'Administrador'}</strong><p>{admin.user.email}</p>
        <span>{admin.isActive && admin.user.isActive ? 'Ativo' : admin.user.mfaEnabled ? 'MFA configurado · acesso inativo' : admin.inviteUsedAt ? 'Senha definida · acesso inativo' : 'Acesso inativo'}</span>
        {!admin.isActive && !admin.user.isActive && !admin.user.mfaEnabled ? <div>
          <>{!admin.inviteUsedAt ? <button type="button" disabled={saving} onClick={() => void invitation(admin)}>Gerar novo convite para {admin.user.displayName || admin.user.email}</button> : null}</>
          <button type="button" disabled={saving} onClick={() => void invitation(admin, true)}>{admin.inviteUsedAt ? 'Revogar preparação de ' : 'Revogar convite de '}{admin.user.displayName || admin.user.email}</button>
        </div> : null}</li>)}
    </ul> : <p>Nenhum administrador cadastrado.</p>}
  </section>
}
