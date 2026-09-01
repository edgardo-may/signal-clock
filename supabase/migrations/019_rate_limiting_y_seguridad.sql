-- ================================================================
-- SIGNUM-CLOCK · Migración 019
-- Sistema de Rate Limiting y Protección contra Abuso
-- ================================================================

-- 1. TABLA PARA AUDITORÍA Y CONTROL DE TASA (RATE LIMIT LOGS)
CREATE TABLE IF NOT EXISTS public.rate_limits_logs (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address   TEXT         NOT NULL,
  user_id      UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  cliente_id   UUID         REFERENCES public.clientes(id) ON DELETE CASCADE,
  operacion    TEXT         NOT NULL,
  creado_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Índices para búsqueda rápida de tasa
CREATE INDEX IF NOT EXISTS idx_rate_limits_logs_ip ON public.rate_limits_logs(ip_address, creado_at);
CREATE INDEX IF NOT EXISTS idx_rate_limits_logs_user ON public.rate_limits_logs(user_id, creado_at);

-- Limpieza automática de logs viejos para no saturar la BD (ej. mayores a 24 horas)
CREATE OR REPLACE FUNCTION public.fn_limpiar_rate_limits_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.rate_limits_logs WHERE creado_at < NOW() - INTERVAL '24 hours';
END;
$$;


-- 2. TABLA DE FUERZA BRUTA DE INICIO DE SESIÓN
CREATE TABLE IF NOT EXISTS public.login_attempts (
  ip_address       TEXT,
  email            TEXT,
  intentos         INTEGER NOT NULL DEFAULT 0,
  bloqueado_hasta  TIMESTAMPTZ,
  ultimo_intento   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ip_address, email)
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_lookup ON public.login_attempts(ip_address, email);


-- 3. FUNCIÓN DE VERIFICACIÓN DE RATE LIMIT (TRIGGERS DE TABLAS)
CREATE OR REPLACE FUNCTION public.fn_verificar_rate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ip TEXT;
  v_user_id UUID;
  v_cliente_id UUID;
  v_max_req INT;
  v_window INTERVAL;
  v_req_count INT;
  v_operacion TEXT;
BEGIN
  -- Bypassear service_role (ej. Receptor ISUP Hikvision o tareas automatizadas de administración)
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Obtener IP actual de la cabecera
  BEGIN
    v_ip := COALESCE(
      current_setting('request.headers', true)::json->>'x-forwarded-for',
      current_setting('request.headers', true)::json->>'cf-connecting-ip',
      '127.0.0.1'
    );
  EXCEPTION WHEN OTHERS THEN
    v_ip := '127.0.0.1';
  END;

  v_user_id := auth.uid();
  v_cliente_id := public.auth_cliente_id();
  v_operacion := TG_TABLE_NAME || '_' || TG_OP;

  -- Definir límites dinámicos por tabla
  IF TG_TABLE_NAME = 'asistencias' THEN
    v_max_req := 60; -- 60 inserciones por minuto
    v_window := INTERVAL '1 minute';
  ELSIF TG_TABLE_NAME = 'empleados' THEN
    v_max_req := 30; -- 30 inserciones/ediciones por minuto
    v_window := INTERVAL '1 minute';
  ELSIF TG_TABLE_NAME = 'dispositivos' THEN
    v_max_req := 15; -- 15 por minuto
    v_window := INTERVAL '1 minute';
  ELSIF TG_TABLE_NAME = 'clientes' THEN
    v_max_req := 10; -- 10 por minuto
    v_window := INTERVAL '1 minute';
  ELSE
    v_max_req := 60;
    v_window := INTERVAL '1 minute';
  END IF;

  -- Insertar log de petición
  INSERT INTO public.rate_limits_logs (ip_address, user_id, cliente_id, operacion)
  VALUES (v_ip, v_user_id, v_cliente_id, v_operacion);

  -- Contar peticiones del mismo usuario o IP
  SELECT COUNT(*) INTO v_req_count
  FROM public.rate_limits_logs
  WHERE operacion = v_operacion
    AND (
      (v_user_id IS NOT NULL AND user_id = v_user_id) OR
      (v_user_id IS NULL AND ip_address = v_ip)
    )
    AND creado_at >= NOW() - v_window;

  -- Lanza excepción si supera el límite
  IF v_req_count > v_max_req THEN
    RAISE EXCEPTION 'Límite de solicitudes excedido (429). Por favor, intenta de nuevo en un minuto.'
      USING ERRCODE = 'P4290'; -- Código de error de aplicación personalizado
  END IF;

  RETURN NEW;
END;
$$;

-- Vincular Triggers
DROP TRIGGER IF EXISTS trg_rate_limit_empleados ON public.empleados;
CREATE TRIGGER trg_rate_limit_empleados
  BEFORE INSERT OR UPDATE OR DELETE ON public.empleados
  FOR EACH ROW EXECUTE FUNCTION public.fn_verificar_rate_limit();

DROP TRIGGER IF EXISTS trg_rate_limit_dispositivos ON public.dispositivos;
CREATE TRIGGER trg_rate_limit_dispositivos
  BEFORE INSERT OR UPDATE OR DELETE ON public.dispositivos
  FOR EACH ROW EXECUTE FUNCTION public.fn_verificar_rate_limit();

DROP TRIGGER IF EXISTS trg_rate_limit_asistencias ON public.asistencias;
CREATE TRIGGER trg_rate_limit_asistencias
  BEFORE INSERT ON public.asistencias
  FOR EACH ROW EXECUTE FUNCTION public.fn_verificar_rate_limit();


-- 4. RPC: VALIDACIÓN DE SEGURIDAD PARA INICIO DE SESIÓN
CREATE OR REPLACE FUNCTION public.security_check_login_limit(p_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ip TEXT;
  v_attempt RECORD;
  v_clean_email TEXT;
BEGIN
  v_clean_email := LOWER(TRIM(p_email));

  BEGIN
    v_ip := COALESCE(
      current_setting('request.headers', true)::json->>'x-forwarded-for',
      current_setting('request.headers', true)::json->>'cf-connecting-ip',
      '127.0.0.1'
    );
  EXCEPTION WHEN OTHERS THEN
    v_ip := '127.0.0.1';
  END;

  SELECT * INTO v_attempt
  FROM public.login_attempts
  WHERE ip_address = v_ip AND email = v_clean_email;

  IF FOUND THEN
    -- Si está bloqueado y aún no pasa el tiempo
    IF v_attempt.bloqueado_hasta IS NOT NULL AND v_attempt.bloqueado_hasta > NOW() THEN
      RETURN jsonb_build_object(
        'blocked', true,
        'remaining_seconds', CEIL(EXTRACT(EPOCH FROM (v_attempt.bloqueado_hasta - NOW())))
      );
    END IF;

    -- Si ya expiró el bloqueo, resetear
    IF v_attempt.bloqueado_hasta IS NOT NULL AND v_attempt.bloqueado_hasta <= NOW() THEN
      UPDATE public.login_attempts
      SET intentos = 0, bloqueado_hasta = NULL
      WHERE ip_address = v_ip AND email = v_clean_email;
    END IF;
  END IF;

  RETURN jsonb_build_object('blocked', false, 'remaining_seconds', 0);
END;
$$;


-- 5. RPC: REGISTRAR INTENTO DE LOGIN (FALLIDO O EXITOSO)
CREATE OR REPLACE FUNCTION public.security_register_login_attempt(p_email TEXT, p_success BOOLEAN)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ip TEXT;
  v_clean_email TEXT;
  v_intentos INT;
BEGIN
  v_clean_email := LOWER(TRIM(p_email));

  BEGIN
    v_ip := COALESCE(
      current_setting('request.headers', true)::json->>'x-forwarded-for',
      current_setting('request.headers', true)::json->>'cf-connecting-ip',
      '127.0.0.1'
    );
  EXCEPTION WHEN OTHERS THEN
    v_ip := '127.0.0.1';
  END;

  IF p_success THEN
    -- Si es exitoso, eliminar o limpiar registro
    DELETE FROM public.login_attempts
    WHERE ip_address = v_ip AND email = v_clean_email;
  ELSE
    -- Si falla, actualizar contador
    INSERT INTO public.login_attempts (ip_address, email, intentos, ultimo_intento)
    VALUES (v_ip, v_clean_email, 1, NOW())
    ON CONFLICT (ip_address, email) DO UPDATE
    SET intentos = login_attempts.intentos + 1,
        ultimo_intento = NOW(),
        bloqueado_hasta = CASE 
          WHEN login_attempts.intentos + 1 >= 5 THEN NOW() + INTERVAL '15 minutes'
          ELSE NULL 
        END;
  END IF;
END;
$$;


-- 6. RPC: VALIDACIÓN DE RECUPERACIÓN DE CONTRASEÑA (PASSWORD RECOVERY RATE LIMIT)
CREATE OR REPLACE FUNCTION public.security_check_recovery_limit(p_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ip TEXT;
  v_clean_email TEXT;
  v_req_count INT;
BEGIN
  v_clean_email := LOWER(TRIM(p_email));

  BEGIN
    v_ip := COALESCE(
      current_setting('request.headers', true)::json->>'x-forwarded-for',
      current_setting('request.headers', true)::json->>'cf-connecting-ip',
      '127.0.0.1'
    );
  EXCEPTION WHEN OTHERS THEN
    v_ip := '127.0.0.1';
  END;

  -- Registrar solicitud en logs de rate limit
  INSERT INTO public.rate_limits_logs (ip_address, user_id, cliente_id, operacion)
  VALUES (v_ip, NULL, NULL, 'auth_password_recovery_' || v_clean_email);

  -- Contar peticiones en la última hora para esta IP y email
  SELECT COUNT(*) INTO v_req_count
  FROM public.rate_limits_logs
  WHERE operacion = 'auth_password_recovery_' || v_clean_email
    AND ip_address = v_ip
    AND creado_at >= NOW() - INTERVAL '1 hour';

  IF v_req_count > 3 THEN
    RETURN jsonb_build_object('allowed', false, 'error', 'Has alcanzado el límite de 3 solicitudes de recuperación por hora. Por favor, intenta más tarde.');
  END IF;

  RETURN jsonb_build_object('allowed', true);
END;
$$;


-- Habilitar RLS en tablas de seguridad internas
ALTER TABLE public.rate_limits_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

-- Ningún rol anónimo o autenticado directo debe poder ver/modificar logs de rate limits directamente
CREATE POLICY "rate_limits_logs_policy" ON public.rate_limits_logs TO service_role USING (true);
CREATE POLICY "login_attempts_policy" ON public.login_attempts TO service_role USING (true);

-- Permisos de ejecución de RPCs
GRANT EXECUTE ON FUNCTION public.security_check_login_limit(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.security_register_login_attempt(TEXT, BOOLEAN) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.security_check_recovery_limit(TEXT) TO anon, authenticated;
