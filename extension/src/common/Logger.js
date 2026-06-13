/**
 * Leveled, namespaced logger. Engines receive a child logger so output is
 * attributable, and the level can be raised in production builds.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

export class Logger {
  constructor(namespace = 'ef', level = 'info') {
    this.namespace = namespace;
    this.level = level;
  }

  child(suffix) {
    return new Logger(`${this.namespace}:${suffix}`, this.level);
  }

  #emit(level, args) {
    if (LEVELS[level] < LEVELS[this.level]) return;
    const fn = level === 'debug' ? 'log' : level;
    // eslint-disable-next-line no-console
    console[fn](`[${this.namespace}]`, ...args);
  }

  debug(...args) { this.#emit('debug', args); }
  info(...args) { this.#emit('info', args); }
  warn(...args) { this.#emit('warn', args); }
  error(...args) { this.#emit('error', args); }
}

export const rootLogger = new Logger('ef');
