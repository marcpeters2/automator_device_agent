const _ = require("lodash"),
  Nes = require('nes'),
  Promise = require("bluebird"),
  {notifyAllListeners} = require("../helpers/events"),
  constants = require("../constants");

const CONNECTION_STATE = {
  CONNECTED: "CONNECTED",
  DISCONNECTED: "DISCONNECTED",
};


class DataTransportService {

  constructor({config, authToken, logger}) {
    const websocketProtocol = config.USE_SECURE_WEBSOCKETS === false ? "ws" : "wss",
      websocketClient = new Nes.Client(`${websocketProtocol}://${config.API_HOST}:${config.API_PORT}`, {
        timeout: constants.HTTP_REQUEST_TIMEOUT_MS
      });

    this._logger = logger;
    this._authToken = authToken;
    this._websocketClient = websocketClient;
    this._subscriptions = new Set();
    this._connectionState = CONNECTION_STATE.DISCONNECTED;
    this._onConnectListeners = [];
    this._onInitialConnectListeners = [];
    this._onDisconnectListeners = [];
    this._connecting = false;

    websocketClient.onConnect = this._handleConnect.bind(this);
    websocketClient.onDisconnect = this._handleDisconnect.bind(this);
    websocketClient.onError = this._handleError.bind(this);

    this._handleInitialConnect = _.once(this._handleInitialConnect);
    this._connect();
  }

  onConnect(callback) {
    this._onConnectListeners.push(callback);
  }

  onInitialConnect(callback) {
    this._onInitialConnectListeners.push(callback);
  }

  onDisconnect(callback) {
    this._onDisconnectListeners.push(callback);
  }

  _handleConnect() {
    if (this._connectionState === CONNECTION_STATE.CONNECTED) {
      return;
    }

    this._logger.info("-------------- WEBSOCKET CONNECTED");
    this._connectionState = CONNECTION_STATE.CONNECTED;
    notifyAllListeners(this._onConnectListeners);
    this._handleInitialConnect();
  }

  _handleInitialConnect() {
    notifyAllListeners(this._onInitialConnectListeners);
  }

  _handleDisconnect() {
    if (this._connectionState === CONNECTION_STATE.DISCONNECTED) {
      return;
    }

    this._logger.info("-------------- WEBSOCKET DISCONNECTED");
    this._connectionState = CONNECTION_STATE.DISCONNECTED;
    notifyAllListeners(this._onDisconnectListeners);
  }

  _handleError(err) {
    this._logger.debug("-------------- WEBSOCKET ERROR", err);
    this._connect();
  }

  async _connect() {
    if (this._connecting) {
      return;
    }
    this._connecting = true;

    const reconnect = async () => {
      try {
        // this._logger.info("Connecting websocket");
        await this._websocketClient.disconnect();
        this._handleDisconnect();
        await this._websocketClient.connect({
          auth: {headers: {authorization: `Bearer ${this._authToken}`}},
          timeout: constants.HTTP_REQUEST_TIMEOUT_MS
        });
        this._connecting = false;
      } catch (err) {
        // this._logger.error("Reconnect error");
        await Promise.delay(2000);
        reconnect();
      }
    };

    reconnect();
  }

  async request(...args) {
    if (this._connectionState === CONNECTION_STATE.DISCONNECTED) {
      throw new Error("Websocket is disconnected");
    }

    return this._websocketClient.request(...args)
  }

  async subscribe(path, callback) {
    if (this._subscriptions.has(path)) {
      return;
    }

    await this._websocketClient.subscribe(path, function () {
      callback.apply(null, arguments);
    });

    this._subscriptions.add(path);
  }
}

module.exports = DataTransportService;
