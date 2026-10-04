import type { Config } from '../config/env.js';
import { createConnection } from './postgres/connection.js';
import { PostgresEmployeeRepository } from './postgres/repositories/PostgresEmployeeRepository.js';
import { PostgresTenantResolver } from './postgres/PostgresTenantResolver.js';

export function createDatabaseProvider(config: Config) {
  if (config.DB_PROVIDER !== 'postgres') throw new Error('SQL Server provider not implemented');
  const connection = createConnection(config);
  return {
    employees: new PostgresEmployeeRepository(connection),
    tenants: new PostgresTenantResolver(connection),
    verify: () => connection.verifyRls(),
    close: () => connection.pool.end(),
  };
}
