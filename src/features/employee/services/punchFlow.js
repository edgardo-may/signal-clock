import { getLocalComponents, localToUtcIso } from '../../../domain/attendance/timezoneUtils.ts';

export function getPunchDay(now, timezone) {
  const { localDate, year, month, day } = getLocalComponents(now, timezone);
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  return {
    localDate,
    weekday: ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'][new Date(Date.UTC(year, month - 1, day)).getUTCDay()],
    start: localToUtcIso(localDate, '00:00', timezone),
    end: localToUtcIso(nextDate, '00:00', timezone),
  };
}

export function getNextPunch(registros, hasBreak) {
  const latest = [...registros].sort((a, b) => Date.parse(b.verificado_at) - Date.parse(a.verificado_at))[0];
  if (!latest) return 'entrada';
  switch (latest.tipo_verificacion) {
    case 'entrada': return hasBreak ? 'descanso_inicio' : 'salida';
    case 'descanso_inicio': return 'descanso_fin';
    case 'descanso_fin': return 'salida';
    default: return null;
  }
}
