import express from 'express';
import type { AuthProvider } from './auth/AuthProvider.js';
import type { TenantResolver } from './auth/TenantResolver.js';
import type { EmployeeRepository } from './repositories/EmployeeRepository.js';
import { EmployeeService } from './services/EmployeeService.js';
import { EmployeeController } from './controllers/EmployeeController.js';
import { employeeRoutes } from './routes/employees.routes.js';
import { authenticate } from './middleware/auth.js';
import { resolveTenant } from './middleware/tenant.js';
import { rateLimit } from './middleware/rateLimit.js';
import { requestContext, jsonLog, type LogSink } from './middleware/requestContext.js';
import { errorHandler } from './middleware/errorHandler.js';

export interface AppDependencies {
  auth: AuthProvider; tenants: TenantResolver; employees: EmployeeRepository;
  log?: LogSink; rateMax?: number; rateWindowMs?: number; corsOrigin?: string;
}
export function createApp(deps: AppDependencies) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(requestContext(deps.log ?? jsonLog));
  app.get('/api/v1/health', (req, res) => {
    req.context.endpoint = '/api/v1/health';
    res.json({ status: 'ok' });
  });
  app.use('/api/v1', rateLimit({ max: deps.rateMax ?? 120, windowMs: deps.rateWindowMs ?? 60000 }));
  app.use((req, res, next) => {
    if (deps.corsOrigin && req.get('origin') === deps.corsOrigin) {
      res.setHeader('Access-Control-Allow-Origin', deps.corsOrigin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    }
    next();
  });
  app.use(express.json({ limit: '1mb', strict: true }));
  app.use('/api/v1/employees', (req, _res, next) => {
    req.context.endpoint = '/api/v1/employees';
    next();
  }, authenticate(deps.auth), resolveTenant(deps.tenants),
    employeeRoutes(new EmployeeController(new EmployeeService(deps.employees))));
  app.use((_req, res) => res.status(404).json({ error: 'NOT_FOUND' }));
  app.use(errorHandler);
  return app;
}
