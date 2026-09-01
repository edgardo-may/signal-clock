/**
 * Lucide Animated Icons — Dashboard
 * Fuente: https://lucide-animated.com/
 * Componentes oficiales del registry adaptados a JSX para este proyecto.
 * Dependencia requerida: motion (instalada)
 *
 * Iconos incluidos:
 *   ActivityIcon, UsersIcon, CpuIcon, ClockIcon (como ClockAnimIcon),
 *   TrendingUpIcon, MapPinIcon, FingerprintIcon, ScanFaceIcon,
 *   CreditCardIcon, ArrowUpIcon, ArrowDownIcon
 *
 * Nota sobre `size`: el tamaño se controla EXTERNAMENTE vía className ("w-6 h-6", etc.)
 * en lugar de la prop size del original, para mantener consistencia con el resto del proyecto.
 * La prop `size` sigue siendo compatible para uso explícito.
 */

import { motion, useAnimation } from 'motion/react'
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react'

/* ─── Util mínimo: cn (evita importar @/lib/utils) ─────────────── */
function cn(...args) {
  return args.filter(Boolean).join(' ')
}

/* ══════════════════════════════════════════════════════════════════
   ActivityIcon
   Fuente: https://lucide-animated.com/r/activity.json
══════════════════════════════════════════════════════════════════ */
const ACTIVITY_VARIANTS = {
  normal: {
    opacity: 1,
    pathLength: 1,
    pathOffset: 0,
    transition: { duration: 0.4, opacity: { duration: 0.1 } },
  },
  animate: {
    opacity: [0, 1],
    pathLength: [0, 1],
    pathOffset: [1, 0],
    transition: { duration: 0.6, ease: 'linear', opacity: { duration: 0.1 } },
  },
}

const ActivityIcon = forwardRef(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation()
    const isControlledRef = useRef(false)

    useImperativeHandle(ref, () => {
      isControlledRef.current = true
      return {
        startAnimation: () => controls.start('animate'),
        stopAnimation:  () => controls.start('normal'),
      }
    })

    const handleMouseEnter = useCallback((e) => {
      if (isControlledRef.current) { onMouseEnter?.(e) } else { controls.start('animate') }
    }, [controls, onMouseEnter])

    const handleMouseLeave = useCallback((e) => {
      if (isControlledRef.current) { onMouseLeave?.(e) } else { controls.start('normal') }
    }, [controls, onMouseLeave])

    return (
      <div className={cn(className)} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} {...props}>
        <svg fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
          <motion.path animate={controls} d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" initial="normal" variants={ACTIVITY_VARIANTS} />
        </svg>
      </div>
    )
  }
)
ActivityIcon.displayName = 'ActivityIcon'

/* ══════════════════════════════════════════════════════════════════
   UsersIcon
   Fuente: https://lucide-animated.com/r/users.json
══════════════════════════════════════════════════════════════════ */
const USERS_PATH_VARIANTS = {
  normal: { translateX: 0, transition: { type: 'spring', stiffness: 200, damping: 13 } },
  animate: { translateX: [-6, 0], transition: { delay: 0.1, type: 'spring', stiffness: 200, damping: 13 } },
}

const UsersIcon = forwardRef(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation()
    const isControlledRef = useRef(false)

    useImperativeHandle(ref, () => {
      isControlledRef.current = true
      return {
        startAnimation: () => controls.start('animate'),
        stopAnimation:  () => controls.start('normal'),
      }
    })

    const handleMouseEnter = useCallback((e) => {
      if (isControlledRef.current) { onMouseEnter?.(e) } else { controls.start('animate') }
    }, [controls, onMouseEnter])

    const handleMouseLeave = useCallback((e) => {
      if (isControlledRef.current) { onMouseLeave?.(e) } else { controls.start('normal') }
    }, [controls, onMouseLeave])

    return (
      <div className={cn(className)} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} {...props}>
        <svg fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <motion.path animate={controls} d="M22 21v-2a4 4 0 0 0-3-3.87" variants={USERS_PATH_VARIANTS} />
          <motion.path animate={controls} d="M16 3.13a4 4 0 0 1 0 7.75" variants={USERS_PATH_VARIANTS} />
        </svg>
      </div>
    )
  }
)
UsersIcon.displayName = 'UsersIcon'

