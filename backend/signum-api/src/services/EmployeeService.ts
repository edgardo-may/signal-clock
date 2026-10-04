import type { EmployeeRepository } from '../repositories/EmployeeRepository.js';
import type { TenantContext } from '../types/RequestContext.js';
import type { EmployeeInput, CreateEmployeeInput, EmployeeQuery, LifecycleAction } from '../domain/employees/Employee.js';
import { ApiError } from '../errors.js';

export class EmployeeService {
  constructor(private readonly repository: EmployeeRepository) {}
  capacity(context: TenantContext) { return this.repository.capacity(context); }
  listEmployees(context: TenantContext, query: EmployeeQuery) { return this.repository.findAll(context, query); }
  async getEmployee(context: TenantContext, id: string) {
    const employee = await this.repository.findById(context, id);
    if (!employee) throw new ApiError(404, 'EMPLOYEE_NOT_FOUND');
    return employee;
  }
  createEmployee(context: TenantContext, input: CreateEmployeeInput) { return this.repository.create(context, input); }
  importEmployees(context: TenantContext, inputs: CreateEmployeeInput[]) { return this.repository.createMany(context, inputs); }
  async updateEmployee(context: TenantContext, id: string, input: Partial<EmployeeInput>) {
    const employee = await this.repository.update(context, id, input);
    if (!employee) throw new ApiError(404, 'EMPLOYEE_NOT_FOUND');
    return employee;
  }
  // Existing database lifecycle remains authoritative for shifts, history and device side effects.
  lifecycle(context: TenantContext, id: string, action: LifecycleAction) { return this.repository.lifecycle(context, id, action); }
}
