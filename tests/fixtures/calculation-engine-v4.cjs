'use strict'
// TEST ONLY. Independently defined fixture semantics: round a closed interval
// upward to whole minutes. Never imported by the production engine registry.
const engineV4 = Object.freeze({
  calculationVersion: 4,
  calculate(_domain, match) {
    const entry = match.matchedPunches.find(p => p.direction === 'ENTRY')
    const exit = entry && match.matchedPunches.find(p => p.direction === 'EXIT' && p.epochMs > entry.epochMs)
    const workedMinutes = exit ? Math.ceil((exit.epochMs-entry.epochMs)/60000) : 0
    return {
      actualStart: entry?.utcTimestamp,
      actualEnd: exit?.utcTimestamp,
      workedMinutes, effectiveMinutes: workedMinutes, ordinaryMinutes: workedMinutes,
      breakMinutes: 0, overtimeMinutes: 0, lateMinutes: 0, earlyLeaveMinutes: 0,
      missingEntry: !entry, missingExit: !!entry && !exit,
      sourceLogIds: match.matchedPunches.map(p => p.id),
      segments: entry && exit ? [{segmentType:'WORK',startPunch:entry,endPunch:exit,durationMinutes:workedMinutes,isNocturnalMinutes:0}] : [],
      devicesInvolved: [], supplementalEvents: [], pairingIncidents: [],
    }
  },
})
module.exports = { engineV4 }