/* ══════════════════════════════════════════════════════════════════
   CpuIcon
   Fuente: https://lucide-animated.com/r/cpu.json
══════════════════════════════════════════════════════════════════ */
const CPU_TRANSITION = { duration: 0.5, ease: 'easeInOut', repeat: 1 }
const CPU_Y_VARIANTS = {
  normal: { scale: 1, rotate: 0, opacity: 1 },
  animate: { scaleY: [1, 1.5, 1], opacity: [1, 0.8, 1] },
}
const CPU_X_VARIANTS = {
  normal: { scale: 1, rotate: 0, opacity: 1 },
  animate: { scaleX: [1, 1.5, 1], opacity: [1, 0.8, 1] },
}

const CpuIcon = forwardRef(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation()
    const isControlledRef = useRef(false)

    useImperativeHandle(ref, () => {
      isControlledRef.current = true
      return {
        startAnimation: () => controls.start('animate'),
        stopAnimation:  () => controls.start('normal'),
      }
    })

    const handleMouseEnter = useCallback((e) => {
      if (isControlledRef.current) { onMouseEnter?.(e) } else { controls.start('animate') }
    }, [controls, onMouseEnter])

    const handleMouseLeave = useCallback((e) => {
      if (isControlledRef.current) { onMouseLeave?.(e) } else { controls.start('normal') }
    }, [controls, onMouseLeave])

    return (
      <div className={cn(className)} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} {...props}>
        <svg fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
          <rect height="16" rx="2" width="16" x="4" y="4" />
          <rect height="6" rx="1" width="6" x="9" y="9" />
          <motion.path animate={controls} d="M15 2v2" transition={CPU_TRANSITION} variants={CPU_Y_VARIANTS} />
          <motion.path animate={controls} d="M15 20v2" transition={CPU_TRANSITION} variants={CPU_Y_VARIANTS} />
          <motion.path animate={controls} d="M2 15h2" transition={CPU_TRANSITION} variants={CPU_X_VARIANTS} />
          <motion.path animate={controls} d="M2 9h2" transition={CPU_TRANSITION} variants={CPU_X_VARIANTS} />
          <motion.path animate={controls} d="M20 15h2" transition={CPU_TRANSITION} variants={CPU_X_VARIANTS} />
          <motion.path animate={controls} d="M20 9h2" transition={CPU_TRANSITION} variants={CPU_X_VARIANTS} />
          <motion.path animate={controls} d="M9 2v2" transition={CPU_TRANSITION} variants={CPU_Y_VARIANTS} />
          <motion.path animate={controls} d="M9 20v2" transition={CPU_TRANSITION} variants={CPU_Y_VARIANTS} />
        </svg>
      </div>
    )
  }
)
CpuIcon.displayName = 'CpuIcon'

/* ══════════════════════════════════════════════════════════════════
   ClockAnimIcon  (nombre diferenciado del Clock de lucide-react)
   Fuente: https://lucide-animated.com/r/clock.json
══════════════════════════════════════════════════════════════════ */
const CLOCK_HAND_TRANSITION = { duration: 0.6, ease: [0.4, 0, 0.2, 1] }
const CLOCK_HAND_VARIANTS = {
  normal: { rotate: 0, originX: '0%', originY: '100%' },
  animate: { rotate: 360, originX: '0%', originY: '100%' },
}
const CLOCK_MINUTE_TRANSITION = { duration: 0.5, ease: 'easeInOut' }
const CLOCK_MINUTE_VARIANTS = {
  normal: { rotate: 0, originX: '0%', originY: '100%' },
  animate: { rotate: 45, originX: '0%', originY: '100%' },
}

