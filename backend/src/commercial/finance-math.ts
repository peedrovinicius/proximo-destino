export type InstallmentDraft = {
  sequence: number
  dueDate: Date
  amountCents: number
}

function addMonthsClampedUtc(base: Date, months: number) {
  const year = base.getUTCFullYear()
  const month = base.getUTCMonth() + months
  const day = base.getUTCDate()
  const hour = base.getUTCHours()
  const minute = base.getUTCMinutes()
  const second = base.getUTCSeconds()
  const millisecond = base.getUTCMilliseconds()

  const firstOfTarget = new Date(
    Date.UTC(year, month, 1, hour, minute, second, millisecond),
  )
  const lastDay = new Date(
    Date.UTC(
      firstOfTarget.getUTCFullYear(),
      firstOfTarget.getUTCMonth() + 1,
      0,
    ),
  ).getUTCDate()

  firstOfTarget.setUTCDate(Math.min(day, lastDay))
  return firstOfTarget
}

export function buildInstallmentSchedule(
  totalCents: number,
  downPaymentCents: number,
  installmentCount: number,
  firstDueDate: Date,
  downPaymentDueDate = new Date(),
): InstallmentDraft[] {
  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    throw new RangeError('totalCents deve ser inteiro positivo')
  }
  if (
    !Number.isInteger(downPaymentCents) ||
    downPaymentCents < 0 ||
    downPaymentCents >= totalCents
  ) {
    throw new RangeError('downPaymentCents inválido')
  }
  if (
    !Number.isInteger(installmentCount) ||
    installmentCount < 1 ||
    installmentCount > 36
  ) {
    throw new RangeError('installmentCount deve estar entre 1 e 36')
  }
  if (Number.isNaN(firstDueDate.getTime())) {
    throw new RangeError('firstDueDate inválida')
  }

  const remaining = totalCents - downPaymentCents
  const baseAmount = Math.floor(remaining / installmentCount)
  let remainder = remaining % installmentCount
  const installments: InstallmentDraft[] = []

  if (downPaymentCents > 0) {
    installments.push({
      sequence: 0,
      dueDate: new Date(downPaymentDueDate),
      amountCents: downPaymentCents,
    })
  }

  for (let index = 0; index < installmentCount; index += 1) {
    const extraCent = remainder > 0 ? 1 : 0
    if (remainder > 0) remainder -= 1

    installments.push({
      sequence: index + 1,
      dueDate: addMonthsClampedUtc(firstDueDate, index),
      amountCents: baseAmount + extraCent,
    })
  }

  return installments
}
