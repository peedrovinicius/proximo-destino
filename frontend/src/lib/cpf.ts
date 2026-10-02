export function cpfDigits(value: string) {
  return value.replace(/\D/g, '').slice(0, 11)
}

export function formatCpf(value: string | null | undefined) {
  const digits = cpfDigits(value ?? '')
  if (!digits) return ''

  return digits
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d{1,2}).*$/, '$1.$2.$3-$4')
}

export function isValidCpf(value: string) {
  const cpf = cpfDigits(value)
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false

  const calculate = (base: string, factor: number) => {
    let total = 0
    for (const char of base) {
      total += Number(char) * factor
      factor -= 1
    }
    const remainder = (total * 10) % 11
    return remainder === 10 ? 0 : remainder
  }

  return (
    calculate(cpf.slice(0, 9), 10) === Number(cpf[9]) &&
    calculate(cpf.slice(0, 10), 11) === Number(cpf[10])
  )
}
