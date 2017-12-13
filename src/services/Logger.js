export const logLevels = {
  debug: 4,
  info: 3,
  warn: 2,
  error: 1,
  fatal: 0
};

class Logger {

  setLevel(level) {
    this._logLevel = level;
  }

  debug(...args) {
    if(this._logLevel < logLevels.debug) return;
    console.log(...args);
  }

  info(...args) {
    if(this._logLevel < logLevels.info) return;
    console.log(...args);
  }

  warn(...args) {
    if(this._logLevel < logLevels.warn) return;
    console.warn(...args);
  }

  error(...args) {
    if(this._logLevel < logLevels.error) return;
    console.error(...args);
  }

  fatal(...args) {
    if(this._logLevel < logLevels.fatal) return;
    console.error(...args);
  }
}

const singleton = new Logger();
singleton.setLevel(logLevels.debug);

export default singleton;
