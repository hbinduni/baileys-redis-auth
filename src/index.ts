import {
  type AuthenticationCreds,
  type AuthenticationState,
  BufferJSON,
  type SignalDataTypeMap,
  initAuthCreds,
  proto,
} from '@whiskeysockets/baileys'
import Redis, {type RedisOptions, type Redis as RedisClient} from 'ioredis'

interface IDeleteHSetKeyOptions {
  redis: RedisClient
  key: string
  logger?: (message: string, ...args: unknown[]) => void
}

interface IDeleteKeysOptions {
  redis: RedisClient
  pattern: string
  logger?: (message: string, ...args: unknown[]) => void
}

/**
 * Sanitizes a string to make it safe for use as a Redis key
 * Replaces "/" with "__" and ":" with "-"
 */
const fixFileName = (file: string) => file.replace(/\//g, '__').replace(/:/g, '-')

const createKey = (key: string, prefix: string) => `${prefix}:${key}`

/**
 * Redis-based authentication state storage using Hash (HSET) - Recommended
 * Stores all authentication data in a single Redis Hash per prefix
 * More efficient than key-value approach for Redis memory and operations
 */
export const useRedisAuthStateWithHSet = async (
  redisOptions: RedisOptions,
  prefix = 'session',
  logger?: (message: string, ...args: unknown[]) => void
): Promise<{state: AuthenticationState; saveCreds: () => Promise<void>; redis: RedisClient}> => {
  const redis = new Redis(redisOptions)

  redis.on('connect', async () => {
    const redisClientName = `baileys-auth-${prefix}`
    await redis.client('SETNAME', redisClientName)
    logger?.(`Redis client name set to ${redisClientName}`)
  })

  const writeData = async (key: string, data: unknown): Promise<void> => {
    await redis.hset(createKey('auth', prefix), key, JSON.stringify(data, BufferJSON.replacer))
  }

  const readData = async (key: string): Promise<unknown> => {
    const data = await redis.hget(createKey('auth', prefix), key)
    return data ? JSON.parse(data, BufferJSON.reviver) : null
  }

  const removeData = async (key: string): Promise<void> => {
    await redis.hdel(createKey('auth', prefix), key)
  }

  const creds: AuthenticationCreds = ((await readData('creds')) as AuthenticationCreds) || initAuthCreds()

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: Record<string, SignalDataTypeMap[typeof type]> = {}

          await Promise.all(
            ids.map(async (id) => {
              const key = `${type}-${fixFileName(id)}`
              const value = await readData(key)

              if (value) {
                data[id] = (
                  type === 'app-state-sync-key' ? proto.Message.AppStateSyncKeyData.fromObject(value as object) : value
                ) as SignalDataTypeMap[typeof type]
              }
            })
          )

          return data
        },
        set: async (data) => {
          const promises: Promise<void>[] = []

          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id]
              const key = `${category}-${fixFileName(id)}`

              if (value) {
                promises.push(writeData(key, value))
              } else {
                promises.push(removeData(key))
              }
            }
          }

          await Promise.all(promises)
        },
      },
    },
    saveCreds: async () => {
      await writeData('creds', creds)
    },
    redis,
  }
}

/**
 * Deletes all authentication data for a specific prefix using Hash (HSET)
 */
export const deleteHSetKeys = async ({redis, key, logger}: IDeleteHSetKeyOptions): Promise<void> => {
  try {
    logger?.('Removing auth state keys for prefix:', key)
    await redis.del(createKey('auth', key))
  } catch (err) {
    const error = err as Error
    logger?.('Error deleting keys:', error.message)
    throw error
  }
}

/**
 * Redis-based authentication state storage using key-value pairs
 * Stores each piece of authentication data as a separate Redis key
 * Less efficient than Hash approach but more compatible with existing systems
 */
export const useRedisAuthState = async (
  redisOptions: RedisOptions,
  prefix = 'session',
  logger?: (message: string, ...args: unknown[]) => void
): Promise<{state: AuthenticationState; saveCreds: () => Promise<void>; redis: RedisClient}> => {
  const redis = new Redis(redisOptions)

  redis.on('connect', async () => {
    const redisClientName = `baileys-auth-${prefix}`
    await redis.client('SETNAME', redisClientName)
    logger?.(`Redis client name set to ${redisClientName}`)
  })

  const writeData = async (key: string, data: unknown): Promise<void> => {
    await redis.set(createKey(key, prefix), JSON.stringify(data, BufferJSON.replacer))
  }

  const readData = async (key: string): Promise<unknown> => {
    const data = await redis.get(createKey(key, prefix))
    return data ? JSON.parse(data, BufferJSON.reviver) : null
  }

  const removeData = async (key: string): Promise<void> => {
    await redis.del(createKey(key, prefix))
  }

  const creds: AuthenticationCreds = ((await readData('creds')) as AuthenticationCreds) ?? initAuthCreds()

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: Record<string, SignalDataTypeMap[typeof type]> = {}

          await Promise.all(
            ids.map(async (id) => {
              const key = `${type}-${fixFileName(id)}`
              const value = await readData(key)

              if (value) {
                data[id] = (
                  type === 'app-state-sync-key' ? proto.Message.AppStateSyncKeyData.fromObject(value as object) : value
                ) as SignalDataTypeMap[typeof type]
              }
            })
          )

          return data
        },
        set: async (data) => {
          const promises: Promise<void>[] = []

          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id]
              const key = `${category}-${fixFileName(id)}`

              if (value) {
                promises.push(writeData(key, value))
              } else {
                promises.push(removeData(key))
              }
            }
          }

          await Promise.all(promises)
        },
      },
    },
    saveCreds: async () => {
      await writeData('creds', creds)
    },
    redis,
  }
}

/**
 * Deletes all authentication keys matching a pattern using key-value approach
 * Uses SCAN to safely iterate through keys without blocking Redis
 */
export const deleteKeysWithPattern = async ({redis, pattern, logger}: IDeleteKeysOptions): Promise<void> => {
  try {
    logger?.('Removing auth state keys matching pattern:', pattern)
    let cursor = 0
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
      cursor = Number.parseInt(nextCursor, 10)
      if (keys.length > 0) {
        await redis.unlink(...keys)
        logger?.(`Deleted keys: ${keys.join(', ')}`)
      }
    } while (cursor !== 0)
  } catch (err) {
    const error = err as Error
    logger?.('Error deleting keys:', error.message)
    throw error
  }
}
