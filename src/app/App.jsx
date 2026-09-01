import { AuthProvider } from './providers/AuthProvider'
import { AppRouter } from './router'
import AppToaster from '../shared/components/ui/AppToaster'

export default function App() {
  return (
    <AuthProvider>
      {/* Toaster global — cubre todas las rutas */}
      <AppToaster />
      <AppRouter />
    </AuthProvider>
  )
}





