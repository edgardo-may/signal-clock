/**
 * AppToaster.jsx — Instancia global de react-hot-toast v4
 * Signum-Clock · Jet Stream + Blue Whale palette
 * Posición: top-right, duración 4s
 */
import { Toaster } from 'react-hot-toast'

export default function AppToaster() {
  return (
    <Toaster
      position="top-right"
      containerStyle={{ top: 20, right: 20 }}
      toastOptions={{
        duration: 4000,
        style: {
          background:   '#FFFFFF',
          color:        '#0f172a',
          border:       '1px solid rgba(3,54,61,0.10)',
          borderRadius: '12px',
          fontSize:     '13px',
          fontWeight:   '500',
          boxShadow:    '0 4px 24px -4px rgba(3,54,61,0.14)',
          padding:      '12px 16px',
          maxWidth:     '380px',
        },
        success: {
          iconTheme: { primary: '#10b981', secondary: '#fff' },
          style: {
            borderLeft: '3px solid #10b981',
          },
        },
        error: {
          iconTheme: { primary: '#f43f5e', secondary: '#fff' },
          style: {
            borderLeft: '3px solid #f43f5e',
          },
        },
      }}
    />
  )
}





