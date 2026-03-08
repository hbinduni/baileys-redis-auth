import * as readline from 'node:readline'
import type {Boom} from '@hapi/boom'
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WASocket,
} from 'baileys'
import dotenv from 'dotenv'
import NodeCache from 'node-cache'
import qrcodeTerminal from 'qrcode-terminal'
import {deleteKeysWithPattern, useRedisAuthState} from '../src/index.js'
import {logger} from './logger-pino.js'

// Load environment variables from .env file
dotenv.config()

logger.level = 'info'

// Message retry counter cache
const msgRetryCounterCache = new NodeCache()

// Global socket reference for interactive commands
let sock: WASocket | null = null
let isAuthenticated = false

// Setup readline interface for interactive commands
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '',
})

// Display available commands
function showCommands() {
  console.log('\n📱 Available Commands:')
  console.log('  send <phone> <message>  - Send a message (e.g., send 6281234567890 Hello)')
  console.log('  logout                  - Logout and clear session')
  console.log('  help                    - Show this help message')
  console.log('  exit                    - Exit the application\n')
}

// Handle interactive commands
rl.on('line', async (line: string) => {
  const input = line.trim()

  if (!input) {
    rl.prompt()
    return
  }

  const parts = input.split(' ')
  const command = parts[0].toLowerCase()

  try {
    switch (command) {
      case 'help':
        showCommands()
        break

      case 'send': {
        if (!isAuthenticated || !sock) {
          console.log('❌ Not authenticated. Please scan QR code first.')
          break
        }

        if (parts.length < 3) {
          console.log('❌ Usage: send <phone> <message>')
          console.log('   Example: send 6281234567890 Hello World')
          break
        }

        const phone = parts[1]
        const message = parts.slice(2).join(' ')

        // Format phone number
        const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`

        console.log(`📤 Sending message to ${phone}...`)
        await sock.sendMessage(jid, {text: message})
        console.log('✅ Message sent successfully!')
        break
      }

      case 'logout': {
        if (!sock) {
          console.log('❌ No active session.')
          break
        }

        console.log('🔓 Logging out...')
        try {
          await sock.logout()
        } catch (error) {
          // Logout throws "Intentional Logout" error - this is expected behavior
        }
        console.log('✅ Logged out successfully!')
        break
      }

      case 'exit':
        console.log('👋 Goodbye!')
        process.exit(0)
        break

      default:
        console.log(`❌ Unknown command: ${command}`)
        console.log('   Type "help" for available commands.')
    }
  } catch (error) {
    console.error('❌ Error executing command:', error)
  }

  rl.prompt()
})

// Start WhatsApp connection
async function startSock() {
  const redisOptions = {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number.parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
  }

  const sessionPrefix = process.env.SESSION_PREFIX || 'session'

  const {state, saveCreds, redis} = await useRedisAuthState(redisOptions, sessionPrefix, console.log)

  // Fetch latest version of WA Web
  const {version, isLatest} = await fetchLatestBaileysVersion()
  console.log(`📱 Using WA v${version.join('.')}, isLatest: ${isLatest}`)

  // Create socket connection
  sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false, // We'll use qrcode-terminal instead
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    msgRetryCounterCache,
    generateHighQualityLinkPreview: true,
    getMessage: async () => undefined,
  })

  // Connection update handler
  sock.ev.on('connection.update', async (update) => {
    const {connection, lastDisconnect, qr} = update

    // Display QR code in terminal
    if (qr) {
      console.log('\n📱 Scan this QR code with WhatsApp:\n')
      qrcodeTerminal.generate(qr, {small: true})
      console.log('\n')
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut

      if (shouldReconnect) {
        console.log('❌ Connection closed unexpectedly. Reconnecting...')
        startSock()
      } else {
        // Intentional logout - clean up session
        console.log('🔓 Cleaning up session...')
        await deleteKeysWithPattern({redis, sessionId: sessionPrefix, logger: console.log})
        console.log('✅ Session cleaned up successfully.')
        isAuthenticated = false
        rl.prompt()
      }
    } else if (connection === 'open') {
      console.log('✅ Connection opened successfully!')
      console.log(`👤 Connected as: ${sock?.user?.name || 'Unknown'} (${sock?.user?.id || 'Unknown'})`)
      isAuthenticated = true
      showCommands()
      rl.prompt()
    }
  })

  // Credentials update handler
  sock.ev.on('creds.update', saveCreds)

  // Messages upsert handler - for incoming messages
  sock.ev.on('messages.upsert', async ({messages, type}) => {
    if (type === 'notify') {
      for (const msg of messages) {
        if (!msg.message) continue

        const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text
        const from = msg.key.remoteJid

        if (messageText && !msg.key.fromMe) {
          console.log(`\n📨 Message from ${from}: ${messageText}`)
          rl.prompt()
        }
      }
    }
  })
}

// Start the application
console.log('🚀 Starting Baileys Redis Auth Example...\n')
startSock().catch((err) => {
  console.error('❌ Failed to start:', err)
  process.exit(1)
})
