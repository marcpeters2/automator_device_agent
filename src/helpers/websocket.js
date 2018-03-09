const subscriptions = new Set();

export function subscribeOnce(websocketClient, path, callback) {
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