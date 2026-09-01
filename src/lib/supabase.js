// src/lib/supabase.js
import { createClient } from '@supabase/supabase-js'
import toast from 'react-hot-toast'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('[Signum-Clock] Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en .env.local')
}

const rawSupabase = createClient(supabaseUrl, supabaseKey)

// Función para interceptar y manejar el error 429
function handleSupabaseError(error) {
  if (!error) return
  
  // Capturar código de error personalizado P4290 de nuestro rate limiting o mensaje de error 429
  if (error.code === 'P4290' || (error.message && error.message.includes('429')) || error.status === 429) {
    toast.error('Demasiadas solicitudes. Por favor, espera un minuto antes de volver a intentarlo.', {
      id: 'rate-limit-toast',
      duration: 5000,
    })
  }
}

// Wrapper para interceptar las promesas de PostgREST y RPC
function wrapPromise(promise) {
  const originalThen = promise.then
  promise.then = function (onFulfilled, onRejected) {
    return originalThen.call(
      promise,
      (response) => {
        if (response && response.error) {
          handleSupabaseError(response.error)
        }
        return onFulfilled ? onFulfilled(response) : response
      },
      (err) => {
        handleSupabaseError(err)
        if (onRejected) {
          return onRejected(err)
        }
        throw err
      }
    )
  }
  return promise
}

// Interceptador para constructores de consultas (query builders)
const wrapQueryBuilder = (builder) => {
  return new Proxy(builder, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      
      if (typeof value === 'function') {
        return function (...args) {
          const result = value.apply(this, args)
          
          if (result && typeof result.then === 'function') {
            return wrapPromise(result)
          }
          if (result && typeof result === 'object') {
            return wrapQueryBuilder(result)
          }
          return result
        }
      }
      return value
    }
  })
}

// Proxy sobre el cliente Supabase para interceptar únicamente base de datos y RPC
export const supabase = new Proxy(rawSupabase, {
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver)
    
    if (prop === 'from') {
      return function (...args) {
        const builder = value.apply(target, args)
        return wrapQueryBuilder(builder)
      }
    }
    
    if (prop === 'rpc') {
      return function (...args) {
        const result = value.apply(target, args)
        if (result && typeof result.then === 'function') {
          return wrapPromise(result)
        }
        return result
      }
    }
    
    if (typeof value === 'function') {
      return value.bind(target)
    }
    
    return value
  }
})
