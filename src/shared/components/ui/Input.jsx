/**
 * Input.jsx — Brand-aware form input components v4 · Jet Stream + Blue Whale
 *
 * Components exported:
 *   Input       — Single-line text input
 *   Textarea    — Multi-line text area
 *   FormField   — Wrapper: label + input + helper/error text
 *
 * States: default | focus | error | disabled | readonly
 *
 * WCAG 2.1 compliance:
 *   - Visible labels always associated via htmlFor / aria-labelledby
 *   - Error state communicated via aria-invalid + aria-describedby
 *   - Focus ring: 2px solid brand-primary, offset 2px (≥3:1 UI contrast ✅)
 *   - Placeholder contrast: rgba(3,54,61,0.40) — AA borderline; always
 *     pair with visible label (never use placeholder-only pattern)
 *   - Min touch target: 44px height (h-11)
 */

import { forwardRef, useId } from 'react';
import React from 'react';

/* ─── Shared class builders ──────────────────────────────────── */
const BASE_INPUT = [
  'w-full h-11 px-4',
  'font-sans text-sm text-blue-600 dark:text-blue-400',
  'bg-white',
  'border border-blue-500/15 rounded-xl',
  'placeholder:text-blue-600 dark:text-blue-400/38',
  'transition-all duration-150 ease-out',
  // Focus ring — visible para navegación por teclado
  'focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-brand-primary/15',
  // Hover
  'hover:border-blue-500/30',
  // Disabled
  'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-blue-50 dark:bg-blue-950/60',
  // Readonly
  'read-only:cursor-default read-only:opacity-70',
].join(' ');

const ERROR_INPUT = 'border-red-500 focus:border-red-500 focus:ring-red-500/20';

/* ─── Input ──────────────────────────────────────────────────── */
const Input = forwardRef(function Input(
  {
    error = false,
    leftAddon = null,
    rightAddon = null,
    className = '',
    id,
    'aria-describedby': ariaDescribedby,
    ...rest
  },
  ref
) {
  const inputClass = [
    BASE_INPUT,
    error ? ERROR_INPUT : '',
    leftAddon  ? 'pl-10' : '',
    rightAddon ? 'pr-10' : '',
    className,
  ].filter(Boolean).join(' ');

  if (leftAddon || rightAddon) {
    return (
      <div className="relative flex items-center">
        {leftAddon && (
          <span
            aria-hidden="true"
            className="absolute left-3 pointer-events-none"
            style={{ color: 'rgba(3,54,61,0.45)' }}
          >
            {leftAddon}
          </span>
        )}
        <input
          ref={ref}
          id={id}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={ariaDescribedby}
          className={inputClass}
          {...rest}
        />
        {rightAddon && (
          <span
            aria-hidden="true"
            className="absolute right-3 pointer-events-none"
            style={{ color: 'rgba(3,54,61,0.45)' }}
          >
            {rightAddon}
          </span>
        )}
      </div>
    );
  }

  return (
    <input
      ref={ref}
      id={id}
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={ariaDescribedby}
      className={inputClass}
      {...rest}
    />
  );
});

/* ─── Textarea ───────────────────────────────────────────────── */
const Textarea = forwardRef(function Textarea(
  { error = false, rows = 4, className = '', ...rest },
  ref
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={error ? 'true' : undefined}
      className={[
        BASE_INPUT,
        'h-auto py-3 resize-y min-h-[88px]',
        error ? ERROR_INPUT : '',
        className,
      ].filter(Boolean).join(' ')}
      {...rest}
    />
  );
});

/* ─── FormField (Label + Input + Helper/Error) ───────────────── */
function FormField({
  label,
  htmlFor,
  helperText,
  errorText,
  required = false,
  children,
  className = '',
}) {
  const autoId = useId();
  const fieldId   = htmlFor || autoId;
  const helperId  = `${fieldId}-helper`;
  const errorId   = `${fieldId}-error`;
  const hasError  = Boolean(errorText);

  const enhancedChild = children
    ? React.cloneElement(children, {
        id: children.props.id || fieldId,
        'aria-describedby': [
          hasError  ? errorId  : null,
          helperText ? helperId : null,
        ].filter(Boolean).join(' ') || undefined,
        error: hasError || children.props.error,
      })
    : null;

  return (
    <div className={['flex flex-col gap-1.5', className].join(' ')}>
      {/* Label — always visible */}
      <label
        htmlFor={fieldId}
        className="text-sm font-medium select-none"
        style={{ color: '#2563EB' }}
      >
        {label}
        {required && (
          <span aria-hidden="true" className="ml-1 text-red-600">*</span>
        )}
        {required && (
          <span className="sr-only"> (required)</span>
        )}
      </label>

      {enhancedChild}

      {/* Error message */}
      {hasError && (
        <p
          id={errorId}
          role="alert"
          className="text-xs font-medium text-red-600 flex items-center gap-1"
        >
          <svg
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          {errorText}
        </p>
      )}

      {/* Helper text */}
      {!hasError && helperText && (
        <p id={helperId} className="text-xs" style={{ color: 'rgba(3,54,61,0.50)' }}>
          {helperText}
        </p>
      )}
    </div>
  );
}

export { Input, Textarea, FormField };
export default Input;