const ClockAnimIcon = forwardRef(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation()
    const isControlledRef = useRef(false)

    useImperativeHandle(ref, () => {
      isControlledRef.current = true
      return {
        startAnimation: () => controls.start('animate'),
        stopAnimation:  () => controls.start('normal'),
      }
    })

    const handleMouseEnter = useCallback((e) => {
      if (isControlledRef.current) { onMouseEnter?.(e) } else { controls.start('animate') }
    }, [controls, onMouseEnter])

    const handleMouseLeave = useCallback((e) => {
      if (isControlledRef.current) { onMouseLeave?.(e) } else { controls.start('normal') }
    }, [controls, onMouseLeave])

    return (
      <div className={cn(className)} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} {...props}>
        <svg fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="10" />
          <motion.line animate={controls} initial="normal" transition={CLOCK_HAND_TRANSITION} variants={CLOCK_HAND_VARIANTS} x1="12" x2="12" y1="12" y2="6" />
          <motion.line animate={controls} initial="normal" transition={CLOCK_MINUTE_TRANSITION} variants={CLOCK_MINUTE_VARIANTS} x1="12" x2="16" y1="12" y2="12" />
        </svg>
      </div>
    )
  }
)
ClockAnimIcon.displayName = 'ClockAnimIcon'

/* ══════════════════════════════════════════════════════════════════
   TrendingUpIcon
   Fuente: https://lucide-animated.com/r/trending-up.json
══════════════════════════════════════════════════════════════════ */
const TU_SVG_VARIANTS = {
  animate: { translateX: [0, 2, 0], translateY: [0, -2, 0], transition: { duration: 0.5 } },
}
const TU_PATH_VARIANTS = {
  normal: { opacity: 1, pathLength: 1, transition: { duration: 0.4, opacity: { duration: 0.1 } } },
  animate: { opacity: [0, 1], pathLength: [0, 1], pathOffset: [1, 0], transition: { duration: 0.4, opacity: { duration: 0.1 } } },
}
const TU_ARROW_VARIANTS = {
  normal: { opacity: 1, pathLength: 1, transition: { delay: 0.3, duration: 0.3, opacity: { duration: 0.1, delay: 0.3 } } },
  animate: { opacity: [0, 1], pathLength: [0, 1], pathOffset: [0.5, 0], transition: { delay: 0.3, duration: 0.3, opacity: { duration: 0.1, delay: 0.3 } } },
}

const TrendingUpIcon = forwardRef(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation()
    const isControlledRef = useRef(false)

    useImperativeHandle(ref, () => {
      isControlledRef.current = true
      return {
        startAnimation: () => controls.start('animate'),
        stopAnimation:  () => controls.start('normal'),
      }
    })

    const handleMouseEnter = useCallback((e) => {
      if (isControlledRef.current) { onMouseEnter?.(e) } else { controls.start('animate') }
    }, [controls, onMouseEnter])

    const handleMouseLeave = useCallback((e) => {
      if (isControlledRef.current) { onMouseLeave?.(e) } else { controls.start('normal') }
    }, [controls, onMouseLeave])

    return (
      <div className={cn(className)} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} {...props}>
        <motion.svg animate={controls} fill="none" height={size} initial="normal" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" variants={TU_SVG_VARIANTS} viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
          <motion.polyline animate={controls} initial="normal" points="22 7 13.5 15.5 8.5 10.5 2 17" variants={TU_PATH_VARIANTS} />
          <motion.polyline animate={controls} initial="normal" points="16 7 22 7 22 13" variants={TU_ARROW_VARIANTS} />
        </motion.svg>
      </div>
    )
  }
)
TrendingUpIcon.displayName = 'TrendingUpIcon'

/* ══════════════════════════════════════════════════════════════════
   MapPinIcon
   Fuente: https://lucide-animated.com/r/map-pin.json
══════════════════════════════════════════════════════════════════ */
const MP_SVG_VARIANTS = {
  normal: { y: 0 },
  animate: { y: [0, -5, -3], transition: { duration: 0.5, times: [0, 0.6, 1] } },
}
const MP_CIRCLE_VARIANTS = {
  normal: { opacity: 1 },
  animate: { opacity: [0, 1], pathLength: [0, 1], pathOffset: [0.5, 0], transition: { delay: 0.3, duration: 0.5, opacity: { duration: 0.1, delay: 0.3 } } },
}

