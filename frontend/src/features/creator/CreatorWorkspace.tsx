import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AdminLogin } from '../admin/AdminLogin'
import { logoutAdmin, refreshAdminSession } from '../../lib/adminAuth'
import './creator.css'
import { CompanyAdminForm } from './CompanyAdminForm'
import { ChangePasswordDialog } from '../admin/ChangePasswordDialog'

type CompanyFields = {
  tradeName: string; slug: string; legalName: string; registrationNumber: string;
  contactEmail: string; contactPhone: string; address: string;
  responsibleName: string; responsibleEmail: string;
}
type Company = CompanyFields & { id: string; status: 'DRAFT' | 'ACTIVE' | 'SUSPENDED' }
type ActivationReadiness = {
  companyId: string; activationAllowed: boolean; blockers: string[]
  administrators: { total: number; preparedWithMfa: number; activeWithMfa: number }
}
const activationBlockers: Record<string, string> = {
  TENANT_ISOLATION_INCOMPLETE: 'Isolamento e operações entre empresas ainda não homologados.',
  SECURE_ADMIN_ONBOARDING_REQUIRED: 'Um administrador precisa concluir a preparação segura e o MFA.',
  PRODUCTION_BACKFILL_AND_ACCEPTANCE_REQUIRED: 'Migração da operação atual, recuperação e homologação final pendentes.',
}
const emptyFields: CompanyFields = {
  tradeName: '', slug: '', legalName: '', registrationNumber: '', contactEmail: '',
  contactPhone: '', address: '', responsibleName: '', responsibleEmail: '',
}
const labels: Record<keyof CompanyFields, string> = {
  tradeName: 'Nome da empresa', slug: 'Identificador da empresa', legalName: 'Razão social',
  registrationNumber: 'CNPJ / registro', contactEmail: 'E-mail de contato', contactPhone: 'Telefone',
  address: 'Endereço', responsibleName: 'Nome do responsável', responsibleEmail: 'E-mail do responsável',
}
const limits: Record<keyof CompanyFields, number> = {
  tradeName: 160, slug: 64, legalName: 200, registrationNumber: 32,
  contactEmail: 254, contactPhone: 32, address: 500, responsibleName: 160, responsibleEmail: 254,
}
const requiredFields = new Set<keyof CompanyFields>(['tradeName', 'slug', 'contactEmail', 'responsibleName', 'responsibleEmail'])
const statuses = { DRAFT: 'Rascunho', ACTIVE: 'Ativa', SUSPENDED: 'Suspensa' }
const API_BASE = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '')

