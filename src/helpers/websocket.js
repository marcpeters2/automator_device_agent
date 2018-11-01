const subscriptions = new Set();

module.exports = {
  subscribeOnce(websocketClient, path, callback) {
    if (subscriptions.has(path)) {
      return Promise.resolve();
    }

    return websocketClient.subscribe(path, function () {
        callback.apply(null, arguments);
      })
      .then(() => {
        subscriptions.add(path);
      });
  }
};
