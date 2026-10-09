/** Calendar dates shown by Horarios follow the tenant's operative Cancun day. */
export function cancunToday(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Cancun',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now).map(({ type, value }) => [type, value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function cancunTomorrow(now = new Date()) {
  const [year, month, day] = cancunToday(now).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
}

export function nextScheduleEffectiveDate(latestEffectiveFrom, now = new Date()) {
  const tomorrow = cancunTomorrow(now)
  if (!latestEffectiveFrom || latestEffectiveFrom < tomorrow) return tomorrow
  const [year, month, day] = latestEffectiveFrom.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
}

/** Revision end dates are exclusive; this is presentation only. */
export function scheduleRevisionPeriodLabel(effectiveFrom, nextEffectiveFrom, today = cancunToday()) {
  if (nextEffectiveFrom) return `${effectiveFrom} → antes de ${nextEffectiveFrom}`
  return `${effectiveFrom} → sin fecha de fin (${effectiveFrom > today ? 'futura' : 'vigente'})`
}
