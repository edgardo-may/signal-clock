import { Clock } from 'lucide-react'

export default function EmployeeMaintenancePage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[#f8f9f9] px-6 text-[#272c3d] dark:bg-[#0f172a] dark:text-slate-100">
      <section className="max-w-md text-center" role="status" aria-live="polite">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#03363D] text-white">
          <Clock className="h-7 w-7" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-bold">Portal del Empleado en mantenimiento</h1>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
          Estamos realizando una actualización. Intenta de nuevo más tarde.
        </p>
      </section>
    </main>
  )
}
