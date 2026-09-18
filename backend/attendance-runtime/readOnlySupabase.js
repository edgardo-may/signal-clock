'use strict'

class ReadOnlyViolationError extends Error {
  constructor(message, code = 'ATTENDANCE_RUNTIME_WRITE_DENIED') {
    super(message)
    this.name = 'ReadOnlyViolationError'
    this.code = code
  }
}

function readOnlyQueryGuard(query, counters) {
  return new Proxy(query, {
    get(target, property, receiver) {
      if (property === 'then') return target.then?.bind(target)
      if (['insert', 'update', 'delete', 'upsert'].includes(property)) {
        return () => {
          counters.databaseWrites += 1
          throw new ReadOnlyViolationError('Attendance Runtime SHADOW no permite DML.')
        }
      }
      const value = Reflect.get(target, property, receiver)
      if (typeof value !== 'function') return value
      return (...args) => {
        const result = value.apply(target, args)
        return result && typeof result === 'object' ? readOnlyQueryGuard(result, counters) : result
      }
    },
  })
}

function indirectAccessDenied(counters, capability) {
  return new Proxy({}, {
    get() {
      return () => {
        counters.indirectSupabaseCalls = (counters.indirectSupabaseCalls || 0) + 1
        if (capability === 'storage') counters.storageWriteCalls = (counters.storageWriteCalls || 0) + 1
        throw new ReadOnlyViolationError(`Attendance Runtime SHADOW no permite Supabase ${capability}.`, 'ATTENDANCE_RUNTIME_INDIRECT_ACCESS_DENIED')
      }
    },
  })
}

function createReadOnlyClient(client, counters = { databaseWrites: 0, rpcWriteCalls: 0, storageWriteCalls: 0, indirectSupabaseCalls: 0 }) {
  return new Proxy(client, {
    get(target, property, receiver) {
      if (['storage', 'functions', 'auth', 'channel', 'removeChannel', 'removeAllChannels'].includes(property)) {
        return indirectAccessDenied(counters, String(property))
      }
      if (property === 'rpc') {
        return () => {
          counters.rpcWriteCalls += 1
          throw new ReadOnlyViolationError('Attendance Runtime SHADOW no permite RPC.')
        }
      }
      const value = Reflect.get(target, property, receiver)
      if (typeof value !== 'function') return value
      return (...args) => {
        const result = value.apply(target, args)
        return property === 'from' && result && typeof result === 'object'
          ? readOnlyQueryGuard(result, counters)
          : result
      }
    },
  })
}

module.exports = { ReadOnlyViolationError, createReadOnlyClient }
