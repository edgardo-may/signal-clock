// One-off local artifact generation: derive RPC literally from migration 118.
const fs = require('node:fs');
const source = fs.readFileSync('database/live-schema/118_schedule_same_day_creation.sql','utf8').replace(/\r\n/g,'\n');
const start = source.indexOf('CREATE OR REPLACE FUNCTION public.apply_employee_schedule_lifecycle(');
if(start<0)throw Error('Missing canonical lifecycle RPC');
let sql = source.slice(start).replace(/\s*COMMIT;\s*$/,'');
const guard = "IF v_old.fecha_inicio = p_effective_date THEN RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_SAME_DAY_REPLACEMENT_UNSUPPORTED'; END IF;";
if(!sql.includes(guard))throw Error('Missing original guard');
sql=sql.replace(guard,`IF (p_effective_date=v_today OR v_old.fecha_inicio=p_effective_date) AND (
            EXISTS(SELECT 1 FROM public.registro_asistencia WHERE cliente_id=p_cliente_id AND empleado_id=v_employee_id
               AND verificado_at >= (p_effective_date::timestamp AT TIME ZONE 'America/Cancun'))
            OR EXISTS(SELECT 1 FROM public.attendance_source_events WHERE cliente_id=p_cliente_id AND employee_id=v_employee_id
               AND occurred_at >= (p_effective_date::timestamp AT TIME ZONE 'America/Cancun'))
            OR EXISTS(SELECT 1 FROM public.workday_records WHERE cliente_id=p_cliente_id AND empleado_id=v_employee_id AND workday_date >= p_effective_date)
            OR EXISTS(SELECT 1 FROM public.workday_record_history WHERE cliente_id=p_cliente_id AND empleado_id=v_employee_id AND workday_date >= p_effective_date)
            OR EXISTS(SELECT 1 FROM public.workday_calculation_revisions WHERE cliente_id=p_cliente_id AND empleado_id=v_employee_id AND workday_date >= p_effective_date)
            OR EXISTS(SELECT 1 FROM public.workday_revision_promotions WHERE cliente_id=p_cliente_id AND empleado_id=v_employee_id AND workday_date >= p_effective_date)
            OR EXISTS(SELECT 1 FROM public.attendance_persist_outbox o JOIN public.registro_asistencia r ON r.id=o.registro_id
               WHERE o.cliente_id=p_cliente_id AND o.empleado_id=v_employee_id
               AND r.verificado_at >= (p_effective_date::timestamp AT TIME ZONE 'America/Cancun'))) THEN
            RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_REPLACEMENT_HAS_EVIDENCE';
          END IF;
          IF v_old.fecha_inicio = p_effective_date THEN
          IF p_effective_date < v_today THEN RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_HISTORICAL_REPLACEMENT_UNSUPPORTED'; END IF;
          v_old_json := to_jsonb(v_old);
          UPDATE public.empleados_horarios SET activo=false, actualizado_at=clock_timestamp() WHERE id=v_old.id RETURNING * INTO v_new;
          PERFORM public.log_audit_event(p_cliente_id,'SCHEDULE_VOIDED','Asignación Horario',v_new.id::text,'SUCCESS',jsonb_build_object('cliente_id',p_cliente_id,'empleado_id',v_employee_id,'assignment_id',v_new.id,'horario_id',v_new.horario_id,'old_values',v_old_json,'new_values',to_jsonb(v_new),'reason',trim(p_reason),'correlation_id',p_correlation_id,'timestamp',clock_timestamp(),'replacement',true));
        ELSE`);
const boundary='      END IF;\n      INSERT INTO public.empleados_horarios';
if(!sql.includes(boundary))throw Error('Missing insertion boundary');
sql=sql.replace(boundary,'        END IF;\n'+boundary);
sql=sql.replace("IF NOT EXISTS (SELECT 1 FROM public.empleados WHERE id=v_employee_id AND cliente_id=p_cliente_id) THEN RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_EMPLOYEE_TENANT_MISMATCH'; END IF;",`PERFORM 1 FROM public.empleados WHERE id=v_employee_id AND cliente_id=p_cliente_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'SCHEDULE_LIFECYCLE_EMPLOYEE_TENANT_MISMATCH'; END IF;`);
const header=`-- Additive correction to 118: replace an unstarted assignment on its start date.
-- Old assignment retained as inactive; revisions and Workdays preserved.
-- No changes to resolver rules, Attendance or persistence contracts.
BEGIN;
DO $$ BEGIN
  IF to_regprocedure('public.assert_schedule_start_not_elapsed(date,jsonb)') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.empleados_horarios'::regclass
      AND tgname='trg_guard_same_day_schedule_assignment' AND tgenabled IN ('O','A') AND NOT tgisinternal)
    OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.empleados_horarios'::regclass
      AND tgname='trg_guard_active_schedule_employee' AND tgenabled IN ('O','A') AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SCHEDULE_122_REQUIRES_118';
  END IF;
END $$;
`;
fs.writeFileSync('database/live-schema/122_schedule_same_start_date_reassignment.sql',header+sql+`
REVOKE ALL ON FUNCTION public.apply_employee_schedule_lifecycle(uuid,uuid[],text,uuid,date,date,uuid,text,uuid,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.apply_employee_schedule_lifecycle(uuid,uuid[],text,uuid,date,date,uuid,text,uuid,boolean,boolean) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
`);
