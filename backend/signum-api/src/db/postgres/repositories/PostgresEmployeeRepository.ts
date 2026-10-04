import type { PoolClient } from 'pg';
import type { EmployeeRepository } from '../../../repositories/EmployeeRepository.js';
import type { Employee, EmployeeInput, CreateEmployeeInput, EmployeeCapacity, EmployeePage, EmployeeQuery, LifecycleAction, LifecycleResult } from '../../../domain/employees/Employee.js';
import type { TenantContext } from '../../../types/RequestContext.js';
import { PostgresConnection } from '../connection.js';
import { ApiError } from '../../../errors.js';

const columns = 'id, nombre, apellido, clave_empleado, departamento, puesto, pin, device_userid, tarjeta, sexo, fecha_ingreso, fecha_cumpleanos, activo, avatar_url, creado_at, actualizado_at';
const writable = ['nombre', 'apellido', 'clave_empleado', 'departamento', 'puesto', 'pin', 'device_userid', 'tarjeta', 'sexo', 'fecha_ingreso', 'fecha_cumpleanos'] as const;

export class PostgresEmployeeRepository implements EmployeeRepository {
  constructor(private readonly db: PostgresConnection) {}
  capacity(context: TenantContext): Promise<EmployeeCapacity> {
    return this.db.transaction(context.userId, async client => {
      const { rows } = await this.db.query<EmployeeCapacity>(client, `SELECT nombre_empresa, plan_suscripcion,
        estatus, fecha_vencimiento, limite_empleados,
        (SELECT count(*)::int FROM public.empleados WHERE cliente_id = $1) AS empleados_actuales
        FROM public.clientes WHERE id = $1`, [context.tenantId]);
      if (!rows[0]) throw new ApiError(403, 'TENANT_CONTEXT_UNAVAILABLE');
      return rows[0];
    });
  }
  private async find(client: PoolClient, context: TenantContext, id: string, lock = false): Promise<Employee | null> {
    const result = await this.db.query<Employee>(client,
      `SELECT ${columns} FROM public.empleados WHERE cliente_id = $1 AND id = $2${lock ? ' FOR UPDATE' : ''}`, [context.tenantId, id]);
    return result.rows[0] ?? null;
  }
  findAll(context: TenantContext, query: EmployeeQuery): Promise<EmployeePage> {
    return this.db.transaction(context.userId, async client => {
      const { rows } = await this.db.query<Employee>(client,
        `SELECT ${columns} FROM public.empleados WHERE cliente_id = $1 ORDER BY apellido, id LIMIT $2 OFFSET $3`,
        [context.tenantId, query.limit + 1, query.offset]);
      return { data: rows.slice(0, query.limit), ...query, hasMore: rows.length > query.limit };
    });
  }
  findById(context: TenantContext, id: string): Promise<Employee | null> {
    return this.db.transaction(context.userId, client => this.find(client, context, id));
  }
  private async insert(client: PoolClient, context: TenantContext, input: CreateEmployeeInput): Promise<Employee> {
      const fields = ([...writable, 'activo'] as const).filter(key => input[key] !== undefined);
      const values = fields.map(key => input[key]);
      const result = await this.db.query<Employee>(client,
        `INSERT INTO public.empleados (cliente_id, ${fields.join(', ')}) VALUES ($1, ${fields.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING ${columns}`,
        [context.tenantId, ...values]);
      const employee = result.rows[0];
      if (!employee) throw new Error('Missing inserted employee');
      return employee;
  }
  create(context: TenantContext, input: CreateEmployeeInput): Promise<Employee> {
    return this.db.transaction(context.userId, client => this.insert(client, context, input));
  }
  createMany(context: TenantContext, inputs: CreateEmployeeInput[]): Promise<number> {
    return this.db.transaction(context.userId, async client => {
      // One transaction preserves the legacy all-or-nothing CSV import semantics.
      for (const input of inputs) await this.insert(client, context, input);
      return inputs.length;
    });
  }
  update(context: TenantContext, id: string, input: Partial<EmployeeInput>): Promise<Employee | null> {
    return this.db.transaction(context.userId, async client => {
      const fields = writable.filter(key => input[key] !== undefined);
      if (!fields.length) throw new ApiError(400, 'EMPTY_UPDATE');
      const { rows } = await this.db.query<Employee>(client,
        `UPDATE public.empleados SET ${fields.map((key, i) => `${key} = $${i + 3}`).join(', ')}, actualizado_at = now() WHERE cliente_id = $1 AND id = $2 RETURNING ${columns}`,
        [context.tenantId, id, ...fields.map(key => input[key])]);
      return rows[0] ?? null;
    });
  }
  lifecycle(context: TenantContext, id: string, action: LifecycleAction): Promise<LifecycleResult> {
    return this.db.transaction(context.userId, async client => {
      // Explicit tenant lookup before the existing RPC; lock mutating actions in the same transaction.
      if (!await this.find(client, context, id, action !== 'CHECK')) throw new ApiError(404, 'EMPLOYEE_NOT_FOUND');
      const { rows } = await this.db.query<{ result: LifecycleResult }>(client,
        'SELECT public.fn_employee_lifecycle($1::uuid, $2::text) AS result', [id, action]);
      const result = rows[0]?.result;
      if (!result) throw new Error('Invalid lifecycle response');
      if (result.status === 'ERROR') throw new ApiError(409, 'EMPLOYEE_LIFECYCLE_CONFLICT');
      if (result.status === 'UNAUTHORIZED') throw new ApiError(403, 'FORBIDDEN');
      if (result.status === 'EMPLOYEE_NOT_FOUND') throw new ApiError(404, 'EMPLOYEE_NOT_FOUND');
      if (action !== 'CHECK' && result.status !== 'SUCCESS') throw new ApiError(409, 'EMPLOYEE_LIFECYCLE_CONFLICT');
      return result;
    });
  }
}
