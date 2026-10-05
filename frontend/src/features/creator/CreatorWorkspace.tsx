import { useEffect, useState, type FormEvent } from 'react'
import { AdminLogin } from '../admin/AdminLogin'
import { logoutAdmin, refreshAdminSession } from '../../lib/adminAuth'
import './creator.css'
import { CompanyAdminForm } from './CompanyAdminForm'

type CompanyFields = {
  tradeName: string; slug: string; legalName: string; registrationNumber: string;
  contactEmail: string; contactPhone: string; address: string;
  responsibleName: string; responsibleEmail: string;
}
type Company = CompanyFields & { id: string; status: 'DRAFT' | 'ACTIVE' | 'SUSPENDED' }
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

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token || saving) return
    setSaving(true); setError(''); setNotice('')
    try {
      const company = await companyRequest(token, editingId ? `/${encodeURIComponent(editingId)}` : '', fields) as Company
      setCompanies(current => [company, ...current.filter(item => item.id !== company.id)].slice(0, 100))
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
      <div className="creator-actions"><button type="button" onClick={onBack}>Voltar ao site</button>
        <button type="button" disabled={saving} onClick={() => { void logoutAdmin(token); setToken(null); setCompanies([]); setFields({ ...emptyFields }); setEditingId(null); setAdminCompany(null); setError(''); setNotice('') }}>Sair</button></div>
    </header>
    <aside className="creator-warning"><strong>Preparação das empresas</strong><p>Por segurança, novos cadastros ficam em rascunho. A ativação, os convites e o acesso da empresa serão liberados após o isolamento completo de viagens, clientes, reservas, financeiro e integrações.</p></aside>
    {error ? <p role="alert" className="admin-login-error">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {adminCompany ? <CompanyAdminForm key={adminCompany.id} companyId={adminCompany.id} companyName={adminCompany.tradeName}
      token={token} onClose={() => setAdminCompany(null)} /> : null}
    <div className="creator-columns">
      <section className="creator-panel" aria-labelledby="company-form-title"><h2 id="company-form-title">{editingId ? 'Editar rascunho' : 'Cadastrar empresa'}</h2>
        <form onSubmit={save}><fieldset disabled={saving} className="creator-fields">
          {(Object.keys(labels) as (keyof CompanyFields)[]).map(key => <label key={key}>{labels[key]}{requiredFields.has(key) ? ' *' : ''}
            <input type={key === 'contactEmail' || key === 'responsibleEmail' ? 'email' : 'text'}
              value={fields[key]} required={requiredFields.has(key)} maxLength={limits[key]}
              minLength={key === 'slug' ? 3 : key === 'tradeName' || key === 'responsibleName' ? 2 : undefined}
              pattern={key === 'slug' ? '[a-z0-9]+(-[a-z0-9]+)*' : undefined}
              title={key === 'slug' ? 'Use letras minúsculas, números e hífens; exemplo: agencia-sol' : undefined}
              onChange={event => setFields(current => ({ ...current, [key]: event.target.value }))} />
          </label>)}
          <p className="creator-help">* Obrigatório. O responsável ainda não recebe convite nem conta de acesso.</p>
          <button type="submit">{saving ? 'Salvando…' : 'Salvar rascunho'}</button>
          {editingId ? <button type="button" onClick={() => { setEditingId(null); setFields({ ...emptyFields }) }}>Cancelar edição</button> : null}
        </fieldset></form>
      </section>
      <section className="creator-panel" aria-labelledby="companies-list-title"><h2 id="companies-list-title">Cadastros recentes</h2>
        {loading ? <p role="status">Carregando empresas…</p> : companies.length === 0 ? <p>Nenhuma empresa cadastrada.</p> : <ul className="creator-company-list">
          {companies.map(company => <li key={company.id}><h3>{company.tradeName}</h3><span>{statuses[company.status]}</span>
            <p>{company.slug} · {company.contactEmail}</p><p>Responsável: {company.responsibleName}</p>
            {company.status === 'DRAFT' ? <button type="button" disabled={saving} onClick={() => {
              setEditingId(company.id); setNotice(''); setFields(Object.fromEntries(Object.keys(labels).map(key => [key, company[key as keyof CompanyFields] ?? ''])) as CompanyFields)
            }}>Editar rascunho de {company.tradeName}</button> : null}
            {company.status === 'DRAFT' ? <button type="button" onClick={() => setAdminCompany(company)}>Administradores de {company.tradeName}</button> : null}
          </li>)}
        </ul>}
      </section>
    </div>
  </main>
}