const MapPinIcon = forwardRef(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation()
    const isControlledRef = useRef(false)

    useImperativeHandle(ref, () => {
      isControlledRef.current = true
      return {
        startAnimation: () => controls.start('animate'),
        stopAnimation:  () => controls.start('normal'),
      }
    })

    const handleMouseEnter = useCallback((e) => {
      if (isControlledRef.current) { onMouseEnter?.(e) } else { controls.start('animate') }
    }, [controls, onMouseEnter])

    const handleMouseLeave = useCallback((e) => {
      if (isControlledRef.current) { onMouseLeave?.(e) } else { controls.start('normal') }
    }, [controls, onMouseLeave])

    return (
      <div className={cn(className)} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} {...props}>
        <motion.svg animate={controls} fill="none" height={size} initial="normal" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" variants={MP_SVG_VARIANTS} viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
          <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
          <motion.circle animate={controls} cx="12" cy="10" initial="normal" r="3" variants={MP_CIRCLE_VARIANTS} />
        </motion.svg>
      </div>
    )
  }
)
MapPinIcon.displayName = 'MapPinIcon'

/* ══════════════════════════════════════════════════════════════════
   FingerprintIcon
   Fuente: https://lucide-animated.com/r/fingerprint.json
══════════════════════════════════════════════════════════════════ */
const FP_VARIANTS = {
  normal: { pathLength: 1, opacity: 1 },
  animate: {
    opacity: [0, 0, 1, 1, 1],
    pathLength: [0.1, 0.3, 0.5, 0.7, 0.9, 1],
    transition: { opacity: { duration: 0.5 }, pathLength: { duration: 2 } },
  },
}

const FingerprintIcon = forwardRef(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation()
    const isControlledRef = useRef(false)

    useImperativeHandle(ref, () => {
      isControlledRef.current = true
      return {
        startAnimation: () => controls.start('animate'),
        stopAnimation:  () => controls.start('normal'),
      }
    })

    const handleMouseEnter = useCallback((e) => {
      if (isControlledRef.current) { onMouseEnter?.(e) } else { controls.start('animate') }
    }, [controls, onMouseEnter])

    const handleMouseLeave = useCallback((e) => {
      if (isControlledRef.current) { onMouseLeave?.(e) } else { controls.start('normal') }
    }, [controls, onMouseLeave])

    return (
      <div className={cn(className)} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} {...props}>
        <svg fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
          <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" fill="none" strokeOpacity={0.4} strokeWidth="2" />
          <motion.path animate={controls} d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" variants={FP_VARIANTS} />
          <path d="M14 13.12c0 2.38 0 6.38-1 8.88" fill="none" strokeOpacity={0.4} strokeWidth="2" />
          <motion.path animate={controls} d="M14 13.12c0 2.38 0 6.38-1 8.88" variants={FP_VARIANTS} />
          <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" fill="none" strokeOpacity={0.4} strokeWidth="2" />
          <motion.path animate={controls} d="M17.29 21.02c.12-.6.43-2.3.5-3.02" variants={FP_VARIANTS} />
          <path d="M2 12a10 10 0 0 1 18-6" fill="none" strokeOpacity={0.4} strokeWidth="2" />
          <motion.path animate={controls} d="M2 12a10 10 0 0 1 18-6" variants={FP_VARIANTS} />
          <path d="M2 16h.01" fill="none" strokeOpacity={0.4} strokeWidth="2" />
          <motion.path animate={controls} d="M2 16h.01" variants={FP_VARIANTS} />
          <path d="M21.8 16c.2-2 .131-5.354 0-6" fill="none" strokeOpacity={0.4} strokeWidth="2" />
          <motion.path animate={controls} d="M21.8 16c.2-2 .131-5.354 0-6" variants={FP_VARIANTS} />
          <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" fill="none" strokeOpacity={0.4} strokeWidth="2" />
          <motion.path animate={controls} d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" variants={FP_VARIANTS} />
          <path d="M8.65 22c.21-.66.45-1.32.57-2" fill="none" strokeOpacity={0.4} strokeWidth="2" />
          <motion.path animate={controls} d="M8.65 22c.21-.66.45-1.32.57-2" variants={FP_VARIANTS} />
          <path d="M9 6.8a6 6 0 0 1 9 5.2v2" fill="none" strokeOpacity={0.4} strokeWidth="2" />
          <motion.path animate={controls} d="M9 6.8a6 6 0 0 1 9 5.2v2" variants={FP_VARIANTS} />
        </svg>
      </div>
    )
  }
)
FingerprintIcon.displayName = 'FingerprintIcon'

