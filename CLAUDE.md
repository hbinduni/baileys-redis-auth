# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A TypeScript library that provides Redis-based authentication state storage for Baileys (WhatsApp Web API). The library offers two storage strategies: Redis Hash (HSET) for optimized storage and simple key-value pairs.

## Project Structure

```
baileys-redis-auth/
├── src/              # Library source code
│   └── index.ts      # Main exports
├── example/          # Example implementation (excluded from build)
│   ├── example.ts    # Full Baileys integration example
│   └── logger-pino.ts
├── lib/              # Build output (generated)
└── package.json
```

## Development Commands

### Build & Development
```bash
# Clean build directory
bun run clean

# Build the library (outputs to lib/)
# Automatically runs prebuild (typecheck + lint) before building
bun run build

# Run example with Redis auth
bun run example
# Flags: --no-store (disable in-memory store), --no-reply (disable auto-replies)
```

### Code Quality
```bash
# TypeScript type checking
bun run typecheck

# Format code with Biome
bun run format

# Lint code
bun run lint

# Check formatting and linting (combined)
bun run check

# Check and auto-fix (combined)
bun run check:fix

# Full check: typecheck + lint
bun run check:all

# Full check and fix: typecheck + auto-fix
bun run check:all:fix
```

### Testing & Development
```bash
# Run example (default: with store and auto-replies)
bun run example

# Run example without store and auto-replies
bun run example:no-all

# Run example with custom flags
bun run example -- --no-store
bun run example -- --no-reply

# Setup environment variables (required for example)
cp .env.example .env
# Edit .env with your Redis credentials
```

## Architecture

### Core Modules

**`src/index.ts`** - Main library exports with two auth state implementations:

1. **`useRedisAuthStateWithHSet`** (Recommended)
   - Stores all auth data in a single Redis Hash per session
   - Key structure: `{prefix}:auth` with hash fields like `creds`, `{type}-{sanitized_id}`
   - More efficient for Redis memory and operations
   - Uses `HSET`, `HGET`, `HDEL` operations with Promise.all for parallel execution
   - File name sanitization: replaces "/" with "__" and ":" with "-" in IDs
   - Default prefix: `session` (was `DB1` in older versions)
   - Cleanup: `deleteHSetKeys({redis, key: prefix})`

2. **`useRedisAuthState`** (Key-Value Storage)
   - Stores each auth piece as separate Redis key
   - Key structure: `{prefix}:{key}` (e.g., `session:creds`, `session:pre-key-1`)
   - Creates more keys in Redis but more compatible with existing systems
   - Uses `SET`, `GET`, `DEL` operations with Promise.all for parallel execution
   - File name sanitization: replaces "/" with "__" and ":" with "-" in IDs
   - Default prefix: `session` (was `DB1` in older versions)
   - Cleanup: `deleteKeysWithPattern({redis, pattern: '{prefix}:*'})`

### Key Abstractions

**Authentication State Storage:**
- Both implementations return `{state, saveCreds, redis}`
- `state.creds`: Authentication credentials (AuthenticationCreds from Baileys)
- `state.keys`: Signal protocol keys with get/set methods
- `saveCreds`: Async function to persist current credentials
- `redis`: ioredis client instance for manual operations

**Data Serialization:**
- Uses Baileys' `BufferJSON.replacer/reviver` for Buffer handling
- Special handling for `app-state-sync-key` type (uses protobuf deserialization)
- File name sanitization via `fixFileName` function for safe Redis key naming
- Parallel operations using Promise.all for better performance
- Type-safe handling with proper TypeScript type assertions

**Session Management:**
- Each session identified by `prefix` string (default: `'session'`, can use any string like 'DB1', 'session_1')
- Redis client name set to `baileys-auth-{prefix}` on connect
- Multiple sessions can coexist in same Redis instance
- File IDs automatically sanitized to prevent Redis key naming conflicts

### Example Implementation Pattern

**`example/example.ts`** demonstrates:
- Environment variable configuration via dotenv (`.env` file)
- Redis configuration from environment: `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
- Session prefix from environment: `SESSION_PREFIX` (defaults to 'session')
- QR code display in terminal using `qrcode-terminal`
- Modern event-driven architecture using `sock.ev.on()`
- Automatic reconnection on connection close (except logout)
- Proper cleanup on logout (uses `deleteKeysWithPattern`)
- Message retry counter using NodeCache
- Interactive CLI with commands:
  - `send <phone> <message>` - Send text message
  - `logout` - Logout and clean session
  - `help` - Show available commands
  - `exit` - Exit application
- Real-time incoming message display

**Key Event Handlers:**
- `connection.update`: Handle connect/disconnect/QR/logout/reconnect
- `creds.update`: Trigger `saveCreds()` to persist state
- `messages.upsert`: Process incoming messages and display in real-time

**Usage:**
1. Configure `.env` with Redis credentials
2. Run `bun run example`
3. Scan QR code with WhatsApp mobile app
4. Use interactive commands to send messages or logout

## TypeScript Configuration

**Path Mapping:**
- `#/*` and `@/*` both map to `src/*` (configured in tsconfig.json)
- Requires `tsconfig-paths/register` for ts-node execution
- Build outputs to `lib/` with declaration files

**Compiler Settings:**
- Target: ES2018, CommonJS modules
- Strict null checks enabled
- Declaration files generated for library consumers

## Code Quality Tools

**Biome (Linting & Formatting):**
- Configured via `biome.json`
- Single tool for both linting and formatting (replaces ESLint + Prettier)
- Formatter: 120 char line width, single quotes, no bracket spacing
- Linter: Enforces import types, Node.js import protocol, warns on explicit `any`
- Auto-organize imports on format
- Files ignored: `lib/`, `node_modules/`, JSON files

## Environment Variables

**Configuration via `.env` file:**
```bash
# Redis Configuration
REDIS_HOST=localhost          # Redis server hostname
REDIS_PORT=6379              # Redis server port
REDIS_PASSWORD=your_password # Redis password (optional)

# Baileys Session Prefix
SESSION_PREFIX=session       # Session identifier prefix (default: 'session')
```

**Setup:**
1. Copy `.env.example` to `.env`: `cp .env.example .env`
2. Edit `.env` with your Redis credentials
3. Run example: `bun run example`

## Redis Requirements

**Connection:**
- Library accepts `RedisOptions` from ioredis
- Creates internal ioredis client per auth state instance
- Sets client name on connect for debugging: `baileys-auth-{prefix}`
- Example implementation uses dotenv for environment-based configuration

**Operations Used:**
- HSET: `useRedisAuthStateWithHSet` uses Hash commands (HSET/HGET/HDEL)
- Key-Value: `useRedisAuthState` uses String commands (SET/GET/DEL)
- Promise.all: Parallel batch operations for better performance (replaces pipeline)
- SCAN: Pattern-based key deletion with cursor iteration (for key-value cleanup)
- CLIENT SETNAME: Sets client name on connection for debugging

## Important Patterns

**Proper Cleanup:**
Always cleanup auth state on logout to prevent orphaned sessions:
```typescript
if (statusCode === DisconnectReason.loggedOut) {
  // For HSet method:
  await deleteHSetKeys({redis, key: prefix});
  // For key-value method:
  // await deleteKeysWithPattern({redis, pattern: `${prefix}:*`});
}
```

**Connection Resilience:**
Implement exponential backoff for reconnection attempts with retry counter reset on successful connection.

**Message Retry Handling:**
Use external cache (NodeCache) for retry counters to prevent decryption/encryption loops across socket restarts.

**Store Binding:**
When using makeInMemoryStore, bind to socket events before connection to capture all history.
- i am using bun package manager