# Logout Implementation Guide

This document explains how to properly implement logout functionality with `baileys-redis-auth`.

## How Baileys Logout Works

When you call `sock.logout()`, Baileys:

1. Sends a "remove-companion-device" request to WhatsApp servers
2. Triggers a connection close with `DisconnectReason.loggedOut` status code
3. **Does NOT automatically clear auth state** - this is the responsibility of your application

## Important: Auth State Does Not Auto-Clear

Unlike some other libraries, **Baileys does not automatically clear authentication state when logout() is called**. This is intentional and follows the file-based auth state pattern.

Your application MUST manually clear the Redis session when it detects a logout.

## Proper Logout Implementation

### Step 1: Detect Logout in Connection Handler

```typescript
import {deleteKeysWithPattern, useRedisAuthState} from 'baileys-redis-auth'
import {DisconnectReason} from '@whiskeysockets/baileys'

const {state, saveCreds, redis} = await useRedisAuthState(redisOptions, 'my-session')

sock.ev.on('connection.update', async (update) => {
  const {connection, lastDisconnect} = update

  if (connection === 'close') {
    const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode

    if (statusCode === DisconnectReason.loggedOut) {
      // User logged out - clear the session
      await deleteKeysWithPattern({
        redis,
        pattern: 'my-session:*'  // Must match your session prefix
      })
      console.log('Session cleared after logout')
    }
  }
})
```

### Step 2: Call Logout When Needed

```typescript
// When user wants to logout
try {
  await sock.logout()
} catch (error) {
  // Logout throws "Intentional Logout" error - this is expected
  // The connection.update handler will handle cleanup
}
```

## Using Hash-Based Storage (useRedisAuthStateWithHSet)

If you're using `useRedisAuthStateWithHSet`, use `deleteHSetKeys` instead:

```typescript
import {deleteHSetKeys, useRedisAuthStateWithHSet} from 'baileys-redis-auth'

const {state, saveCreds, redis} = await useRedisAuthStateWithHSet(redisOptions, 'my-session')

sock.ev.on('connection.update', async (update) => {
  const {connection, lastDisconnect} = update

  if (connection === 'close') {
    const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode

    if (statusCode === DisconnectReason.loggedOut) {
      // Clear HSet-based session
      await deleteHSetKeys({redis, key: 'my-session'})
      console.log('Session cleared after logout')
    }
  }
})
```

## Complete Example

```typescript
import {deleteKeysWithPattern, useRedisAuthState} from 'baileys-redis-auth'
import makeWASocket, {DisconnectReason} from '@whiskeysockets/baileys'
import type {Boom} from '@hapi/boom'

async function startWhatsApp() {
  const sessionPrefix = 'my-session'

  const {state, saveCreds, redis} = await useRedisAuthState({
    host: 'localhost',
    port: 6379,
  }, sessionPrefix)

  const sock = makeWASocket({
    auth: state,
    // ... other options
  })

  // Save credentials on update
  sock.ev.on('creds.update', saveCreds)

  // Handle connection updates
  sock.ev.on('connection.update', async (update) => {
    const {connection, lastDisconnect} = update

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode

      if (statusCode === DisconnectReason.loggedOut) {
        // THIS IS CRITICAL: Clear Redis session on logout
        await deleteKeysWithPattern({
          redis,
          pattern: `${sessionPrefix}:*`
        })
        console.log('✅ Session cleared successfully')
      } else {
        // Reconnect on other errors
        console.log('Reconnecting...')
        startWhatsApp()
      }
    }
  })

  return sock
}

// Usage
const sock = await startWhatsApp()

// Later, when user wants to logout:
await sock.logout() // This will trigger the cleanup in connection.update handler
```

## Why This Design?

This design follows Baileys' philosophy:

1. **Separation of Concerns**: Auth state storage is separate from connection management
2. **Flexibility**: You can choose when and how to clear sessions
3. **Consistency**: Works the same way as file-based auth state
4. **Control**: You have full control over session lifecycle

## Common Mistakes

### ❌ Wrong: Calling logout without cleanup handler

```typescript
// This will NOT clear your Redis session!
await sock.logout()
// Session data still exists in Redis
```

### ❌ Wrong: Clearing session before logout completes

```typescript
await sock.logout()
await deleteKeysWithPattern({redis, pattern: 'session:*'})
// Race condition - might clear before logout message is sent
```

### ✅ Correct: Handle cleanup in connection.update

```typescript
sock.ev.on('connection.update', async (update) => {
  if (connection === 'close' && statusCode === DisconnectReason.loggedOut) {
    await deleteKeysWithPattern({redis, pattern: 'session:*'})
  }
})

// Later...
await sock.logout() // Cleanup happens automatically
```

## Exported Functions Reference

### For Key-Value Storage

```typescript
deleteKeysWithPattern({
  redis: RedisClient,    // Redis client from useRedisAuthState
  pattern: string        // Pattern to match (e.g., 'session:*')
}): Promise<void>
```

### For Hash Storage

```typescript
deleteHSetKeys({
  redis: RedisClient,    // Redis client from useRedisAuthStateWithHSet
  key: string           // Session prefix (e.g., 'session')
}): Promise<void>
```

## See Also

- [Example Implementation](./example/example.ts) - Complete working example with logout
- [Main Documentation](./CLAUDE.md) - Full library documentation
- [Baileys Documentation](https://github.com/WhiskeySockets/Baileys) - Official Baileys docs
