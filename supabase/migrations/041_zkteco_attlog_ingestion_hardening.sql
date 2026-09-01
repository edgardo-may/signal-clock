DROP TRIGGER IF EXISTS trg_attendance_to_registro ON public.attendance_logs;
DROP FUNCTION IF EXISTS public.trg_process_attendance_log();

CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_logs_unique_event 
ON public.attendance_logs (device_serial, user_id, "timestamp");