/* ══════════════════════════════════════════════════════════════════
   ScanFaceIcon
   Fuente: https://lucide-animated.com/r/scan-face.json
══════════════════════════════════════════════════════════════════ */
const ScanFaceIcon = forwardRef(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation()
    const isControlledRef = useRef(false)

    useImperativeHandle(ref, () => {
      isControlledRef.current = true
      return {
        startAnimation: async () => { await controls.start('hidden'); await controls.start('visible') },
        stopAnimation: () => controls.start('visible'),
      }
    })

    const handleMouseEnter = useCallback(async (e) => {
      if (isControlledRef.current) { onMouseEnter?.(e) } else { await controls.start('hidden'); await controls.start('visible') }
    }, [controls, onMouseEnter])

    const handleMouseLeave = useCallback((e) => {
      if (isControlledRef.current) { onMouseLeave?.(e) } else { controls.start('visible') }
    }, [controls, onMouseLeave])

    const faceVariants = {
      visible: { scale: 1 },
      hidden: { scale: 0.9, transition: { type: 'spring', stiffness: 200, damping: 20 } },
    }
    const cornerVariants = {
      visible: { scale: 1, rotate: 0, opacity: 1 },
      hidden: { scale: 1.2, rotate: 45, opacity: 0, transition: { type: 'spring', stiffness: 200, damping: 20 } },
    }
    const mouthVariants = {
      visible: { scale: 1, opacity: 1 },
      hidden: { scale: 0.8, opacity: 0, transition: { duration: 0.3, delay: 0.1 } },
    }

    return (
      <div className={cn(className)} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} {...props}>
        <motion.svg animate={controls} fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" variants={faceVariants} viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
          <motion.path animate={controls} d="M3 7V5a2 2 0 0 1 2-2h2" initial="visible" variants={cornerVariants} />
          <motion.path animate={controls} d="M17 3h2a2 2 0 0 1 2 2v2" initial="visible" variants={cornerVariants} />
          <motion.path animate={controls} d="M21 17v2a2 2 0 0 1-2 2h-2" initial="visible" variants={cornerVariants} />
          <motion.path animate={controls} d="M7 21H5a2 2 0 0 1-2-2v-2" initial="visible" variants={cornerVariants} />
          <motion.path animate={controls} d="M8 14s1.5 2 4 2 4-2 4-2" initial="visible" variants={mouthVariants} />
          <line x1="9" x2="9.01" y1="9" y2="9" />
          <line x1="15" x2="15.01" y1="9" y2="9" />
        </motion.svg>
      </div>
    )
  }
)
ScanFaceIcon.displayName = 'ScanFaceIcon'

/* ══════════════════════════════════════════════════════════════════
   CreditCardIcon
   Fuente: https://lucide-animated.com/r/credit-card.json
══════════════════════════════════════════════════════════════════ */
const CC_VARIANTS = {
  normal: { x: 0, transition: { type: 'spring', stiffness: 280, damping: 18 } },
  animate: { x: [0, -4, 1.5, 0], transition: { duration: 0.7, times: [0, 0.4, 0.75, 1], ease: 'easeInOut' } },
}

const CreditCardIcon = forwardRef(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation()
    const isControlledRef = useRef(false)

    useImperativeHandle(ref, () => {
      isControlledRef.current = true
      return {
        startAnimation: () => controls.start('animate'),
        stopAnimation:  () => controls.start('normal'),
      }
    })

    const handleMouseEnter = useCallback((e) => {
      if (isControlledRef.current) { onMouseEnter?.(e) } else { controls.start('animate') }
    }, [controls, onMouseEnter])

    const handleMouseLeave = useCallback((e) => {
      if (isControlledRef.current) { onMouseLeave?.(e) } else { controls.start('normal') }
    }, [controls, onMouseLeave])

    return (
      <div className={cn(className)} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} {...props}>
        <svg className="overflow-visible" fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
          <motion.g animate={controls} initial="normal" variants={CC_VARIANTS}>
            <rect height="14" rx="2" width="20" x="2" y="5" />
            <line x1="2" x2="22" y1="10" y2="10" />
          </motion.g>
        </svg>
      </div>
    )
  }
)
CreditCardIcon.displayName = 'CreditCardIcon'

