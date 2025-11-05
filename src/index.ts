import {
  type AuthenticationCreds,
  type AuthenticationState,
  BufferJSON,
  type SignalDataTypeMap,
  initAuthCreds,
  proto
} from 'baileys'
import Redis, { type RedisOptions, type Redis as RedisClient } from 'ioredis'

/**
 * Options for deleting Hash-based authentication state
 */
interface IDeleteHSetKeyOptions {
  /** Active Redis client instance */
  redis: RedisClient
  /** The session identifier to delete */
  sessionId: string
  /** Optional logging function for debugging */
  logger?: (message: string, ...args: unknown[]) => void
}

/**
 * Options for deleting key-value based authentication state
 */
interface IDeleteKeysOptions {
  /** Active Redis client instance */
  redis: RedisClient
  /** The session identifier to delete */
  sessionId: string
  /** Optional logging function for debugging */
  logger?: (message: string, ...args: unknown[]) => void
}

/**
 * Options for listing sessions
 */
interface IListSessionsOptions {
  /** Active Redis client instance */
  redis: RedisClient
  /** Optional logging function for debugging */
  logger?: (message: string, ...args: unknown[]) => void
}

/**
 * Sanitizes a string to make it safe for use as a Redis key
 *
 * Replaces problematic characters that might cause issues in Redis keys:
 * - Forward slashes (/) are replaced with double underscores (__)
 * - Colons (:) are replaced with hyphens (-)
 *
 * @param file - The string to sanitize
 * @returns The sanitized string safe for use as a Redis key component
 *
 * @internal
 */
const fixFileName = (file: string) =>
  file.replace(/\//g, '__').replace(/:/g, '-')

/**
 * Creates a namespaced Redis key by combining sessionId and key
 *
 * @param key - The key name
 * @param sessionId - The session identifier
 * @returns The combined key in the format `${sessionId}:${key}`
 *
 * @internal
 */
const createKey = (key: string, sessionId: string) => `${sessionId}:${key}`

/**
 * Redis-based authentication state storage using Hash (HSET) - Recommended
 *
 * Stores all authentication data in a single Redis Hash per session.
 * This approach is more efficient than key-value storage for Redis memory and operations.
 * All authentication state (credentials, keys, and signals) is stored under a single hash key.
 *
 * @param redisOptions - Configuration options for the Redis client connection
 * @param sessionId - Session identifier for the Redis hash key (default: 'session'). The hash key will be `${sessionId}:auth`
 * @param logger - Optional logging function for debugging and monitoring Redis operations
 *
 * @returns Promise that resolves to an object containing:
 *   - `state`: The Baileys AuthenticationState object with creds and keys methods
 *   - `saveCreds`: Function to manually save credentials to Redis
 *   - `redis`: The Redis client instance for manual operations
 *
 * @example
 * ```typescript
 * const { state, saveCreds, redis } = await useRedisAuthStateWithHSet(
 *   { host: 'localhost', port: 6379 },
 *   'my-whatsapp-session',
 *   console.log
 * );
 *
 * const conn = makeWASocket({ auth: state });
 * // Credentials are automatically saved on state changes
 * ```
 *
 * @see {@link useRedisAuthState} for key-value based storage alternative
 */
export const useRedisAuthStateWithHSet = async (
  redisOptions: RedisOptions,
  sessionId = 'session',
  logger?: (message: string, ...args: unknown[]) => void
): Promise<{
  state: AuthenticationState
  saveCreds: () => Promise<void>
  redis: RedisClient
}> => {
  const redis = new Redis(redisOptions)

  redis.on('connect', async () => {
    const redisClientName = `baileys-auth-${sessionId}`
    await redis.client('SETNAME', redisClientName)
    logger?.(`Redis client name set to ${redisClientName}`)
  })

  const writeData = async (key: string, data: unknown): Promise<void> => {
    await redis.hset(
      createKey('auth', sessionId),
      key,
      JSON.stringify(data, BufferJSON.replacer)
    )
  }

  const readData = async (key: string): Promise<unknown> => {
    const data = await redis.hget(createKey('auth', sessionId), key)
    return data ? JSON.parse(data, BufferJSON.reviver) : null
  }

  const removeData = async (key: string): Promise<void> => {
    await redis.hdel(createKey('auth', sessionId), key)
  }

  const creds: AuthenticationCreds =
    ((await readData('creds')) as AuthenticationCreds) || initAuthCreds()

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
                  type === 'app-state-sync-key'
                    ? proto.Message.AppStateSyncKeyData.fromObject(
                        value as object
                      )
                    : value
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
        }
      }
    },
    saveCreds: async () => {
      await writeData('creds', creds)
    },
    redis
  }
}

