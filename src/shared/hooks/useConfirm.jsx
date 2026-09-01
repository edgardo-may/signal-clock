/**
 * useConfirm.js — Hook para mostrar ConfirmDialog de forma imperativa
 *
 * Uso:
 *   const { confirmDialog, ConfirmDialogNode } = useConfirm()
 *
 *   // En el JSX del componente:
 *   {ConfirmDialogNode}
 *
 *   // En un handler:
 *   const ok = await confirmDialog({
 *     title: '¿Eliminar?',
 *     message: 'Esta acción no se puede deshacer.',
 *     variant: 'danger',
 *     confirmLabel: 'Sí, eliminar',
 *   })
 *   if (!ok) return
 *   // ... proceder con la acción
 */
import { useState, useCallback, useRef } from 'react'
import ConfirmDialog from '../components/ui/ConfirmDialog'

export function useConfirm() {
  const [state, setState] = useState({
    open:         false,
    title:        '¿Estás seguro?',
    message:      '',
    variant:      'danger',
    confirmLabel: 'Confirmar',
    cancelLabel:  'Cancelar',
    loading:      false,
  })

  // Ref para la Promise pendiente
  const resolveRef = useRef(null)

  /**
   * Abre el diálogo y retorna una Promise<boolean>:
   * - true  → el usuario hizo clic en Confirmar
   * - false → el usuario canceló / cerró
   */
  const confirmDialog = useCallback((options = {}) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve
      setState({
        open:         true,
        title:        options.title        ?? '¿Estás seguro?',
        message:      options.message      ?? 'Esta acción no se puede deshacer.',
        variant:      options.variant      ?? 'danger',
        confirmLabel: options.confirmLabel ?? 'Confirmar',
        cancelLabel:  options.cancelLabel  ?? 'Cancelar',
        loading:      false,
      })
    })
  }, [])

  const handleConfirm = useCallback(() => {
    resolveRef.current?.(true)
    setState(s => ({ ...s, open: false }))
  }, [])

  const handleCancel = useCallback(() => {
    resolveRef.current?.(false)
    setState(s => ({ ...s, open: false }))
  }, [])

  const ConfirmDialogNode = (
    <ConfirmDialog
      open={state.open}
      title={state.title}
      message={state.message}
      variant={state.variant}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      loading={state.loading}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  )

  return { confirmDialog, ConfirmDialogNode }
}





