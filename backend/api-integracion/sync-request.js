"use strict";

// Consolide filters by movement date, not by current employee membership.
// Include historical movements when the caller does not choose a date range.
function normalizeRequest(body, now = new Date()) {
  const { fechaInicio, fechaFin, trabId, targetClienteId } = body || {};
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Cancun",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return {
    fechaInicio: fechaInicio || "2020-01-01",
    fechaFin: fechaFin || today,
    trabId,
    targetClienteId,
  };
}

module.exports = { normalizeRequest };