/**
 * Deletes all authentication data for a specific session using Hash (HSET)
 *
 * Removes the entire Redis hash containing all authentication state for the given session.
 * This is the cleanup function for sessions created with `useRedisAuthStateWithHSet`.
 *
 * @param options - Configuration object
 * @param options.redis - Active Redis client instance
 * @param options.sessionId - The session identifier to delete (e.g., 'session', 'my-whatsapp-session')
 * @param options.logger - Optional logging function for debugging
 *
 * @returns Promise that resolves when the deletion is complete
 *
 * @throws {Error} If Redis deletion operation fails
 *
 * @example
 * ```typescript
 * const { redis } = await useRedisAuthStateWithHSet({ host: 'localhost' }, 'session-123');
 *
 * // Later, to logout and clean up:
 * await deleteHSetKeys({
 *   redis,
 *   sessionId: 'session-123',
 *   logger: console.log
 * });
 * ```
 *
 * @see {@link useRedisAuthStateWithHSet} for the corresponding storage function
 */
export const deleteHSetKeys = async ({
  redis,
  sessionId,
  logger
}: IDeleteHSetKeyOptions): Promise<void> => {
  try {
    logger?.('Removing auth state for session:', sessionId)
    await redis.del(createKey('auth', sessionId))
  } catch (err) {
    const error = err as Error
    logger?.('Error deleting session:', error.message)
    throw error
  }
}

/**
 * Redis-based authentication state storage using key-value pairs
 *
 * Stores each piece of authentication data as a separate Redis key with the pattern `${sessionId}:${key}`.
 * This approach is less efficient than the Hash-based storage but offers more compatibility with
 * existing systems and allows for more granular key management and expiration.
 *
 * @param redisOptions - Configuration options for the Redis client connection
 * @param sessionId - Session identifier for Redis keys (default: 'session'). Each key will be `${sessionId}:${keyname}`
 * @param logger - Optional logging function for debugging and monitoring Redis operations
 *
 * @returns Promise that resolves to an object containing:
 *   - `state`: The Baileys AuthenticationState object with creds and keys methods
 *   - `saveCreds`: Function to manually save credentials to Redis
 *   - `redis`: The Redis client instance for manual operations
 *
 * @example
 * ```typescript
 * const { state, saveCreds, redis } = await useRedisAuthState(
 *   { host: 'localhost', port: 6379 },
 *   'my-whatsapp-session',
 *   console.log
 * );
 *
 * const conn = makeWASocket({ auth: state });
 * // Credentials are automatically saved on state changes
 * ```
 *
 * @see {@link useRedisAuthStateWithHSet} for the recommended Hash-based storage alternative
 */
export const useRedisAuthState = async (
  redisOptions: RedisOptions,
  sessionId = 'session',
  logger?: (message: string, ...args: unknown[]) => void
): Promise<{
  state: AuthenticationState
  saveCreds: () => Promise<void>
  redis: RedisClient
}> => {
  const redis = new Redis(redisOptions)

  redis.on('connect', async () => {
    const redisClientName = `baileys-auth-${sessionId}`
    await redis.client('SETNAME', redisClientName)
    logger?.(`Redis client name set to ${redisClientName}`)
  })

  const writeData = async (key: string, data: unknown): Promise<void> => {
    await redis.set(
      createKey(key, sessionId),
      JSON.stringify(data, BufferJSON.replacer)
    )
  }

  const readData = async (key: string): Promise<unknown> => {
    const data = await redis.get(createKey(key, sessionId))
    return data ? JSON.parse(data, BufferJSON.reviver) : null
  }

  const removeData = async (key: string): Promise<void> => {
    await redis.del(createKey(key, sessionId))
  }

  const creds: AuthenticationCreds =
    ((await readData('creds')) as AuthenticationCreds) ?? initAuthCreds()

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
                  type === 'app-state-sync-key'
                    ? proto.Message.AppStateSyncKeyData.fromObject(
                        value as object
                      )
                    : value
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
        }
      }
    },
    saveCreds: async () => {
      await writeData('creds', creds)
    },
    redis
  }
}

/**
 * Deletes all authentication keys for a specific session using key-value approach
 *
 * Uses Redis SCAN command to safely iterate through keys without blocking the Redis server.
 * This is the cleanup function for sessions created with `useRedisAuthState`.
 * The SCAN operation is cursor-based and processes keys in batches of 100.
 *
 * @param options - Configuration object
 * @param options.redis - Active Redis client instance
 * @param options.sessionId - The session identifier to delete (e.g., 'session', 'my-whatsapp-session')
 * @param options.logger - Optional logging function for debugging and monitoring deletion progress
 *
 * @returns Promise that resolves when all matching keys have been deleted
 *
 * @throws {Error} If Redis SCAN or UNLINK operations fail
 *
 * @example
 * ```typescript
 * const { redis } = await useRedisAuthState({ host: 'localhost' }, 'session-123');
 *
 * // Later, to logout and clean up all keys for this session:
 * await deleteKeysWithPattern({
 *   redis,
 *   sessionId: 'session-123',
 *   logger: console.log
 * });
 * ```
 *
 * @see {@link useRedisAuthState} for the corresponding storage function
 * @see {@link deleteHSetKeys} for Hash-based storage cleanup
 */
