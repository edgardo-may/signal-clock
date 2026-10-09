export default function CatalogIdentifier({ folio }) {
  if (folio == null) return null
  return (
    <div className="mt-1">
      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
        ID: <span className="font-mono">{folio}</span>
      </p>
    </div>
  )
}
