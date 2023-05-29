import Redis, {RedisOptions} from 'ioredis';
import {
  AuthenticationCreds,
  AuthenticationState,
  SignalDataTypeMap,
  initAuthCreds,
  BufferJSON,
  proto,
} from '@whiskeysockets/baileys';

/**
 * Stores the full authentication state in Redis.
 * */
export const useRedisAuthState = async (
  redisOptions: RedisOptions,
  prefix: string = 'DB1'
): Promise<{state: AuthenticationState; saveCreds: () => Promise<void>}> => {
  const redis = new Redis(redisOptions);

  const writeData = (data: any, key: string) => {
    return redis.set(`${prefix}:${key}`, JSON.stringify(data, BufferJSON.replacer));
  };

  const readData = async (key: string) => {
    try {
      const data = await redis.get(`${prefix}:${key}`);
      return data ? JSON.parse(data, BufferJSON.reviver) : null;
    } catch (error) {
      return null;
    }
  };

  const creds: AuthenticationCreds = (await readData('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: {[_: string]: SignalDataTypeMap[typeof type]} = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }

              data[id] = value;
            })
          );

          return data;
        },
        set: async (data) => {
          const pipeline = redis.pipeline();
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${prefix}:${category}-${id}`;
              if (value) {
                pipeline.set(key, JSON.stringify(value, BufferJSON.replacer));
              } else {
                pipeline.del(key);
              }
            }
          }

          await pipeline.exec();
        },
      },
    },
    saveCreds: async () => {
      await writeData(creds, 'creds');
    },
  };
};
