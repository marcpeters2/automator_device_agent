import CBuffer from "CBuffer";
const CircularBuffer = CBuffer;

export const logLevels = {
  debug: 4,
  info: 3,
  warn: 2,
  error: 1,
  fatal: 0
};

function toString(logLevel) {
  switch(logLevel) {
    case logLevels.debug:
      return "DEBUG";
    case logLevels.info:
      return "INFO";
    case logLevels.warn:
      return "WARN";
    case logLevels.error:
      return "ERROR";
    case logLevels.fatal:
      return "FATAL";
  }
}

class Logger {

  constructor() {
    this._history = new CircularBuffer(200);
  }

  setLevel(level) {
    this._logLevel = level;
  }

  debug(...args) {
    this._log(logLevels.debug, args);
  }

  info(...args) {
    this._log(logLevels.info, args);
  }

  warn(...args) {
    this._log(logLevels.warn, args);
  }

  error(...args) {
    this._log(logLevels.error, args);
  }

  fatal(...args) {
    this._log(logLevels.fatal, args);
  }

  _log(level, args) {
    if(this._logLevel < level) return;

    let logFunc = null;

    switch(level) {
      case logLevels.warn:
        logFunc = console.warn;
        break;
      case logLevels.error:
      case logLevels.fatal:
        logFunc = console.error;
        break;
      default:
        logFunc = console.log;
        break;
    }
    args.unshift(`${new Date().toISOString()} [${toString(level)}]: `);
    this._history.push(args.reduce((arg, acc) => arg.toString() + acc, ""));
    logFunc(...args);
  }

  getHistory() {
    return this._history.toArray();
  }
}

const singleton = new Logger();
singleton.setLevel(logLevels.debug);

export default singleton;
