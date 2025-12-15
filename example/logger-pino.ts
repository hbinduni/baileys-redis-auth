import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import pino from 'pino'

const __dirname = dirname(fileURLToPath(import.meta.url))
const Pack = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'))

const pretty = {
  level: 'info',
  target: 'pino-pretty',
  options: {
    colorize: true,
    translateTime: 'SYS:isoDateTime',
    ignore: 'pid,hostname',
  },
}

const transports = pino.transport({
  targets: [pretty],
})

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
      }
    },
    level: (label, number) => {
      return {level: number, label: label.toUpperCase()}
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
}

export const logger = pino(options, transports)
