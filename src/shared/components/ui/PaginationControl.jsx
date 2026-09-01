import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function PaginationControl({ 
  currentPage, 
  totalPages, 
  totalItems, 
  startIndex, 
  endIndex, 
  nextPage, 
  prevPage,
  itemName = 'registros'
}) {
  if (totalItems === 0) return null;

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-b-xl">
      <span className="text-xs text-slate-500 dark:text-slate-400">
        Mostrando del {startIndex + 1} al {endIndex} de {totalItems} {itemName}
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={prevPage}
          disabled={currentPage === 1}
          className="p-1.5 rounded-md border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/60 disabled:opacity-50 transition-colors"
          title="Página Anterior"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
          Página {currentPage} de {totalPages || 1}
        </span>
        <button
          onClick={nextPage}
          disabled={currentPage === totalPages || totalPages === 0}
          className="p-1.5 rounded-md border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/60 disabled:opacity-50 transition-colors"
          title="Página Siguiente"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
