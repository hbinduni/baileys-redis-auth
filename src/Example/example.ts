import {Boom} from '@hapi/boom';
import NodeCache from 'node-cache';
import makeWASocket, {
  AnyMessageContent,
  delay,
  DisconnectReason,
  fetchLatestBaileysVersion,
  getAggregateVotesInPollMessage,
  makeCacheableSignalKeyStore,
  proto,
  WAMessageContent,
  WAMessageKey,
} from '@whiskeysockets/baileys';
import makeInMemoryStore from '@whiskeysockets/baileys/lib/Store/makeInMemoryStore';
import {logger} from '#/Example/logger-pino';
import {useRedisAuthState, deleteKeysWithPattern} from '#/index';
import {useRedisAuthStateWithHSet, deleteHSetKeys} from '#/index';

// Ensure logger is of type Logger or undefined
// const logger = Logger.child({});
logger.level = 'info';

const useStore = !process.argv.includes('--no-store');
const doReplies = !process.argv.includes('--no-reply');

// external map to store retry counts of messages when decryption/encryption fails
// keep this out of the socket itself, so as to prevent a message decryption/encryption loop across socket restarts
const msgRetryCounterCache = new NodeCache();

// the store maintains the data of the WA connection in memory
// can be written out to a file & read from it
const store = useStore ? makeInMemoryStore({logger}) : undefined;
if (useStore) {
  store?.readFromFile('./baileys_store_multi.json');
  // save every 10s
  setInterval(() => {
    store?.writeToFile('./baileys_store_multi.json');
  }, 10_000);
}

let retryCounter = 0;

