/**
 * Formatea un timestamp o cadena de fecha ISO a formato local completo:
 * "12 ago 2024, 08:30"
 */
export function formatTime(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Formatea un timestamp o cadena de fecha ISO solo a hora:
 * "08:30"
 */
export function formatTimeOnly(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
  })
}