export const deleteKeysWithPattern = async ({
  redis,
  sessionId,
  logger
}: IDeleteKeysOptions): Promise<void> => {
  try {
    const pattern = `${sessionId}:*`
    logger?.('Removing auth state for session:', sessionId)
    let cursor = 0
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100
      )
      cursor = Number.parseInt(nextCursor, 10)
      if (keys.length > 0) {
        await redis.unlink(...keys)
        logger?.(`Deleted ${keys.length} keys for session: ${sessionId}`)
      }
    } while (cursor !== 0)
  } catch (err) {
    const error = err as Error
    logger?.('Error deleting session:', error.message)
    throw error
  }
}

/**
 * Lists all session identifiers stored using Hash (HSET) approach
 *
 * Scans Redis for all hash keys with the pattern `*:auth` and extracts the session identifiers.
 * This is useful for discovering all active sessions created with `useRedisAuthStateWithHSet`.
 *
 * @param options - Configuration object
 * @param options.redis - Active Redis client instance
 * @param options.logger - Optional logging function for debugging
 *
 * @returns Promise that resolves to an array of session identifiers
 *
 * @throws {Error} If Redis SCAN operation fails
 *
 * @example
 * ```typescript
 * const redis = new Redis({ host: 'localhost' });
 *
 * const sessions = await listHSetSessions({ redis, logger: console.log });
 * console.log('Active sessions:', sessions);
 * // Output: ['session-123', 'user-456', 'bot-789']
 * ```
 *
 * @see {@link useRedisAuthStateWithHSet} for the corresponding storage function
 * @see {@link listSessions} for key-value based session listing
 */
export const listHSetSessions = async ({
  redis,
  logger
}: IListSessionsOptions): Promise<string[]> => {
  try {
    const sessions: string[] = []
    let cursor = 0

    logger?.('Scanning for Hash-based sessions...')

    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        'MATCH',
        '*:auth',
        'COUNT',
        100
      )
      cursor = Number.parseInt(nextCursor, 10)

      for (const key of keys) {
        // Extract sessionId from "sessionId:auth" pattern
        const sessionId = key.replace(':auth', '')
        if (sessionId) {
          sessions.push(sessionId)
        }
      }
    } while (cursor !== 0)

    logger?.(`Found ${sessions.length} Hash-based sessions`)
    return sessions
  } catch (err) {
    const error = err as Error
    logger?.('Error listing sessions:', error.message)
    throw error
  }
}

/**
 * Lists all session identifiers stored using key-value approach
 *
 * Scans Redis for all keys with the pattern `*:creds` and extracts unique session identifiers.
 * This is useful for discovering all active sessions created with `useRedisAuthState`.
 *
 * @param options - Configuration object
 * @param options.redis - Active Redis client instance
 * @param options.logger - Optional logging function for debugging
 *
 * @returns Promise that resolves to an array of unique session identifiers
 *
 * @throws {Error} If Redis SCAN operation fails
 *
 * @example
 * ```typescript
 * const redis = new Redis({ host: 'localhost' });
 *
 * const sessions = await listSessions({ redis, logger: console.log });
 * console.log('Active sessions:', sessions);
 * // Output: ['session-123', 'user-456', 'bot-789']
 * ```
 *
 * @see {@link useRedisAuthState} for the corresponding storage function
 * @see {@link listHSetSessions} for Hash-based session listing
 */
export const listSessions = async ({
  redis,
  logger
}: IListSessionsOptions): Promise<string[]> => {
  try {
    const sessionsSet = new Set<string>()
    let cursor = 0

    logger?.('Scanning for key-value based sessions...')

    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        'MATCH',
        '*:creds',
        'COUNT',
        100
      )
      cursor = Number.parseInt(nextCursor, 10)

      for (const key of keys) {
        // Extract sessionId from "sessionId:creds" pattern
        const sessionId = key.replace(':creds', '')
        if (sessionId) {
          sessionsSet.add(sessionId)
        }
      }
    } while (cursor !== 0)

    const sessions = Array.from(sessionsSet)
    logger?.(`Found ${sessions.length} key-value based sessions`)
    return sessions
  } catch (err) {
    const error = err as Error
    logger?.('Error listing sessions:', error.message)
    throw error
  }
}
