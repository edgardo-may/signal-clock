require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Error: Faltan variables de entorno SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Función para generar contraseña aleatoria
function generatePassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*";
  let pass = "";
  for (let i = 0; i < 10; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
}

async function migrateEmails() {
  console.log("=== INICIANDO MIGRACIÓN DE EMAILS A USUARIOS ===");
  
  // 1. Obtener empleados con email
  const { data: empleados, error } = await supabase
    .from('empleados')
    .select('*')
    .not('email', 'is', null)
    .not('email', 'eq', '');
    
  if (error) {
    console.error("Error al obtener empleados:", error);
    return;
  }
  
  console.log(`Se encontraron ${empleados.length} empleados con correo configurado.`);
  
  if (empleados.length === 0) {
    console.log("No hay nada que migrar. Puedes proceder con la migración 027.");
    return;
  }

  const results = [];
  
  for (const emp of empleados) {
    console.log(`Migrando: ${emp.nombre} ${emp.apellido} (${emp.email})...`);
    
    // Validar formato de email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emp.email.trim())) {
      console.log(`  [SKIPPED] Email inválido: ${emp.email}`);
      results.push({ email: emp.email, status: 'SKIPPED', reason: 'Invalid Email Format' });
      continue;
    }
    
    const password = generatePassword();
    const fullName = `${emp.nombre} ${emp.apellido}`;
    
    // 2. Crear usuario en Auth
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email: emp.email.trim().toLowerCase(),
      password: password,
      email_confirm: true,
      user_metadata: {
        nombre: fullName,
        rol: 'colaborador',
        cliente_id: emp.cliente_id,
        estatus_cuenta: emp.activo ? 'activo' : 'suspendido',
      }
    });
    
    if (authError) {
      if (authError.message.includes('already been registered') || authError.message.includes('already exists')) {
        console.log(`  [SKIPPED] El usuario ya existe en auth.users: ${emp.email}`);
        results.push({ email: emp.email, status: 'EXISTS', reason: 'User already in auth.users' });
      } else {
        console.error(`  [ERROR] Falló creación para ${emp.email}:`, authError.message);
        results.push({ email: emp.email, status: 'ERROR', reason: authError.message });
      }
    } else {
      console.log(`  [SUCCESS] Creado usuario para ${emp.email}`);
      results.push({ email: emp.email, password: password, status: 'CREATED', name: fullName });
      
      // 3. Verificamos que se haya creado el perfil en usuarios_perfiles
      if (authUser?.user?.id) {
        const { data: profile } = await supabase
          .from('usuarios_perfiles')
          .select('id')
          .eq('id', authUser.user.id)
          .maybeSingle();
          
        if (!profile) {
          console.log(`  [INFO] Creando perfil manualmente para ${emp.email}`);
          await supabase.from('usuarios_perfiles').insert({
            id: authUser.user.id,
            cliente_id: emp.cliente_id,
            nombre: fullName,
            rol: 'colaborador',
            estatus_cuenta: emp.activo ? 'activo' : 'suspendido',
          });
        }
      }
    }
  }
  
  // 4. Guardar un reporte
  fs.writeFileSync('migration_report.json', JSON.stringify(results, null, 2));
  console.log("\n=== MIGRACIÓN FINALIZADA ===");
  console.log(`Reporte guardado en backend/migration_report.json. Revisa este archivo para ver las contraseñas generadas.`);
}

migrateEmails();
