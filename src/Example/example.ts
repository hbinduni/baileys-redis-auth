import {Boom} from '@hapi/boom';
import NodeCache from 'node-cache';
import makeWASocket, {
  AnyMessageContent,
  delay,
  DisconnectReason,
  fetchLatestBaileysVersion,
  getAggregateVotesInPollMessage,
  makeCacheableSignalKeyStore,
  makeInMemoryStore,
  proto,
  WAMessageContent,
  WAMessageKey,
} from '@whiskeysockets/baileys';
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
store?.readFromFile('./baileys_store_multi.json');
// save every 10s
setInterval(() => {
  store?.writeToFile('./baileys_store_multi.json');
}, 10_000);

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

  store?.bind(sock.ev);

  const sendMessageWTyping = async (msg: AnyMessageContent, jid: string) => {
    await sock.presenceSubscribe(jid);
    await delay(500);

    await sock.sendPresenceUpdate('composing', jid);
    await delay(2000);

    await sock.sendPresenceUpdate('paused', jid);

    await sock.sendMessage(jid, msg);
  };

  // the process function lets you process all events that just occurred
  // efficiently in a batch
  sock.ev.process(
    // events is a map for event name => event data
    async (events) => {
      // something about the connection changed
      // maybe it closed, or we received all offline message or connection opened
      if (events['connection.update']) {
        const update = events['connection.update'];
        const {connection, lastDisconnect, qr} = update;
        if (connection === 'close') {
          // reconnect if not logged out
          if ((lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut) {
            startSock();
          } else {
            console.log('Connection closed. You are logged out.');
            // await deleteKeysWithPattern({redis, pattern: 'DB1*'});
            await deleteHSetKeys({redis, key: 'DB1'});
          }
        }

        console.log('connection update', update);
        if (connection === 'open') {
          await sendMessageWTyping({text: 'i am ok!'}, '6281911770011@s.whatsapp.net');
        }

        if (qr) {
          console.log('qr code =>', qr);
        }
      }

      // credentials updated -- save them
      if (events['creds.update']) {
        await saveCreds();
      }

      if (events['labels.association']) {
        console.log(events['labels.association']);
      }

      if (events['labels.edit']) {
        console.log(events['labels.edit']);
      }

      if (events.call) {
        console.log('recv call event', events.call);
      }

      // history received
      if (events['messaging-history.set']) {
        const {chats, contacts, messages, isLatest} = events['messaging-history.set'];
        console.log(
          `recv ${chats.length} chats, ${contacts.length} contacts, ${messages.length} msgs (is latest: ${isLatest})`
        );
      }

      // received a new message
      if (events['messages.upsert']) {
        const upsert = events['messages.upsert'];
        console.log('recv messages ', JSON.stringify(upsert, undefined, 2));

        if (upsert.type === 'notify') {
          for (const msg of upsert.messages) {
            if (!msg.key.fromMe) {
              if (doReplies) {
                console.log('replying to', msg.key.remoteJid);
                await sock!.readMessages([msg.key]);
                await sendMessageWTyping({text: 'Hello there!'}, msg.key.remoteJid!);
              }

              if (
                (msg.message?.conversation || msg.message?.extendedTextMessage?.text) === 'ping'
              ) {
                await sock!.readMessages([msg.key]);
                await sendMessageWTyping({text: 'Pong!'}, msg.key.remoteJid!);
                console.log('is connected: ', sock!.user);
                const groups = await sock!.groupFetchAllParticipating();
                console.log('groups:', JSON.stringify(groups, undefined, 2));
              }
            }
          }
        }
      }

      // messages updated like status delivered, message deleted etc.
      if (events['messages.update']) {
        // console.log(JSON.stringify(events['messages.update'], undefined, 2));

        for (const {key, update} of events['messages.update']) {
          if (update.pollUpdates) {
            const pollCreation = await getMessage(key);
            if (pollCreation) {
              console.log(
                'got poll update, aggregation: ',
                getAggregateVotesInPollMessage({
                  message: pollCreation,
                  pollUpdates: update.pollUpdates,
                })
              );
            }
          }
        }
      }

      if (events['message-receipt.update']) {
        // console.log(events['message-receipt.update']);
      }

      if (events['messages.reaction']) {
        // console.log(events['messages.reaction']);
      }

      if (events['presence.update']) {
        // console.log(events['presence.update']);
      }

      if (events['chats.update']) {
        // console.log(events['chats.update']);
      }

      if (events['contacts.update']) {
        for (const contact of events['contacts.update']) {
          if (typeof contact.imgUrl !== 'undefined') {
            const newUrl =
              contact.imgUrl === null
                ? null
                : await sock!.profilePictureUrl(contact.id!).catch(() => null);
            console.log(`contact ${contact.id} has a new profile pic: ${newUrl}`);
          }
        }
      }

      if (events['chats.delete']) {
        console.log('chats deleted ', events['chats.delete']);
      }
    }
  );

  return sock;

  async function getMessage(key: WAMessageKey): Promise<WAMessageContent | undefined> {
    if (store) {
      const msg = await store.loadMessage(key.remoteJid!, key.id!);
      return msg?.message || undefined;
    }

    // only if store is present
    return proto.Message.fromObject({});
  }
};

startSock();
