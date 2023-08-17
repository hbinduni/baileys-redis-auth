# baileys-redis-auth

use redis as auth storage for baileys

**how to install:**

    npm install baileys-redis-auth

**example:**

    const {useRedisAuthState, deleteKeysWithPattern} = require('baileys-redis-auth');

    const  redisOptions  = {
    	host:  'localhost',
    	port:  6379,
    };

    const {state, saveCreds, redis} =  await  useRedisAuthState(redisOptions, 'DB1');

    // if you need to delete all keys in the DB1 database, you can use the following code:
    await deleteKeysWithPattern({redis, pattern: 'DB1*'});