async function companyRequest(token: string, path = '', body?: CompanyFields): Promise<Company | Company[]> {
  const response = await fetch(`${API_BASE}/platform/companies${path}`, {
    method: body ? (path ? 'PUT' : 'POST') : 'GET',
    cache: 'no-store', credentials: 'omit',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const result = await response.json().catch(() => null) as { message?: string | string[] } | null
  if (!response.ok) {
    throw new Error(Array.isArray(result?.message) ? result.message.join(' ') : result?.message || 'Não foi possível acessar o cadastro de empresas.')
  }
  return result as unknown as Company | Company[]
}

export function CreatorWorkspace({ onBack }: { onBack: () => void }) {
  const [token, setToken] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(true)
  const [companies, setCompanies] = useState<Company[]>([])
  const [fields, setFields] = useState<CompanyFields>({ ...emptyFields })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [adminCompany, setAdminCompany] = useState<Company | null>(null)
  const [guided, setGuided] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const [readiness, setReadiness] = useState<ActivationReadiness | null>(null)
  const [checkingReadinessId, setCheckingReadinessId] = useState<string | null>(null)
  const [readinessError, setReadinessError] = useState<{ companyId: string; message: string } | null>(null)
  const readinessController = useRef<AbortController | null>(null)
  useEffect(() => () => { readinessController.current?.abort() }, [token])

  useEffect(() => {
    let active = true
    void refreshAdminSession().then(result => {
      if (active && result.user.role === 'CREATOR') setToken(result.accessToken)
    }).catch(() => {}).finally(() => { if (active) setRestoring(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!token) return
    let active = true
    setLoading(true)
    setError('')
    void companyRequest(token).then(result => { if (active) setCompanies(result as Company[]) })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Falha ao carregar empresas.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token])

  useEffect(() => {
    if (!token) return
    let active = true
    const interval = window.setInterval(() => {
      void refreshAdminSession().then(result => {
        if (!active) return
        if (result.user.role !== 'CREATOR') { setToken(null); return }
        setToken(result.accessToken)
      }).catch(() => { /* API continues enforcing expiry; no local privilege fallback. */ })
    }, 7 * 60 * 1000)
    return () => { active = false; window.clearInterval(interval) }
  }, [token])

  async function inspectReadiness(companyId: string) {
    if (!token || checkingReadinessId) return
    readinessController.current?.abort()
    const controller = new AbortController()
    readinessController.current = controller
    setCheckingReadinessId(companyId); setReadiness(null); setReadinessError(null)
    try {
      const response = await fetch(`${API_BASE}/platform/companies/${encodeURIComponent(companyId)}/readiness`, {
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', credentials: 'omit', signal: controller.signal,
      })
      if (!response.ok) throw new Error('Não foi possível consultar as pendências. Tente novamente.')
      const result = await response.json() as ActivationReadiness
      if (result.companyId !== companyId || typeof result.activationAllowed !== 'boolean' ||
        !Array.isArray(result.blockers) || !result.administrators ||
        !Number.isInteger(result.administrators.total) || !Number.isInteger(result.administrators.preparedWithMfa)) {
        throw new Error('O diagnóstico retornou dados inválidos.')
      }
      if (!controller.signal.aborted) setReadiness(result)
    } catch (cause) {
      if (!controller.signal.aborted) setReadinessError({ companyId,
        message: cause instanceof Error ? cause.message : 'Diagnóstico indisponível.' })
    } finally {
      if (!controller.signal.aborted) setCheckingReadinessId(null)
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token || saving) return
    setSaving(true); setError(''); setNotice('')
    try {
      const company = await companyRequest(token, editingId ? `/${encodeURIComponent(editingId)}` : '', fields) as Company
      setCompanies(current => [company, ...current.filter(item => item.id !== company.id)].slice(0, 100))
      setReadiness(null); setReadinessError(null)
      if (!editingId) { setAdminCompany(company); setGuided(true) }
      setEditingId(null); setFields({ ...emptyFields })
      setNotice('Empresa salva em rascunho. Nenhum acesso operacional foi ativado.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao salvar empresa.') }
    finally { setSaving(false) }
  }

  if (restoring) return <main className="admin-session-restore" aria-live="polite">Verificando acesso do Criador…</main>
  if (!token) return <AdminLogin audience="creator" onSubmit={setToken} onBack={onBack} />

  return <main className="creator-workspace">
    <header className="creator-heading">
      <div><span className="eyebrow">Próximo Destino · Criador</span><h1>Empresas da plataforma</h1><p>Cadastre quem vai usar o sistema, com dados e responsável próprios.</p></div>
      <div className="creator-actions"><button type="button" disabled={saving} onClick={onBack}>Voltar ao site</button>
        <button type="button" disabled={saving} onClick={() => setChangingPassword(true)}>Alterar minha senha</button>
        <button type="button" disabled={saving} onClick={() => { void logoutAdmin(token); setToken(null); setCompanies([]); setFields({ ...emptyFields }); setEditingId(null); setAdminCompany(null); setError(''); setNotice('') }}>Sair</button></div>
    </header>
    {changingPassword ? <ChangePasswordDialog token={token} onClose={() => setChangingPassword(false)}
      onChanged={() => { setChangingPassword(false); setToken(null); setCompanies([]); setFields({ ...emptyFields }); setAdminCompany(null); setEditingId(null); setGuided(false); setError(''); setNotice('') }} /> : null}
    <aside className="creator-warning"><strong>Acesso pendente de ativação</strong><p>Você pode cadastrar a empresa e preparar o acesso do administrador. O convite permite definir a senha e configurar o autenticador; o uso da empresa ainda depende da ativação.</p></aside>
    {error ? <p role="alert" className="admin-login-error">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {adminCompany ? <CompanyAdminForm key={adminCompany.id} companyId={adminCompany.id} companyName={adminCompany.tradeName}
      token={token} guided={guided} defaultName={adminCompany.responsibleName} defaultEmail={adminCompany.responsibleEmail}
      onBusyChange={setSaving} onClose={() => { setAdminCompany(null); setGuided(false) }} /> : null}
    <div className="creator-columns">
      {!adminCompany ? <section className="creator-panel" aria-labelledby="company-form-title"><h2 id="company-form-title">{editingId ? 'Editar rascunho' : 'Cadastrar empresa'}</h2>
        {!editingId ? <p className="creator-help">Etapa 1 de 3 · Empresa. Depois, cadastre o administrador e prepare o convite.</p> : null}
        <form onSubmit={save}><fieldset disabled={saving} className="creator-fields">
          {(Object.keys(labels) as (keyof CompanyFields)[]).map(key => <label key={key}>{labels[key]}{requiredFields.has(key) ? ' *' : ''}
            <input type={key === 'contactEmail' || key === 'responsibleEmail' ? 'email' : 'text'}
              value={fields[key]} required={requiredFields.has(key)} maxLength={limits[key]}
              minLength={key === 'slug' ? 3 : key === 'tradeName' || key === 'responsibleName' ? 2 : undefined}
              pattern={key === 'slug' ? '[a-z0-9]+(-[a-z0-9]+)*' : undefined}
              title={key === 'slug' ? 'Use letras minúsculas, números e hífens; exemplo: agencia-sol' : undefined}
              onChange={event => setFields(current => ({ ...current, [key]: event.target.value }))} />
          </label>)}
          <p className="creator-help">* Obrigatório. Salvar a empresa não cria uma conta nem envia mensagens. Você poderá continuar o cadastro do administrador na próxima etapa.</p>
          <button type="submit">{saving ? 'Salvando…' : editingId ? 'Salvar rascunho' : 'Salvar empresa e continuar'}</button>
          {editingId ? <button type="button" onClick={() => { setEditingId(null); setFields({ ...emptyFields }) }}>Cancelar edição</button> : null}
        </fieldset></form>
      </section> : null}
      <section className="creator-panel" aria-labelledby="companies-list-title"><h2 id="companies-list-title">Cadastros recentes</h2>
        {loading ? <p role="status">Carregando empresas…</p> : companies.length === 0 ? <p>Nenhuma empresa cadastrada.</p> : <ul className="creator-company-list">
          {companies.map(company => <li key={company.id}><h3>{company.tradeName}</h3><span>{statuses[company.status]}</span>
            <p>{company.slug} · {company.contactEmail}</p><p>Responsável: {company.responsibleName}</p>
            {company.status === 'DRAFT' ? <button type="button" disabled={saving} onClick={() => {
              setAdminCompany(null); setGuided(false)
              setEditingId(company.id); setNotice(''); setFields(Object.fromEntries(Object.keys(labels).map(key => [key, company[key as keyof CompanyFields] ?? ''])) as CompanyFields)
            }}>Editar rascunho de {company.tradeName}</button> : null}
            {company.status === 'DRAFT' ? <button type="button" disabled={saving} onClick={() => { setAdminCompany(company); setGuided(false) }}>Administradores de {company.tradeName}</button> : null}
            <button type="button" disabled={saving || checkingReadinessId !== null}
              onClick={() => void inspectReadiness(company.id)}>Ver pendências de ativação de {company.tradeName}</button>
            {checkingReadinessId === company.id ? <p role="status">Consultando pendências da empresa…</p> : null}
            {readinessError?.companyId === company.id ? <p role="alert">{readinessError.message}</p> : null}
            {readiness?.companyId === company.id ? <section className="creator-readiness"
              aria-label={`Prontidão de ${company.tradeName}`}>
              <strong>{readiness.activationAllowed ? 'Sem bloqueios indicados pelo diagnóstico' : 'Ativação indisponível'}</strong>
              <p>Administradores cadastrados: {readiness.administrators.total}. Com MFA preparado: {readiness.administrators.preparedWithMfa}.</p>
              {readiness.blockers.length ? <ul>{readiness.blockers.map(code =>
                <li key={code}>{activationBlockers[code] ?? 'Há uma pendência adicional que exige revisão.'}</li>)}</ul>
                : <p>O diagnóstico não relatou pendências, mas a ativação ainda exige homologação e aprovação controlada.</p>}
              <p>Consulta informativa. Nenhuma empresa ou conta é ativada por esta ação.</p>
            </section> : null}
          </li>)}
        </ul>}
      </section>
    </div>
  </main>
}
