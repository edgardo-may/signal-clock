# 11 - Seguridad, Aislamiento Multi-Tenant y Protección de Datos

> **Módulo:** Cumplimiento Laboral México 2027  
> **Fase:** Fase 1  

---

## 1. Principios de Seguridad

1. **Aislamiento Multi-Tenant en la Capa de Dominio:**
   - La función `AttendanceNormalizer.normalize()` verifica que cada marcaje pertenezca estrictamente al `clienteId` esperado.
   - Si se detecta un marcaje de otro tenant, se arroja un `TenantMismatchError` bloqueando inmediatamente el cálculo.

2. **Protección de Evidencia Cruda (RAW):**
   - La tabla `attendance_logs` es inmutable.
   - Las terminales biométricas ZKTeco y Hikvision insertan directamente sin bloqueos ni triggers pesados.

3. **Control de Integridad SHA-256:**
   - Cada jornada calculada genera un hash determinista mediante `WorkdayIntegrityHasher`.
   - Cualquier recálculo, ajuste o modificación de marcajes cambia el hash, dejando rastro verificable.
   - *Nota Legal:* El hash SHA-256 es un control técnico de integridad y detección de manipulaciones; no constituye firma digital o electrónica avanzada.