// start a connection
const startSock = async () => {
  const redisOptions = {
    host: 'localhost',
    port: 6379,
    password: 'd334911fd345f1170b5bfcc8e75ee72df0f114eb',
  };

  const {state, saveCreds, redis} = await useRedisAuthState(redisOptions, 'DB1');
  // const {state, saveCreds, redis} = await useRedisAuthStateWithHSet(redisOptions, 'DB1');

  // fetch latest version of WA Web
  const {version, isLatest} = await fetchLatestBaileysVersion();
  console.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`);

  const waOptions = {
    version,
    logger,
    printQRInTerminal: true,
    auth: {
      creds: state.creds,
      /** caching makes the store faster to send/recv messages */
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    msgRetryCounterCache,
    generateHighQualityLinkPreview: true,
    // ignore all broadcast messages -- to receive the same
    // comment the line below out
    // shouldIgnoreJid: jid => isJidBroadcast(jid),
    // implement to handle retries & poll updates
    getMessage,
    browser: ['BINDUNI v3', 'Desktop', version.join('.')] as [string, string, string],
  };

  const sock = makeWASocket(waOptions);

  if (useStore) {
    store?.bind(sock.ev);
  }

  const sendMessageWTyping = async (msg: AnyMessageContent, jid: string) => {
    await sock.presenceSubscribe(jid);
    await delay(500);

    await sock.sendPresenceUpdate('composing', jid);
    await delay(2000);

    await sock.sendPresenceUpdate('paused', jid);

    await sock.sendMessage(jid, msg);
  };

  // Event handler functions defined within startSock to close over variables like sock, saveCreds, redis, etc.
  async function handleConnectionUpdate(update: Partial<import('@whiskeysockets/baileys').ConnectionState>) {
    const {connection, lastDisconnect, qr} = update;
    const currentAuthState = state; // Use the state from the outer scope
    const currentRedis = redis; // Use redis from the outer scope

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        retryCounter++;
        const delayMs = Math.min(30000, (2 ** retryCounter) * 1000);
        console.log(`Connection closed due to ${lastDisconnect?.error}, reconnecting in ${delayMs}ms. Retry attempt ${retryCounter}`);
        await delay(delayMs);
        startSock(); // Retry connecting
      } else {
        console.log('Connection closed. You are logged out.');
        // Determine which cleanup function to call based on which auth state is being used.
        // This example assumes 'DB1' as the prefix, as used in the example.
        // If useRedisAuthState is active (based on which line is commented out above for state, saveCreds, redis initialization)
        // await deleteKeysWithPattern({redis: currentRedis, pattern: 'DB1:*'});
        // If useRedisAuthStateWithHSet is active:
        await deleteHSetKeys({redis: currentRedis, key: 'DB1'});
        console.log('Cleaned up auth state keys.');
      }
    } else if (connection === 'open') {
      console.log('Connection opened successfully.');
      retryCounter = 0; // Reset retry counter on successful connection
      // Example: Send a message on successful connection
      // await sendMessageWTyping({text: 'Hello from BINDUNI! Connection successful.'}, 'your-number@s.whatsapp.net');
    }

    if (qr) {
      console.log('QR code received, please scan:', qr);
    }
    // console.log('Connection update event:', update);
  }

  async function handleCredsUpdate() {
    await saveCreds();
    // console.log('Credentials updated and saved.');
  }

  async function handleMessagingHistorySet(history: import('@whiskeysockets/baileys').MessageHistoryBundle) {
    const {chats, contacts, messages, isLatest} = history;
    console.log(
      `Received ${chats.length} chats, ${contacts.length} contacts, ${messages.length} messages (is latest: ${isLatest}).`
    );
    // History is automatically handled by the store if bound.
  }

  async function handleMessagesUpsert(upsert: import('@whiskeysockets/baileys').BaileysEventMap['messages.upsert']) {
    // console.log('Received messages upsert:', JSON.stringify(upsert, undefined, 2));
    if (upsert.type === 'notify' || upsert.type === 'append') {
      for (const msg of upsert.messages) {
        // Messages are automatically stored by store.bind if store is active
        if (!msg.key.fromMe && doReplies) {
          console.log('Replying to message from:', msg.key.remoteJid);
          await sock.readMessages([msg.key]);
          await sendMessageWTyping({text: 'Hello there! This is an automated reply.'}, msg.key.remoteJid!);
        }
        // Example: Ping-pong
        const messageText = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
        if (messageText?.toLowerCase() === 'ping') {
          console.log('Received "ping", sending "pong".');
          await sock.readMessages([msg.key]);
          await sendMessageWTyping({text: 'Pong!'}, msg.key.remoteJid!);
          // console.log('Current user info:', sock.user);
          // const groups = await sock.groupFetchAllParticipating();
          // console.log('Participating groups:', JSON.stringify(groups, undefined, 2));
        }
      }
    }
  }

  async function handleMessagesUpdate(updates: import('@whiskeysockets/baileys').BaileysEventMap['messages.update']) {
    // console.log('Messages update event:', JSON.stringify(updates, undefined, 2));
    for (const {key, update} of updates) {
      if (update.pollUpdates) {
        const pollCreation = await getMessage(key);
        if (pollCreation) {
          console.log(
            'Received poll update. Aggregated votes:',
            getAggregateVotesInPollMessage({
              message: pollCreation,
              pollUpdates: update.pollUpdates,
            })
          );
        }
      }
    }
  }

  async function handleContactsUpdate(contactsUpdate: import('@whiskeysockets/baileys').BaileysEventMap['contacts.update']) {
    for (const contact of contactsUpdate) {
      if (typeof contact.imgUrl !== 'undefined') {
        const newUrl =
          contact.imgUrl === 'changed'
            ? await sock.profilePictureUrl(contact.id!).catch(() => null)
            : contact.imgUrl === 'removed' ? null : contact.imgUrl; // Bailey's new imgUrl states
        console.log(`Contact ${contact.id} has a new profile pic: ${newUrl}`);
      }
    }
  }

  async function handleChatsUpdate(chatsUpdate: import('@whiskeysockets/baileys').BaileysEventMap['chats.update']) {
    // console.log('Chats update event:', chatsUpdate);
  }

  async function handleChatsDelete(deletedChats: import('@whiskeysockets/baileys').BaileysEventMap['chats.delete']) {
    console.log('Chats deleted event:', deletedChats);
  }

  async function handleLabelsAssociation(associationInfo: import('@whiskeysockets/baileys').LabelAssociation) {
    // console.log('Labels association event:', associationInfo);
  }

  async function handleLabelsEdit(labelEditInfo: import('@whiskeysockets/baileys').Label) {
    // console.log('Labels edit event:', labelEditInfo);
  }

  async function handleCall(callEvents: import('@whiskeysockets/baileys').Call[]) {
    // console.log('Received call event:', callEvents);
    // Here you might want to handle incoming calls, e.g., reject them
    for (const call of callEvents) {
        if (call.status === 'offer') {
            // Example: Reject all incoming calls
            // await sock.rejectCall(call.id, call.from);
            // console.log(`Rejected call ${call.id} from ${call.from}`);
        }
    }
  }

  async function handleMessageReceiptUpdate(receipts: import('@whiskeysockets/baileys').BaileysEventMap['message-receipt.update']) {
    // console.log('Message receipt update event:', receipts);
  }

  async function handleMessagesReaction(reactions: import('@whiskeysockets/baileys').BaileysEventMap['messages.reaction']) {
    // console.log('Messages reaction event:', reactions);
  }

  async function handlePresenceUpdate(presence: import('@whiskeysockets/baileys').BaileysEventMap['presence.update']) {
    // console.log('Presence update event:', presence);
  }

  // Main event processing using the new handlers
  sock.ev.process(async (events) => {
    if (events['connection.update']) await handleConnectionUpdate(events['connection.update']);
    if (events['creds.update']) await handleCredsUpdate();
    if (events['messaging-history.set']) await handleMessagingHistorySet(events['messaging-history.set']);
    if (events['messages.upsert']) await handleMessagesUpsert(events['messages.upsert']);
    if (events['messages.update']) await handleMessagesUpdate(events['messages.update']);
    if (events['contacts.update']) await handleContactsUpdate(events['contacts.update']);
    if (events['chats.update']) await handleChatsUpdate(events['chats.update']);
    if (events['chats.delete']) await handleChatsDelete(events['chats.delete']);
    if (events['labels.association']) await handleLabelsAssociation(events['labels.association']);
    if (events['labels.edit']) await handleLabelsEdit(events['labels.edit']);
    if (events.call) await handleCall(events.call); // Note: 'call' is not an array in some Baileys versions, might be events['call']
    if (events['message-receipt.update']) await handleMessageReceiptUpdate(events['message-receipt.update']);
    if (events['messages.reaction']) await handleMessagesReaction(events['messages.reaction']);
    if (events['presence.update']) await handlePresenceUpdate(events['presence.update']);
  });

  return sock;

  async function getMessage(key: WAMessageKey): Promise<WAMessageContent | undefined> {
    if (store) {
      const msg = await store.loadMessage(key.remoteJid!, key.id!);
      return msg?.message || undefined;
    }
    // Return undefined if store is not used, as messageStore is removed
    return undefined;
  }
};

startSock();
