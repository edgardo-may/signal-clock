import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { hasActiveEmployeeSession } from '../services/employeeAuthService'
export default function EmployeeRoute({ children }) {
  const location = useLocation()
  const [verified, setVerified] = useState(null)
  useEffect(() => {
    let active = true
    hasActiveEmployeeSession().then(value => { if (active) setVerified(value) })
    return () => { active = false }
  }, [])
  if (verified === null) return <div className="min-h-screen flex items-center justify-center">Verificando sesión...</div>
  return verified ? children : <Navigate to="/employee-portal/login" state={{ from: location }} replace />
}
