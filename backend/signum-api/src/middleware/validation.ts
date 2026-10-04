import { z } from 'zod';
import type { RequestHandler } from 'express';
import { ApiError } from '../errors.js';

const text = z.string().trim().max(255).nullable().optional();
const date = z.iso.date().nullable().optional();
export const idSchema = z.uuid();
const employeeFields = z.object({
  nombre: z.string().trim().min(1).max(255), apellido: z.string().trim().min(1).max(255),
  clave_empleado: text, departamento: text, puesto: text, pin: z.string().trim().max(128).nullable().optional(),
  device_userid: z.string().trim().regex(/^\d+$/).max(32).nullable().optional(),
  tarjeta: text, sexo: z.enum(['M', 'F']).optional(), fecha_ingreso: date, fecha_cumpleanos: date,
}).strict();
export const createEmployeeSchema = employeeFields.extend({ activo: z.boolean().optional() });
export const importEmployeesSchema = z.object({ employees: z.array(createEmployeeSchema).min(1).max(1000) }).strict();
export const updateEmployeeSchema = employeeFields.partial().refine(input => Object.keys(input).length > 0);
const integer = (fallback: number, max: number, min: number) => z.preprocess(
  value => value === undefined ? fallback : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  z.number().int().min(min).max(max));
export const paginationSchema = z.object({ limit: integer(50, 100, 1), offset: integer(0, 1000000, 0) }).strict();
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ApiError(400, 'INVALID_INPUT');
  return result.data;
}
export const rejectTenantInput: RequestHandler = (req, _res, next) => {
  const keys = ['cliente_id', 'tenantId', 'tenant_id'];
  if (keys.some(key => key in req.query || req.get(key) !== undefined ||
    (typeof req.body === 'object' && req.body !== null && key in req.body))) throw new ApiError(400, 'TENANT_INPUT_FORBIDDEN');
  next();
};
