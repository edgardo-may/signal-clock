// Mapeo de errores técnicos de Supabase a mensajes legibles
export const SUPABASE_ERROR_MAP = [
  { match: /already.*registered|already.*exists|duplicate/i, msg: "Este correo electrónico ya está registrado en el sistema." },
  { match: /rate.?limit|too many/i, msg: "Se alcanzó el límite de operaciones. Espera unos minutos e intenta de nuevo." },
  { match: /invalid.*email/i, msg: "El formato del correo electrónico no es válido." },
  { match: /password.*short|at least/i, msg: "La contraseña debe tener al menos 6 caracteres." },
  { match: /row-level security|42501/i, msg: "No tienes permisos para realizar esta operación." },
  { match: /not authorized|403|forbidden/i, msg: "Solo los administradores pueden realizar esta acción." },
];

/**
 * Recibe un error (texto o objeto) y lo convierte a un mensaje amigable.
 * 
 * @param {string|Error} error - El error a analizar
 * @returns {string} Mensaje humanizado
 */
export function humanizeError(error) {
  const rawMessage = (error?.message || error || "").toString();
  if (!rawMessage) return "Error inesperado. Intenta de nuevo.";
  
  for (const { match, msg } of SUPABASE_ERROR_MAP) {
    if (match.test(rawMessage)) return msg;
  }
  
  return rawMessage;
}
