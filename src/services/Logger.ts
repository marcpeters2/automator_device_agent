import console = require("console");
import constants from "../constants";

// @ts-ignore
import CBuffer from "CBuffer";
const CircularBuffer = CBuffer;


enum LogLevels {
  debug = 4,
  info = 3,
  warn = 2,
  error = 1,
  fatal = 0
}

type ConsoleLogParams = Parameters<typeof console.log>

function toString(logLevel: LogLevels) {
  switch(logLevel) {
    case LogLevels.debug:
      return "DEBUG";
    case LogLevels.info:
      return "INFO";
    case LogLevels.warn:
      return "WARN";
    case LogLevels.error:
      return "ERROR";
    case LogLevels.fatal:
      return "FATAL";
  }
}

export class Logger {
  private _history;
  private _logLevel: LogLevels = LogLevels.debug;

  public logLevels = LogLevels;

  constructor() {
    this._history = new CircularBuffer(constants.MAX_LOG_ENTRIES);
  }

  setLevel(level: LogLevels) {
    this._logLevel = level;
  }

  debug(...args: ConsoleLogParams) {
    this._log(LogLevels.debug, args);
  }

  info(...args: ConsoleLogParams) {
    this._log(LogLevels.info, args);
  }

  warn(...args: ConsoleLogParams) {
    this._log(LogLevels.warn, args);
  }

  error(...args: ConsoleLogParams) {
    this._log(LogLevels.error, args);
  }

  fatal(...args: ConsoleLogParams) {
    this._log(LogLevels.fatal, args);
  }

  _log(level: LogLevels, args: ConsoleLogParams) {
    if(this._logLevel!! < level) return;

    let logFunc = null;

    switch(level) {
      case LogLevels.warn:
        logFunc = console.warn;
        break;
      case LogLevels.error:
      case LogLevels.fatal:
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


export const logger = new Logger();
