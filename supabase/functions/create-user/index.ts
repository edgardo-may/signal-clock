// supabase/functions/create-user/index.ts
// ──────────────────────────────────────────────────────────────────────────────
//  SIGNUM-CLOCK · Edge Function · Crear Usuario Administrativamente
//  
//  Este endpoint permite a un administrador autenticado crear nuevos usuarios
//  sin perder su propia sesión. Usa auth.admin.createUser() con service_role.
//
//  SEGURIDAD:
//  - Admin: su propia empresa; superadmin: empresa destino explícita y existente
//  - service_role NUNCA se expone al frontend
//  - Valida el JWT del admin antes de crear el usuario
// ──────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveUserCreationTenant } from './authorization.js'

// Dynamic CORS to validate Origin
const ALLOWED_ORIGINS = (Deno.env.get('FRONTEND_ALLOWED_ORIGINS') || 'http://localhost:5173').split(',').map(o => o.trim())

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') || ''
  const isAllowed = ALLOWED_ORIGINS.includes(origin) || (origin && origin.includes('localhost'))
  
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  }
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req)
  
  // Preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Método no permitido' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    // ── 1. Verificar que el solicitante es un admin autenticado ──────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'No autorizado. Se requiere autenticación.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Cliente con anon key para verificar al solicitante
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user: caller }, error: callerError } = await supabaseAuth.auth.getUser()
    if (callerError || !caller) {
      return new Response(
        JSON.stringify({ error: 'Sesión inválida o expirada.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Leer el rol persistido después de validar el JWT. La autorización no
    // depende de metadata editable ni de las políticas de lectura del cliente.
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: callerProfile, error: callerProfileError } = await supabaseAdmin
      .from('usuarios_perfiles')
      .select('rol, cliente_id, estatus_cuenta')
      .eq('id', caller.id)
      .single()

    if (callerProfileError) {
      return new Response(JSON.stringify({ error: 'No se pudo verificar el perfil administrativo.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!callerProfile || !['admin', 'superadmin'].includes(callerProfile.rol?.toLowerCase())) {
      return new Response(
        JSON.stringify({ error: 'Se requiere un perfil admin o superadmin para crear usuarios.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── 2. Parsear datos del nuevo usuario ───────────────────────────────
    const body = await req.json()
    const { email, password, nombre, rol, estatus_cuenta } = body
    let targetTenantId: string
    try {
      targetTenantId = resolveUserCreationTenant(callerProfile, body.cliente_id)
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (typeof email !== 'string' || typeof password !== 'string' || typeof nombre !== 'string' || !email.trim() || !nombre.trim()) {
      return new Response(
        JSON.stringify({ error: 'Datos incompletos. Se requiere email, password y nombre.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: 'La contraseña debe tener al menos 6 caracteres.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validar rol contra los permitidos por la BD
    const rolesPermitidos = ['admin', 'auditor']
    const rolFinal = rolesPermitidos.includes(rol) ? rol : 'auditor'

    // ── 3. Crear usuario con service_role (sin afectar sesión del admin) ─
    const { data: targetTenant, error: tenantError } = await supabaseAdmin
      .from('clientes').select('id').eq('id', targetTenantId).maybeSingle()
    if (tenantError || !targetTenant) {
      return new Response(JSON.stringify({ error: 'La empresa seleccionada no existe.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true, // Auto-confirma sin enviar correo
      user_metadata: {
        nombre,
        rol: rolFinal,
        cliente_id: targetTenantId,
        estatus_cuenta: estatus_cuenta || 'activo',
      },
    })

    if (createError) {
      // Mapear errores comunes a mensajes legibles
      const msg = createError.message?.toLowerCase() || ''

      if (msg.includes('already been registered') || msg.includes('already exists')) {
        return new Response(
          JSON.stringify({ error: 'Este correo electrónico ya está registrado en el sistema.' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      if (msg.includes('rate limit')) {
        return new Response(
          JSON.stringify({ error: 'Se alcanzó el límite de creación de usuarios. Intenta en unos minutos.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({ error: `Error al crear usuario: ${createError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── 4. Verificar que el trigger creó el perfil ──────────────────────
    // El trigger fn_auto_crear_perfil_usuario() debería haber creado el perfil
    // automáticamente. Verificamos y si no existe, lo creamos con service_role.
    if (newUser?.user?.id) {
      const { data: existingProfile, error: profileReadError } = await supabaseAdmin
        .from('usuarios_perfiles')
        .select('id, cliente_id, rol')
        .eq('id', newUser.user.id)
        .maybeSingle()

      if (profileReadError || (existingProfile &&
        (existingProfile.cliente_id !== targetTenantId || existingProfile.rol !== rolFinal))) {
        await supabaseAdmin.auth.admin.deleteUser(newUser.user.id)
        throw new Error('No se pudo confirmar el perfil de acceso en la empresa seleccionada.')
      }

      if (!existingProfile) {
        // Fallback: crear perfil manualmente si el trigger no se disparó
        const { error: profileError } = await supabaseAdmin
          .from('usuarios_perfiles')
          .insert({
            id: newUser.user.id,
            cliente_id: targetTenantId,
            nombre,
            rol: rolFinal,
            estatus_cuenta: estatus_cuenta || 'activo',
          })
        if (profileError) {
          await supabaseAdmin.auth.admin.deleteUser(newUser.user.id)
          throw profileError
        }
      }
    }

    // ── 4.5 Registrar en audit_logs ─────────────────────────────────────
    const clientIp = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown'
    await supabaseAdmin
      .from('audit_logs')
      .insert({
        cliente_id: targetTenantId,
        actor_user_id: caller.id,
        actor_role: callerProfile.rol,
        action: 'USER_CREATED',
        resource_type: 'usuarios_perfiles',
        resource_id: newUser?.user?.id,
        result: 'SUCCESS',
        ip_address: clientIp,
        metadata: {
          email: email.trim().toLowerCase(),
          rol: rolFinal,
          cliente_id: targetTenantId,
          nombre: nombre
        }
      })


    // ── 5. Respuesta exitosa ────────────────────────────────────────────
    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: newUser?.user?.id,
          email: newUser?.user?.email,
          nombre,
          rol: rolFinal,
        },
      }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('[create-user] Error inesperado:', err)
    return new Response(
      JSON.stringify({ error: 'Error interno del servidor.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
