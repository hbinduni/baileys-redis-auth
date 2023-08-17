import pino from 'pino';

import Pack from '#/../package.json';

const pretty = {
  level: 'info',
  target: 'pino-pretty',
  options: {
    colorize: true,
    translateTime: 'SYS:isoDateTime',
    ignore: 'pid,hostname',
  },
};

const transports = pino.transport({
  targets: [pretty],
});

const options = {
  level: process.env.PINO_LOG_LEVEL || 'info',
  formatters: {
    bindings: (bindings) => {
      return {
        pid: bindings.pid,
        host: bindings.hostname,
        app: Pack.name,
        v: Pack.version,
        node_version: process.version,
      };
    },
    level: (label, number) => {
      return {level: number, label: label.toUpperCase()};
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
};

export const logger = pino(options, transports);
