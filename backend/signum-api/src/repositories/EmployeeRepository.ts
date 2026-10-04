import type { TenantContext } from '../types/RequestContext.js';
import type { Employee, EmployeeInput, CreateEmployeeInput, EmployeeCapacity, EmployeePage, EmployeeQuery, LifecycleAction, LifecycleResult } from '../domain/employees/Employee.js';

export interface EmployeeRepository {
  capacity(context: TenantContext): Promise<EmployeeCapacity>;
  findAll(context: TenantContext, query: EmployeeQuery): Promise<EmployeePage>;
  findById(context: TenantContext, id: string): Promise<Employee | null>;
  create(context: TenantContext, input: CreateEmployeeInput): Promise<Employee>;
  createMany(context: TenantContext, inputs: CreateEmployeeInput[]): Promise<number>;
  update(context: TenantContext, id: string, input: Partial<EmployeeInput>): Promise<Employee | null>;
  lifecycle(context: TenantContext, id: string, action: LifecycleAction): Promise<LifecycleResult>;
}
