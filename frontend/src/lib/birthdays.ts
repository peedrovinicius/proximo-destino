export type ClientBirthday = {
  id: string
  name: string
  birthDate: string
  phone: string
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function getUpcomingBirthdays(
  clients: ClientBirthday[],
  now = new Date(),
  daysAhead = 30,
) {
  const today = startOfDay(now)

  return clients
    .map((client) => {
      const birth = new Date(`${client.birthDate}T12:00:00`)
      let next = new Date(today.getFullYear(), birth.getMonth(), birth.getDate())

      if (next < today) {
        next = new Date(today.getFullYear() + 1, birth.getMonth(), birth.getDate())
      }

      const diffMs = next.getTime() - today.getTime()
      const daysUntil = Math.round(diffMs / 86_400_000)

      return { ...client, nextBirthday: next, daysUntil }
    })
    .filter((client) => client.daysUntil <= daysAhead)
    .sort((a, b) => a.daysUntil - b.daysUntil)
}

export function birthdayLabel(daysUntil: number, date: Date) {
  if (daysUntil === 0) return 'Hoje'
  if (daysUntil === 1) return 'Amanhã'

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
  }).format(date)
}
