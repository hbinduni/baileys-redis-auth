import { type AuthenticationState } from 'baileys';
import { type RedisOptions, type Redis as RedisClient } from 'ioredis';
/**
 * Options for deleting Hash-based authentication state
 */
interface IDeleteHSetKeyOptions {
    /** Active Redis client instance */
    redis: RedisClient;
    /** The session identifier to delete */
    sessionId: string;
    /** Optional logging function for debugging */
    logger?: (message: string, ...args: unknown[]) => void;
}
/**
 * Options for deleting key-value based authentication state
 */
interface IDeleteKeysOptions {
    /** Active Redis client instance */
    redis: RedisClient;
    /** The session identifier to delete */
    sessionId: string;
    /** Optional logging function for debugging */
    logger?: (message: string, ...args: unknown[]) => void;
}
/**
 * Options for listing sessions
 */
interface IListSessionsOptions {
    /** Active Redis client instance */
    redis: RedisClient;
    /** Optional logging function for debugging */
    logger?: (message: string, ...args: unknown[]) => void;
}
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
export declare const useRedisAuthStateWithHSet: (redisOptions: RedisOptions, sessionId?: string, logger?: (message: string, ...args: unknown[]) => void) => Promise<{
    state: AuthenticationState;
    saveCreds: () => Promise<void>;
    redis: RedisClient;
}>;
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
export declare const deleteHSetKeys: ({ redis, sessionId, logger }: IDeleteHSetKeyOptions) => Promise<void>;
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
export declare const useRedisAuthState: (redisOptions: RedisOptions, sessionId?: string, logger?: (message: string, ...args: unknown[]) => void) => Promise<{
    state: AuthenticationState;
    saveCreds: () => Promise<void>;
    redis: RedisClient;
}>;
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
export declare const deleteKeysWithPattern: ({ redis, sessionId, logger }: IDeleteKeysOptions) => Promise<void>;
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
export declare const listHSetSessions: ({ redis, logger }: IListSessionsOptions) => Promise<string[]>;
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
export declare const listSessions: ({ redis, logger }: IListSessionsOptions) => Promise<string[]>;
export {};
