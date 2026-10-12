import EmployeeMaintenancePage from '../pages/EmployeeMaintenancePage'
import { isEmployeePortalMaintenanceEnabled } from '../employeePortalMaintenance'

const maintenanceEnabled = isEmployeePortalMaintenanceEnabled(
  import.meta.env.VITE_EMPLOYEE_PORTAL_MAINTENANCE,
)

export default function EmployeePortalGate({ children }) {
  return maintenanceEnabled ? <EmployeeMaintenancePage /> : children
}
