export interface EmployeeInput {
  nombre: string;
  apellido: string;
  clave_empleado?: string | null;
  departamento?: string | null;
  puesto?: string | null;
  pin?: string | null;
  device_userid?: string | null;
  tarjeta?: string | null;
  sexo?: 'M' | 'F';
  fecha_ingreso?: string | null;
  fecha_cumpleanos?: string | null;
}
export interface Employee extends EmployeeInput {
  id: string;
  activo: boolean;
  avatar_url: string | null;
  creado_at: string;
  actualizado_at: string | null;
}
export interface CreateEmployeeInput extends EmployeeInput { activo?: boolean }
export interface EmployeeCapacity {
  nombre_empresa: string;
  plan_suscripcion: string;
  estatus: string;
  fecha_vencimiento: string | null;
  limite_empleados: number;
  empleados_actuales: number;
}
export interface EmployeeQuery { limit: number; offset: number }
export interface EmployeePage { data: Employee[]; limit: number; offset: number; hasMore: boolean }
export type LifecycleAction = 'CHECK' | 'DEACTIVATE' | 'ACTIVATE' | 'DELETE';
export interface LifecycleResult {
  status: string;
  count?: number;
  attendance_count?: number;
  incidents_count?: number;
  devices_count?: number;
  assignments_pending_removal?: number;
  assignments_pending_sync?: number;
  biometrics?: string;
}
