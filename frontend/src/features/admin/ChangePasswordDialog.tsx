import { useEffect, useRef, useState, type FormEvent } from 'react'
import { changeAdminPassword } from '../../lib/adminAuth'
import './change-password.css'

export function ChangePasswordDialog({ token, onClose, onChanged }: { token: string; onClose: () => void; onChanged: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [changed, setChanged] = useState(false)
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close() }, [])
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = event.currentTarget, data = new FormData(form)
    const current = String(data.get('currentPassword') || ''), next = String(data.get('newPassword') || '')
    if (next !== data.get('confirmPassword')) { setError('As novas senhas devem ser iguais.'); return }
    if (current === next) { setError('A nova senha deve ser diferente da atual.'); return }
    form.reset(); data.delete('currentPassword'); data.delete('newPassword'); data.delete('confirmPassword')
    setBusy(true); setError('')
    try { await changeAdminPassword(token, current, next); setChanged(true) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível alterar a senha.') }
    finally { setBusy(false) }
  }
  return <dialog className="password-dialog" ref={dialog} aria-labelledby="password-dialog-title"
    onCancel={event => { event.preventDefault(); if (!busy) (changed ? onChanged : onClose)() }}>
    <h2 id="password-dialog-title">Alterar minha senha</h2>
    {changed ? <><p role="status">Senha alterada. Todas as suas sessões foram encerradas. Entre novamente com a nova senha.</p>
      <button type="button" autoFocus onClick={onChanged}>Entrar novamente</button></> : <>
      <p>Informe a senha atual e escolha uma nova com pelo menos 16 caracteres. Ao confirmar, você sairá da conta em todos os dispositivos. Seu autenticador será mantido.</p>
      {error ? <p role="alert">{error}</p> : null}
      <form onSubmit={save}><fieldset disabled={busy}>
        <label>Senha atual<input name="currentPassword" type="password" required maxLength={128} autoComplete="current-password" autoFocus /></label>
        <label>Nova senha<input name="newPassword" type="password" required minLength={16} maxLength={128} autoComplete="new-password" /></label>
        <label>Confirmar nova senha<input name="confirmPassword" type="password" required minLength={16} maxLength={128} autoComplete="new-password" /></label>
        <button type="submit">{busy ? 'Alterando…' : 'Alterar senha e encerrar sessões'}</button>
        <button type="button" onClick={onClose}>Cancelar</button>
      </fieldset></form></>}
  </dialog>
}