/* ══════════════════════════════════════════════════════════════════
   ArrowUpIcon
   Fuente: https://lucide-animated.com/r/arrow-up.json
══════════════════════════════════════════════════════════════════ */
const AU_PATH_VARIANTS = {
  normal: { d: 'm5 12 7-7 7 7', translateY: 0 },
  animate: { d: 'm5 12 7-7 7 7', translateY: [0, 3, 0], transition: { duration: 0.4 } },
}
const AU_SECOND_VARIANTS = {
  normal: { d: 'M12 19V5' },
  animate: { d: ['M12 19V5', 'M12 19V10', 'M12 19V5'], transition: { duration: 0.4 } },
}

const ArrowUpIcon = forwardRef(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation()
    const isControlledRef = useRef(false)

    useImperativeHandle(ref, () => {
      isControlledRef.current = true
      return {
        startAnimation: () => controls.start('animate'),
        stopAnimation:  () => controls.start('normal'),
      }
    })

    const handleMouseEnter = useCallback((e) => {
      if (isControlledRef.current) { onMouseEnter?.(e) } else { controls.start('animate') }
    }, [controls, onMouseEnter])

    const handleMouseLeave = useCallback((e) => {
      if (isControlledRef.current) { onMouseLeave?.(e) } else { controls.start('normal') }
    }, [controls, onMouseLeave])

    return (
      <div className={cn(className)} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} {...props}>
        <svg fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
          <motion.path animate={controls} d="m5 12 7-7 7 7" variants={AU_PATH_VARIANTS} />
          <motion.path animate={controls} d="M12 19V5" variants={AU_SECOND_VARIANTS} />
        </svg>
      </div>
    )
  }
)
ArrowUpIcon.displayName = 'ArrowUpIcon'

/* ══════════════════════════════════════════════════════════════════
   ArrowDownIcon
   Fuente: https://lucide-animated.com/r/arrow-down.json
══════════════════════════════════════════════════════════════════ */
const AD_PATH_VARIANTS = {
  normal: { d: 'm19 12-7 7-7-7', translateY: 0 },
  animate: { d: 'm19 12-7 7-7-7', translateY: [0, -3, 0], transition: { duration: 0.4 } },
}
const AD_SECOND_VARIANTS = {
  normal: { d: 'M12 5v14' },
  animate: { d: ['M12 5v14', 'M12 5v9', 'M12 5v14'], transition: { duration: 0.4 } },
}

const ArrowDownIcon = forwardRef(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation()
    const isControlledRef = useRef(false)

    useImperativeHandle(ref, () => {
      isControlledRef.current = true
      return {
        startAnimation: () => controls.start('animate'),
        stopAnimation:  () => controls.start('normal'),
      }
    })

    const handleMouseEnter = useCallback((e) => {
      if (isControlledRef.current) { onMouseEnter?.(e) } else { controls.start('animate') }
    }, [controls, onMouseEnter])

    const handleMouseLeave = useCallback((e) => {
      if (isControlledRef.current) { onMouseLeave?.(e) } else { controls.start('normal') }
    }, [controls, onMouseLeave])

    return (
      <div className={cn(className)} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} {...props}>
        <svg fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
          <motion.path animate={controls} d="m19 12-7 7-7-7" variants={AD_PATH_VARIANTS} />
          <motion.path animate={controls} d="M12 5v14" variants={AD_SECOND_VARIANTS} />
        </svg>
      </div>
    )
  }
)
ArrowDownIcon.displayName = 'ArrowDownIcon'

/* ── Exports ─────────────────────────────────────────────────────── */
export {
  ActivityIcon,
  UsersIcon,
  CpuIcon,
  ClockAnimIcon,
  TrendingUpIcon,
  MapPinIcon,
  FingerprintIcon,
  ScanFaceIcon,
  CreditCardIcon,
  ArrowUpIcon,
  ArrowDownIcon,
}





