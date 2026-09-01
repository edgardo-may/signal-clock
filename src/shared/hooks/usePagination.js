import { useState, useMemo, useEffect } from 'react';

export function usePagination(items, itemsPerPage = 5, dependencies = []) {
  const [currentPage, setCurrentPage] = useState(1);

  // Resetea a la primera página si cambian los filtros
  useEffect(() => {
    setCurrentPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  const totalPages = Math.ceil(items.length / itemsPerPage);
  
  const paginatedItems = useMemo(() => {
    return items.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  }, [items, currentPage, itemsPerPage]);

  const goToPage = (page) => {
    const pageNumber = Math.max(1, Math.min(page, totalPages));
    setCurrentPage(pageNumber);
  };

  const nextPage = () => goToPage(currentPage + 1);
  const prevPage = () => goToPage(currentPage - 1);

  return {
    currentPage,
    totalPages,
    paginatedItems,
    totalItems: items.length,
    startIndex: (currentPage - 1) * itemsPerPage,
    endIndex: Math.min(currentPage * itemsPerPage, items.length),
    goToPage,
    nextPage,
    prevPage,
    setCurrentPage,
  };
}
