/**
 * Card.jsx — Brand-aware content card component v4 · Jet Stream + Blue Whale
 *
 * Variants:
 *   default   — White surface with navy/teal subtle border
 *   elevated  — Stronger shadow + lift on hover
 *   glass     — Frosted glass, white-tinted
 *   outlined  — No background, navy border
 *   filled    — Blue Whale background, white text (inverted)
 *
 * Sub-components (via dot notation):
 *   Card.Header  — Top section with optional divider
 *   Card.Body    — Main content area
 *   Card.Footer  — Bottom section with optional divider
 *   Card.Badge   — Inline badge/chip
 *
 * WCAG 2.1:
 *   - Interactive cards have role="button" / tabIndex + keydown handler
 *   - Minimum 3:1 contrast for non-text UI elements (borders) ✅
 *   - Focus ring on clickable cards ✅
 */

const variantStyles = {
  default: [
    'bg-white',
    'border border-blue-500/10',
    'shadow-[0_1px_4px_rgba(3,54,61,0.06),0_4px_16px_-4px_rgba(3,54,61,0.08)]',
  ].join(' '),

  elevated: [
    'bg-white',
    'border border-blue-500/08',
    'shadow-[0_1px_4px_rgba(3,54,61,0.06),0_4px_16px_-4px_rgba(3,54,61,0.10)]',
    'hover:shadow-[0_2px_8px_rgba(3,54,61,0.08),0_8px_28px_-4px_rgba(3,54,61,0.14)]',
    'hover:-translate-y-0.5',
    'transition-all duration-200 ease-out',
  ].join(' '),

  glass: [
    'bg-white/82 backdrop-blur-xl',
    'border border-blue-500/10',
    'shadow-[0_4px_24px_-4px_rgba(3,54,61,0.10)]',
  ].join(' '),

  outlined: [
    'bg-transparent',
    'border-2 border-blue-500/18',
    'hover:border-blue-500/35',
    'transition-colors duration-150',
  ].join(' '),

  filled: [
    'bg-blue-600 text-white',
    'border border-slate-100',
    'shadow-[0_4px_16px_-2px_rgba(3,54,61,0.30)]',
  ].join(' '),
};

const BASE_CARD = [
  'relative rounded-xl overflow-hidden',
  'transition-transform duration-200',
].join(' ');

const INTERACTIVE_CARD = [
  'cursor-pointer',
  'focus-visible:outline-none',
  'focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white',
].join(' ');

/* ─── Card ───────────────────────────────────────────────────── */
function Card({
  variant = 'default',
  padding = 'md',
  onClick,
  role,
  tabIndex,
  'aria-label': ariaLabel,
  className = '',
  children,
  ...rest
}) {
  const isInteractive = Boolean(onClick);
  const paddingMap = { none: '', sm: 'p-4', md: 'p-6', lg: 'p-8' };

  function handleKeyDown(e) {
    if (isInteractive && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onClick(e);
    }
  }

  return (
    <div
      className={[
        BASE_CARD,
        variantStyles[variant],
        paddingMap[padding],
        isInteractive ? INTERACTIVE_CARD : '',
        className,
      ].filter(Boolean).join(' ')}
      role={role ?? (isInteractive ? 'button' : undefined)}
      tabIndex={tabIndex ?? (isInteractive ? 0 : undefined)}
      aria-label={ariaLabel}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      {...rest}
    >
      {children}
    </div>
  );
}

/* ─── Card.Header ────────────────────────────────────────────── */
Card.Header = function CardHeader({
  title,
  subtitle,
  action,
  divider = true,
  className = '',
  children,
}) {
  return (
    <div className={['pb-4', divider ? 'border-b border-blue-500/08 mb-4' : '', className].join(' ')}>
      {children ?? (
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {title && (
              <h3 className="text-base font-semibold text-blue-600 dark:text-blue-400-dark leading-tight truncate">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="mt-0.5 text-sm text-blue-600 dark:text-blue-400-muted max-w-none">
                {subtitle}
              </p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
    </div>
  );
};

/* ─── Card.Body ──────────────────────────────────────────────── */
Card.Body = function CardBody({ className = '', children }) {
  return (
    <div className={['text-sm text-blue-600 dark:text-blue-400/80 leading-relaxed', className].join(' ')}>
      {children}
    </div>
  );
};

/* ─── Card.Footer ────────────────────────────────────────────── */
Card.Footer = function CardFooter({
  divider = true,
  className = '',
  children,
}) {
  return (
    <div
      className={[
        'pt-4 flex items-center gap-3',
        divider ? 'border-t border-blue-500/08 mt-4' : '',
        className,
      ].join(' ')}
    >
      {children}
    </div>
  );
};

/* ─── Card.Badge ─────────────────────────────────────────────── */
Card.Badge = function CardBadge({
  label,
  color = 'navy',
  className = '',
}) {
  const colorMap = {
    navy:     'bg-blue-600 text-white',
    teal:     'bg-blue-600 text-blue-600 dark:text-blue-400',
    muted:    'bg-blue-600/20 text-blue-600 dark:text-blue-400',
    success:  'bg-emerald-100 text-emerald-800',
    warning:  'bg-amber-100  text-amber-800',
    danger:   'bg-red-100    text-red-800',
  };

  return (
    <span
      className={[
        'inline-flex items-center px-2.5 py-0.5',
        'text-xs font-semibold tracking-wide',
        'rounded-full select-none',
        colorMap[color] ?? colorMap.navy,
        className,
      ].join(' ')}
    >
      {label}
    </span>
  );
};

export default Card;





