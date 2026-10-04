import type { Request, Response } from 'express';
import { EmployeeService } from '../services/EmployeeService.js';
import { ApiError } from '../errors.js';
import type { LifecycleAction } from '../domain/employees/Employee.js';
import { createEmployeeSchema, importEmployeesSchema, updateEmployeeSchema, paginationSchema, idSchema, parse } from '../middleware/validation.js';

function context(req: Request) {
  if (!req.context.tenant) throw new ApiError(401, 'TOKEN_REQUIRED');
  return req.context.tenant;
}
export class EmployeeController {
  constructor(private readonly service: EmployeeService) {}
  capacity = async (req: Request, res: Response) => {
    const result = await this.service.capacity(context(req));
    req.context.metrics.rowsReturned = 1;
    res.json(result);
  };
  list = async (req: Request, res: Response) => {
    const result = await this.service.listEmployees(context(req), parse(paginationSchema, req.query));
    req.context.metrics.rowsReturned = result.data.length;
    res.json(result);
  };
  get = async (req: Request, res: Response) => {
    const result = await this.service.getEmployee(context(req), parse(idSchema, req.params.id));
    req.context.metrics.rowsReturned = 1;
    res.json(result);
  };
  create = async (req: Request, res: Response) => {
    const result = await this.service.createEmployee(context(req), parse(createEmployeeSchema, req.body));
    req.context.metrics.rowsReturned = 1;
    res.status(201).json(result);
  };
  update = async (req: Request, res: Response) => {
    const result = await this.service.updateEmployee(context(req), parse(idSchema, req.params.id), parse(updateEmployeeSchema, req.body));
    req.context.metrics.rowsReturned = 1;
    res.json(result);
  };
  import = async (req: Request, res: Response) => {
    const input = parse(importEmployeesSchema, req.body);
    const imported = await this.service.importEmployees(context(req), input.employees);
    res.status(201).json({ imported });
  };
  lifecycle = (action: LifecycleAction) => async (req: Request, res: Response) => {
    if (req.body && Object.keys(req.body).length) throw new ApiError(400, 'INVALID_INPUT');
    res.json(await this.service.lifecycle(context(req), parse(idSchema, req.params.id), action));
  };
}
