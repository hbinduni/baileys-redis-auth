# baileys-redis-auth

use redis as auth storage for baileys

**how to install:**

    npm install baileys-redis-auth

**example:**

    const {useRedisAuthState} = require('baileys-redis-auth');

    const  redisOptions  = {
    	host:  'localhost',
    	port:  6379,
    };

    const {state, saveCreds} =  await  useRedisAuthState(redisOptions, 'DB1');
