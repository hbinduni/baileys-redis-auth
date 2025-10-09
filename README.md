# baileys-redis-auth

`baileys-redis-auth` is a library designed to seamlessly integrate Redis as an authentication state storage solution for [Baileys](https://github.com/WhiskeySockets/Baileys), the powerful WhatsApp Web API library. By leveraging Redis, this module allows you to persist Baileys sessions, enabling your application to resume connections without needing to re-scan QR codes frequently. This is particularly useful for applications requiring robust and scalable session management.

This library provides flexible ways to store authentication data in Redis, using either simple key-value pairs or Redis Hashes for optimized storage.

## Prerequisites

Before using `baileys-redis-auth`, ensure you have the following installed and configured:

*   **Node.js:** Version 18.x or higher is recommended.
*   **Redis:** A running Redis server instance. You'll need its connection details (host, port, password if any).
*   **Baileys:** This library is an auth handler for Baileys, so you should have Baileys as part of your project.

## Installation

```bash
npm install baileys-redis-auth
```

## Usage

### Using `useRedisAuthStateWithHSet` (Recommended)

This is the recommended method for storing Baileys authentication data in Redis. It utilizes Redis Hashes (HSET) to store all authentication credentials and keys under a single Redis key per session prefix. This approach is generally more efficient and organized, especially when managing multiple Baileys sessions.

**Parameters:**
*   `redisOptions`: An object containing your Redis server connection details (e.g., `host`, `port`, `password`). This is passed directly to the `ioredis` constructor.
*   `prefix`: A string used to namespace your Baileys session data in Redis. For example, if your `prefix` is `'DB1'`, all data for this session will be stored under a Redis key like `authState:DB1`. This allows you to manage multiple independent Baileys sessions in the same Redis database.
*   `logger` (optional): A function `(message: string, ...args: unknown[]) => void` for logging Redis connection events. Pass `console.log` or your custom logger function.

```typescript
import {useRedisAuthStateWithHSet, deleteHSetKeys} from 'baileys-redis-auth';
import Redis, { RedisOptions } from 'ioredis'; // Assuming ioredis is used like this

// Define your Redis connection options
const redisOptions: RedisOptions = {
    host: 'localhost',
    port: 6379,
    // password: 'your_redis_password', // Uncomment if your Redis has a password
};

// Define a unique prefix for this Baileys session
const sessionPrefix = 'baileys_session_1';

async function initializeBaileysWithHSet() {
    // Initialize a new Redis client instance if you need to pass it around or use it elsewhere
    // const redis = new Redis(redisOptions);
    // redis.on('connect', () => console.log('Connected to Redis for HSet method!'));
    // Note: useRedisAuthStateWithHSet creates its own Redis instance internally based on redisOptions.
    // If you pass an existing ioredis instance, it should be the first argument,
    // and redisOptions the second, though the current library signature seems to expect options first.
    // For simplicity, we'll let the function create its own connection.

    const {state, saveCreds, redis: authRedisInstance} = await useRedisAuthStateWithHSet(
        redisOptions,
        sessionPrefix,
        console.log  // Optional: pass logger for Redis connection events
    );

    // 'state' will be used to initialize Baileys
    // 'saveCreds' is a function to periodically save the authentication state
    // 'authRedisInstance' is the Redis client instance used by the auth state hook

    console.log('Baileys state loaded using HSet method.');

    // Example: Listen for Redis connection events on the instance returned by the hook
    authRedisInstance.on('connect', () => console.log(`Redis (from hook) connected for session: ${sessionPrefix}`));
    authRedisInstance.on('error', (err) => console.error(`Redis (from hook) error for session ${sessionPrefix}:`, err));

    // ... your Baileys setup code using 'state' and 'saveCreds'

    // Example of how to delete all keys for this specific session prefix if needed:
    // await deleteHSetKeys({redis: authRedisInstance, key: sessionPrefix});
    // console.log(`Authentication data for session ${sessionPrefix} deleted.`);
}

initializeBaileysWithHSet().catch(console.error);
```

#### Deleting Session Data (`deleteHSetKeys`)

To remove all authentication data associated with a specific session prefix used with `useRedisAuthStateWithHSet`, you can use the `deleteHSetKeys` utility function.

**Usage:**

```typescript
import { deleteHSetKeys } from 'baileys-redis-auth';
import Redis, { RedisOptions } from 'ioredis'; // Or use the instance from useRedisAuthStateWithHSet

// Assuming 'authRedisInstance' is the Redis instance from useRedisAuthStateWithHSet
// or a new instance configured with the same options.
// const redisClient = new Redis(redisOptions);
// const sessionPrefixToDelete = 'baileys_session_1';

// await deleteHSetKeys({redis: authRedisInstance, key: sessionPrefixToDelete});
// console.log(`All HSet data for prefix '${sessionPrefixToDelete}' deleted.`);
```

**Parameters:**
*   `options`: An object with the following properties:
    *   `redis`: An active `ioredis` client instance.
    *   `key`: The session `prefix` string (e.g., `'baileys_session_1'`) whose data needs to be deleted. This corresponds to the `prefix` you used with `useRedisAuthStateWithHSet`.
    *   `logger` (optional): A function for logging deletion operations.

### Using `useRedisAuthState`

This method stores each piece of authentication data as a separate key-value pair in Redis, prefixed by the `prefix` string. While functional, it can lead to a larger number of individual keys in your Redis database compared to the HSET method.

**Parameters:**
*   `redisOptions`: An object containing your Redis server connection details (e.g., `host`, `port`, `password`). This is passed directly to the `ioredis` constructor.
*   `prefix`: A string used to prefix all Redis keys for this Baileys session. For example, if your `prefix` is `'DB1'`, keys will be stored like `DB1:creds`, `DB1:pre-key-1`, etc.
*   `logger` (optional): A function `(message: string, ...args: unknown[]) => void` for logging Redis connection events. Pass `console.log` or your custom logger function.

```typescript
import {useRedisAuthState, deleteKeysWithPattern} from 'baileys-redis-auth';
import Redis, { RedisOptions } from 'ioredis'; // Assuming ioredis is used like this

// Define your Redis connection options
const redisOptions: RedisOptions = {
    host: 'localhost',
    port: 6379,
    // password: 'your_redis_password', // Uncomment if your Redis has a password
};

// Define a unique prefix for this Baileys session
const sessionPrefix = 'baileys_session_2';

async function initializeBaileysSimple() {
    // Initialize a new Redis client instance if you need to pass it around
    // const redis = new Redis(redisOptions);
    // redis.on('connect', () => console.log('Connected to Redis for simple method!'));
    // As with HSet, useRedisAuthState creates its own Redis instance.

    const {state, saveCreds, redis: authRedisInstance} = await useRedisAuthState(
        redisOptions,
        sessionPrefix,
        console.log  // Optional: pass logger for Redis connection events
    );

    // 'state' will be used to initialize Baileys
    // 'saveCreds' is a function to periodically save the authentication state
    // 'authRedisInstance' is the Redis client instance used by the auth state hook

    console.log('Baileys state loaded using simple key-value method.');
    
    // Example: Listen for Redis connection events on the instance returned by the hook
    authRedisInstance.on('connect', () => console.log(`Redis (from hook) connected for session: ${sessionPrefix}`));
    authRedisInstance.on('error', (err) => console.error(`Redis (from hook) error for session ${sessionPrefix}:`, err));

    // ... your Baileys setup code using 'state' and 'saveCreds'

    // Example of how to delete all keys for this specific session prefix if needed:
    // The pattern should match the prefix used.
    // await deleteKeysWithPattern({redis: authRedisInstance, pattern: `${sessionPrefix}:*`});
    // console.log(`Authentication data for session ${sessionPrefix} (pattern: ${sessionPrefix}:*) deleted.`);
}

initializeBaileysSimple().catch(console.error);
```

#### Deleting Session Data (`deleteKeysWithPattern`)

To remove all authentication data associated with a specific session prefix used with `useRedisAuthState`, you can use the `deleteKeysWithPattern` utility function. This function deletes all Redis keys matching a given pattern.

**Usage:**

```typescript
import { deleteKeysWithPattern } from 'baileys-redis-auth';
import Redis, { RedisOptions } from 'ioredis'; // Or use the instance from useRedisAuthState

// Assuming 'authRedisInstance' is the Redis instance from useRedisAuthState
// or a new instance configured with the same options.
// const redisClient = new Redis(redisOptions);
// const sessionPrefixToDelete = 'baileys_session_2';

// The pattern must match how useRedisAuthState stores keys, typically `prefix:*`
// await deleteKeysWithPattern({redis: authRedisInstance, pattern: `${sessionPrefixToDelete}:*`});
// console.log(`All keys matching pattern '${sessionPrefixToDelete}:*' deleted.`);
```

**Parameters:**
*   `options`: An object with the following properties:
    *   `redis`: An active `ioredis` client instance.
    *   `pattern`: The key pattern to delete (e.g., `'baileys_session_2:*'`). This should align with the `prefix` used in `useRedisAuthState`, followed by `:*` to match all related keys.
    *   `logger` (optional): A function for logging deletion operations.

## Logout and Session Cleanup

**Important**: When you call `sock.logout()`, Baileys does NOT automatically clear your Redis session. You must manually handle session cleanup in your `connection.update` event handler.

### Proper Logout Implementation

```typescript
import {deleteKeysWithPattern, useRedisAuthState} from 'baileys-redis-auth'
import makeWASocket, {DisconnectReason} from '@whiskeysockets/baileys'
import type {Boom} from '@hapi/boom'

const sessionPrefix = 'my-session'
const {state, saveCreds, redis} = await useRedisAuthState(redisOptions, sessionPrefix, console.log)

const sock = makeWASocket({auth: state})

// Handle connection updates
sock.ev.on('connection.update', async (update) => {
  const {connection, lastDisconnect} = update

  if (connection === 'close') {
    const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode

    if (statusCode === DisconnectReason.loggedOut) {
      // Clear Redis session on logout
      await deleteKeysWithPattern({
        redis,
        pattern: `${sessionPrefix}:*`,
        logger: console.log  // Optional: pass logger for debugging
      })
      console.log('Session cleared')
    }
  }
})

// When you want to logout
await sock.logout() // Session cleanup happens in connection.update handler
```

For detailed logout implementation guide, see [LOGOUT_GUIDE.md](./LOGOUT_GUIDE.md).

## Running the Example

This project includes an example script to demonstrate the usage of `baileys-redis-auth`. To run it:

1.  **Clone the repository (if you haven't already):**
    ```bash
    git clone https://github.com/hbinduni/baileys-redis-auth.git
    cd baileys-redis-auth
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    # or
    # pnpm install
    # or
    # yarn install
    ```

3.  **Ensure you have a Redis server running** and accessible on `localhost:6379` (or update the example script with your Redis configuration).

4.  **Configure environment variables:**
    ```bash
    cp .env.example .env
    # Edit .env with your Redis configuration
    ```

5.  **Run the example script:**
    ```bash
    npm run example
    # or
    # pnpm example
    # or
    # bun run example
    ```
    This command executes `ts-node -r tsconfig-paths/register example/example.ts`.
    The example will guide you through connecting to WhatsApp using Baileys with Redis for authentication storage. You'll see a QR code in your terminal to scan with WhatsApp.

    **Interactive Commands:**
    - `send <phone> <message>` - Send a WhatsApp message
    - `logout` - Logout and clear session
    - `help` - Show available commands
    - `exit` - Exit the application

## Contributing

Contributions are welcome! If you have suggestions for improvements, bug fixes, or new features, please feel free to:

1.  Fork the repository.
2.  Create a new branch (`git checkout -b feature/your-feature-name`).
3.  Make your changes.
4.  Commit your changes (`git commit -m 'Add some feature'`).
5.  Push to the branch (`git push origin feature/your-feature-name`).
6.  Open a Pull Request.

Please ensure your code adheres to the existing style and that any new functionality is appropriately documented.

## License

This project is licensed under the MIT License. Refer to the license information in the `package.json` for details.
```
