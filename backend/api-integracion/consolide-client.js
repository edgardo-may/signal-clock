"use strict";

const BASE_URL = (
  process.env.CONSOLIDE_API_URL || "https://qa.consolide.com.mx"
)
  .trim()
  .replace(/\/$/, "");
const AUTH_URL = `${BASE_URL}/Consolide_ApiIdentity/v2/identity/authentication`;
const EMP_URL = `${BASE_URL}/API_RelojesIncidenciasv2/api/Empleados/PostListEmpleados`;
const TIMEOUT_MS = parseInt(process.env.CONSOLIDE_TIMEOUT_MS || "30000", 10);

class ConsolideApiError extends Error {
  constructor(statusCode, message, retryable = false) {
    super(message);
    this.name = "ConsolideApiError";
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

async function fetchWithTimeout(url, options, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new ConsolideApiError(
        408,
        "La solicitud al servidor externo agotó el tiempo de espera (timeout)",
      );
    }
    throw new ConsolideApiError(
      503,
      "No se pudo conectar con el servidor externo",
    );
  } finally {
    clearTimeout(timer);
  }
}

async function getAccessToken() {
  // Each employee query authenticates independently; no token is shared
  // between requests, companies or warm Vercel invocations.
  const username = process.env.CONSOLIDE_USERNAME;
  const password = process.env.CONSOLIDE_PASSWORD;
  if (!username || !password) {
    throw new ConsolideApiError(
      500,
      "Configuración de API externa incompleta en el servidor",
    );
  }

  const response = await fetchWithTimeout(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userName: username, password }),
  });
  const rawText = await response.text();

  if (response.status === 401 || response.status === 403) {
    throw new ConsolideApiError(
      response.status,
      "Credenciales de API externa inválidas",
    );
  }
  if (!response.ok) {
    throw new ConsolideApiError(
      response.status,
      `Error de autenticación con API externa: ${response.status}`,
    );
  }

  let body;
  try {
    body = JSON.parse(rawText);
  } catch {
    throw new ConsolideApiError(
      502,
      "Respuesta inválida del servidor de autenticación externo",
    );
  }
  if (!body?.esExitosa || !body?.datos?.accessToken) {
    throw new ConsolideApiError(
      401,
      body?.mensaje || "Autenticación externa fallida",
    );
  }

  return body.datos.accessToken;
}

async function doFetchEmpleados(
  token,
  empresaId,
  fechaInicio,
  fechaFin,
  trabId,
) {
  return fetchWithTimeout(EMP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      IDEmpresa: String(empresaId),
    },
    body: JSON.stringify({
      empresa_ID: empresaId,
      trab_ID: trabId,
      fecha_Movimiento_Inicio: fechaInicio,
      fecha_Movimiento_Fin: fechaFin,
    }),
  });
}

async function fetchEmpleados({
  idEmpresa,
  fechaInicio,
  fechaFin,
  trabId = "",
}) {
  if (!idEmpresa)
    throw new ConsolideApiError(
      400,
      "El parámetro idEmpresa es requerido para consultar la API",
    );

  const empresaId = parseInt(idEmpresa, 10);
  let token = await getAccessToken();
  let response = await doFetchEmpleados(
    token,
    empresaId,
    fechaInicio,
    fechaFin,
    trabId,
  );

  if (response.status === 401) {
    token = await getAccessToken();
    response = await doFetchEmpleados(
      token,
      empresaId,
      fechaInicio,
      fechaFin,
      trabId,
    );
  }
  if (response.status === 429)
    throw new ConsolideApiError(
      429,
      "La API externa está temporalmente saturada. Intenta en unos minutos.",
      true,
    );
  if (response.status === 403)
    throw new ConsolideApiError(
      403,
      "Acceso denegado por la API externa. Verifica IDEmpresa y permisos.",
    );
  if (!response.ok)
    throw new ConsolideApiError(
      response.status,
      `Error del servidor externo: ${response.status} ${response.statusText}`,
    );

  let body;
  try {
    body = await response.json();
  } catch {
    throw new ConsolideApiError(
      502,
      "La API externa retornó una respuesta no válida (JSON inválido)",
    );
  }
  if (String(body?.tipo_Estatus || "").trim().toLowerCase() === "error") {
    throw new ConsolideApiError(
      502,
      "Consolide devolvió un error de negocio al consultar colaboradores; no es una respuesta sin datos.",
    );
  }
  if (!Array.isArray(body?.resultado)) {
    throw new ConsolideApiError(
      502,
      'La API externa retornó un formato inesperado (sin "resultado")',
    );
  }
  return body.resultado;
}

async function testConnection() {
  try {
    await getAccessToken();
    return { ok: true, mensaje: "Conexión exitosa con API" };
  } catch (error) {
    return { ok: false, mensaje: error.message };
  }
}

module.exports = { fetchEmpleados, testConnection, ConsolideApiError };
