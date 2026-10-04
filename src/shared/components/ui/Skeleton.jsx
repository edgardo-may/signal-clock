// src/shared/components/ui/Skeleton.jsx
import React from 'react';

/**
 * Componente Skeleton elegante para estados de carga (loading placeholders).
 * 
 * @param {Object} props
 * @param {string} [props.className=""] - Clases adicionales de Tailwind
 * @param {'rounded' | 'circular' | 'text' | 'rectangular'} [props.variant="rounded"] - Forma del skeleton
 * @param {'pulse' | 'shimmer' | 'none'} [props.animation="shimmer"] - Tipo de animación
 * @param {string | number} [props.width] - Ancho opcional (ej: 120, "100%", "4rem")
 * @param {string | number} [props.height] - Alto opcional (ej: 16, "2rem")
 * @param {Object} [props.style] - Estilos inline adicionales
 */
export default function Skeleton({
  className = '',
  variant = 'rounded',
  animation = 'shimmer',
  width,
  height,
  style = {},
  children,
  ...props
}) {
  const variantClasses = {
    rounded: 'rounded-xl',
    circular: 'rounded-full aspect-square',
    text: 'rounded-md h-4 w-full',
    rectangular: 'rounded-none',
  };

  const isShimmer = animation === 'shimmer';
  const isPulse = animation === 'pulse';

  const inlineStyles = {
    ...(width !== undefined ? { width: typeof width === 'number' ? `${width}px` : width } : {}),
    ...(height !== undefined ? { height: typeof height === 'number' ? `${height}px` : height } : {}),
    ...style,
  };

  return (
    <div
      role="status"
      aria-label="Cargando..."
      className={`
        inline-block select-none pointer-events-none
        bg-slate-200/70 dark:bg-slate-800/70
        ${variantClasses[variant] || variantClasses.rounded}
        ${isPulse ? 'animate-pulse' : ''}
        ${isShimmer ? 'relative overflow-hidden' : ''}
        ${className}
      `}
      style={inlineStyles}
      {...props}
    >
      {isShimmer && (
        <span
          className="absolute inset-0 -translate-x-full pointer-events-none bg-gradient-to-r from-transparent via-white/50 dark:via-white/10 to-transparent"
          style={{
            animation: 'skeleton-shimmer 1.8s infinite',
          }}
        />
      )}
      {children}
      <style>{`
        @keyframes skeleton-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}

/**
 * Skeleton para múltiples líneas de texto
 */
export function SkeletonText({ lines = 3, className = '', lastLineWidth = '70%' }) {
  return (
    <div className={`space-y-2.5 w-full ${className}`} role="status">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          variant="text"
          className="h-3.5"
          style={{ width: i === lines - 1 ? lastLineWidth : '100%' }}
        />
      ))}
    </div>
  );
}

/**
 * Skeleton para avatares circulares
 */
export function SkeletonAvatar({ size = 40, className = '' }) {
  return (
    <Skeleton
      variant="circular"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
    />
  );
}

/**
 * Skeleton para tarjetas / KPIs
 */
export function SkeletonCard({ className = '' }) {
  return (
    <div className={`rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 space-y-4 shadow-sm ${className}`}>
      <div className="flex items-center justify-between">
        <Skeleton variant="text" className="h-4 w-28" />
        <Skeleton variant="circular" width={36} height={36} />
      </div>
      <Skeleton variant="rounded" className="h-8 w-20" />
      <Skeleton variant="text" className="h-3 w-36" />
    </div>
  );
}

/**
 * Skeleton para tablas de datos
 */
export function SkeletonTable({ rows = 5, cols = 4, className = '' }) {
  return (
    <div className={`w-full overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 ${className}`}>
      <div className="grid gap-4 p-4 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} variant="text" className="h-4" />
        ))}
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="grid gap-4 p-4 items-center" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={c} variant="text" className="h-3.5" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

Skeleton.Text = SkeletonText;
Skeleton.Avatar = SkeletonAvatar;
Skeleton.Card = SkeletonCard;
Skeleton.Table = SkeletonTable;
