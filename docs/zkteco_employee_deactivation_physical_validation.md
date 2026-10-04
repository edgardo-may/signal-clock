# Validación física controlada: baja de colaborador ZKTeco

Estado: `PHYSICAL_VALIDATION_REQUIRED`. No ejecutar con un colaborador real.

## Resultado físico e incidente

```text
DATA DELETE USERINFO Pin=9999
= UNSAFE / PHYSICALLY REJECTED
```

En `SYZ8243400788` se observó que esta variante eliminó todos los usuarios de la terminal física. No volver a usar `Pin=`, `pin=` ni ninguna forma que no sea exactamente `PIN=<número>`; el conector las bloquea y consume sin enviarlas.

El único candidato pendiente de validación es:

```text
DATA DELETE USERINFO PIN=<device_employee_assignments.biometric_user_id>
```

`UPDATE USERINFO` sí está validado; ningún DELETE está validado. La próxima prueba usará dos usuarios ficticios ya presentes físicamente: `9998` como control y `9999` como objetivo. Enviar una sola vez `DATA DELETE USERINFO PIN=9999`. PASS requiere que desaparezca solo `9999`, que `9998` y los demás usuarios permanezcan, y que el ACK sea `Return=0`. Si desaparece más de un usuario, abandonar DELETE USERINFO para ese firmware.

1. Crear un colaborador de prueba y asignarlo a una única terminal de prueba.
2. Esperar el `UPDATE USERINFO` y comprobar físicamente que aparece en el ZKTeco.
3. Enrolar una huella o rostro de prueba si el terminal lo exige para la comprobación.
4. Dar de baja desde Signum Clock; no insertar comandos manuales.
5. Verificar una sola fila pendiente en `device_commands` para esa terminal y PIN exacto.
6. Esperar el siguiente `/getrequest` y capturar el wire enviado.
7. Confirmar que el wire coincide exactamente con el candidato anterior.
8. Capturar `/devicecmd` y comprobar `Return=0`.
9. Comprobar `device_commands.is_executed=true`, `updated_at` actualizado, y assignment con `activo=false`, `suspension_reason=EMPLOYEE_DEACTIVATED`, `sync_status=SYNCED`.
10. Comprobar físicamente que el usuario no aparece y que su huella/rostro/tarjeta ya no permite una checada.
11. Comprobar que el historial de Signum Clock y los templates en Supabase siguen intactos.

Si `Return` no es `0`, conservar los usuarios de prueba, registrar modelo/firmware y wire observado. El assignment debe quedar `ERROR`, con `last_error=Terminal Return=<código>` y el comando ACK consumido; no reintentar automáticamente.

## Recuperación de la terminal

No cambiar empleados, historial, attendance logs ni templates de Supabase. Para recuperar solo la terminal física:

1. Identificar assignments activos/SYNCED de `SYZ8243400788`.

```sql
SELECT dea.id AS assignment_id,
       dea.employee_id,
       dea.biometric_user_id,
       dea.sync_status,
       e.nombre,
       e.apellido
FROM public.device_employee_assignments dea
JOIN public.devices d ON d.id = dea.device_id
JOIN public.empleados e ON e.id = dea.employee_id
                       AND e.cliente_id = dea.cliente_id
WHERE UPPER(BTRIM(d.serial_number)) = 'SYZ8243400788'
  AND dea.activo = TRUE
  AND e.activo = TRUE
ORDER BY dea.biometric_user_id;
```

2. Reencolar únicamente USERINFO validado para los empleados activos de ese dispositivo.
3. Verificar físicamente qué usuarios reaparecieron.
4. Inventariar las huellas y rostros que requieran re-enrolamiento físico; no asumir reinyección de templates.
5. Mantener empleados y attendance histórico sin cambios.
