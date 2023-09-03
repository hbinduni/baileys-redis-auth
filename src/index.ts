import Redis, {RedisOptions, Redis as RedisClient} from 'ioredis';
import {
  AuthenticationCreds,
  AuthenticationState,
  SignalDataTypeMap,
  initAuthCreds,
  BufferJSON,
  proto,
} from '@whiskeysockets/baileys';

interface IDeleteKeysOptions {
  redis: RedisClient;
  pattern: string;
}

interface IDeleteHSetKeyOptions {
  redis: RedisClient;
  key: string;
}

/**
 * Stores the full authentication state in Redis HSET.
 * */
export const useRedisAuthStateWithHSet = async (
  redisOptions: RedisOptions,
  prefix: string = 'DB1'
): Promise<{state: AuthenticationState; saveCreds: () => Promise<void>; redis: RedisClient}> => {
  const redis = new Redis(redisOptions);

  const writeData = (data: any, key: string, field: string) => {
    return redis.hset(`${key}:${prefix}`, field, JSON.stringify(data, BufferJSON.replacer));
  };

  const readData = async (key: string, field: string) => {
    try {
      const data = await redis.hget(`${key}:${prefix}`, field);
      return data ? JSON.parse(data, BufferJSON.reviver) : null;
    } catch (error) {
      return null;
    }
  };

  const creds: AuthenticationCreds = (await readData('authState', 'creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: {[_: string]: SignalDataTypeMap[typeof type]} = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData('authState', `${type}-${id}`);
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
              const field = `${category}-${id}`;
              if (value) {
                pipeline.hset(
                  `authState:${prefix}`,
                  field,
                  JSON.stringify(value, BufferJSON.replacer)
                );
              } else {
                pipeline.hdel(`authState:${prefix}`, field);
              }
            }
          }
          await pipeline.exec();
        },
      },
    },
    saveCreds: async () => {
      await writeData(creds, 'authState', 'creds');
    },
    redis,
  };
};

/**
 * Stores the full authentication state in Redis.
 * */
export const useRedisAuthState = async (
  redisOptions: RedisOptions,
  prefix: string = 'DB1'
): Promise<{state: AuthenticationState; saveCreds: () => Promise<void>; redis: RedisClient}> => {
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
    redis,
  };
};

export const deleteKeysWithPattern = async ({
  redis,
  pattern,
}: IDeleteKeysOptions): Promise<void> => {
  let cursor: number = 0;

  do {
    // Use the SCAN command to find keys by the pattern
    const [nextCursor, keys]: [string, string[]] = await redis.scan(
      cursor,
      'MATCH',
      pattern,
      'COUNT',
      100
    );
    cursor = parseInt(nextCursor, 10);

    // Use UNLINK to delete keys asynchronously
    if (keys.length > 0) {
      await redis.unlink(...keys);
      console.log(`Deleted keys: ${keys}`);
    }
  } while (cursor !== 0);
};

export const deleteHSetKeys = async ({redis, key}: IDeleteHSetKeyOptions): Promise<void> => {
  try {
    await redis.del(`authState:${key}`);
  } catch (err) {
    console.log('Error deleting keys:', err.message);
  }
};
