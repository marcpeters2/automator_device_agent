const Nes = require("nes");
const WebsocketTransport = require("./WebsocketTransport");

class NesWebsocketTransport extends WebsocketTransport {

  constructor(dependencies) {
    const {config} = dependencies,
      websocketProtocol = config.USE_SECURE_WEBSOCKETS === false ? "ws" : "wss",
      websocketClient = new Nes.Client(`${websocketProtocol}://${config.API_HOST}:${config.API_PORT}`, {
        timeout: config.HTTP_REQUEST_TIMEOUT_MS
      });

    super({...dependencies, websocketClient});
  }
}

module.exports = NesWebsocketTransport;
