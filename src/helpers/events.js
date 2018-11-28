function notifyAllListeners(callbacks, ...args) {
  for (const callback of callbacks) {
    callback(...args);
  }
}

module.exports = {
  notifyAllListeners,
};
