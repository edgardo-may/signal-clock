import { Router, type RequestHandler } from 'express';
import { EmployeeController } from '../controllers/EmployeeController.js';
import { employeeWriteRole } from '../middleware/roles.js';
import { rejectTenantInput } from '../middleware/validation.js';

export function employeeRoutes(controller: EmployeeController) {
  const router = Router();
  router.use(rejectTenantInput);
  const endpoint: RequestHandler = (req, _res, next) => {
    req.context.endpoint = `/api/v1/employees${req.route.path === '/' ? '' : req.route.path}`;
    next();
  };
  router.get('/', endpoint, controller.list);
  router.get('/capacity', endpoint, controller.capacity);
  router.get('/:id', endpoint, controller.get);
  router.post('/', endpoint, employeeWriteRole, controller.create);
  router.post('/import', endpoint, employeeWriteRole, controller.import);
  router.patch('/:id', endpoint, employeeWriteRole, controller.update);
  router.post('/:id/lifecycle-check', endpoint, controller.lifecycle('CHECK'));
  router.post('/:id/deactivate', endpoint, employeeWriteRole, controller.lifecycle('DEACTIVATE'));
  router.post('/:id/reactivate', endpoint, employeeWriteRole, controller.lifecycle('ACTIVATE'));
  router.delete('/:id', endpoint, employeeWriteRole, controller.lifecycle('DELETE'));
  return router;
}
