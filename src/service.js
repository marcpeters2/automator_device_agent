import _ from 'lodash';
import * as fs from 'fs';
import * as path from 'path';
import Promise from 'bluebird';
import { config } from './config';
import constants from './constants';
import {getLocalIpAddresses} from './helpers/ipAddress';
import logger, {logLevels} from './services/Logger';
import TimeService from './services/TimeService';
import CommandService from './services/CommandService';
import HardwareIOService from './services/HardwareIOService';
import Nes from 'nes';

logger.setLevel(logLevels.info);

const MIN_OPERATION_TIME = 2000;
const authToken = fs.readFileSync(path.join(__dirname, "..", "/auth_token.txt"));
const softwareVersion = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "/package.json")).toString()).version;

let SYSTEM_STATE = constants.SYSTEM_STATE.INITIAL,
  lastCommandRefreshTimestamp = 0,
  nextCommandRefreshTimestamp = 0,
  websocketClient = null,
  websocketSubscriptions = {
    commandUpdates: false,
    statusUpdates: false,
  },
  machineId = null;

const onWebsocketClientConnected = () => {
  logger.info("******** WEBSOCKET CONNECTED");
};
const onWebsocketClientDisconnected = () => {
  logger.warn("******** WEBSOCKET DISCONNECTED");
  // Websocket has disconnected. When it reconnects, refresh commands immediately
  nextCommandRefreshTimestamp = TimeService.getTime();
};
const onWebsocketClientError = (err) => {
  logger.warn("******** WEBSOCKET ERROR");
  SYSTEM_STATE = constants.SYSTEM_STATE.INITIAL;
};


function run() {

  let _operation;

  switch (SYSTEM_STATE) {

    case constants.SYSTEM_STATE.INITIAL:
      _operation = Promise.resolve()
        .then(() => {
          if (websocketClient) {
            return websocketClient.disconnect();
          }
          else {
            websocketClient = new Nes.Client(`ws://${config.CONDUCTOR_HOST}:${config.CONDUCTOR_PORT}`);
            websocketClient.onConnect = onWebsocketClientConnected;
            websocketClient.onDisconnect = onWebsocketClientDisconnected;
            websocketClient.onError = onWebsocketClientError;
            return;
          }
        })
        .then(() => {
          return websocketClient.connect({
            auth: { headers: { authorization: `Bearer ${authToken}` } },
          });
        })
        .then(() => {
          SYSTEM_STATE = constants.SYSTEM_STATE.WEBSOCKET_CONNECTED;
        });
      break;

    case constants.SYSTEM_STATE.WEBSOCKET_CONNECTED:
      const payload = {};

      constants.ALL_OUTLET_TYPES.forEach((outletType) => {
        const outletsOfType = config.OUTLETS.filter((outlet) => outlet.type === outletType);
        if (outletsOfType.length === 0) return;
        payload[outletType] = {};
        outletsOfType.forEach(outlet => {
          _.set(payload, `${outletType}.${outlet.pin}`, outlet.internalName);
        })
      });

      _operation = websocketClient.request({
          method: "POST",
          path: "/controllers",
          payload,
        })
        .then(({payload: {id}}) => {
          logger.info(`Received id ${id}`);
          machineId = id;

          if (!websocketSubscriptions.statusUpdates) {
            return websocketClient.subscribe(`/controllers/${machineId}/status`, (update, flags) => {
                logger.info("****** Sending status data");
                sendStatus();
              })
              .then(() => {
                websocketSubscriptions.statusUpdates = true;
                SYSTEM_STATE = constants.SYSTEM_STATE.GOT_ID;
              });
          }
          else {
            SYSTEM_STATE = constants.SYSTEM_STATE.GOT_ID;
          }
        });
      break;

    case constants.SYSTEM_STATE.GOT_ID:
      const start = new Date().getTime();

      _operation = websocketClient.request({
        path: "/time"
      })
        .then(({payload: {time}}) => {
          const end = new Date().getTime(),
            estimatedLatency = Math.trunc((start - end) / 2);
          TimeService.resetTime(time - estimatedLatency);

          if (!websocketSubscriptions.commandUpdates) {
            return websocketClient.subscribe(`/controllers/${machineId}/commands`, (update, flags) => {
                logger.info("Received new commands from server");
                processCommands(update);
              })
              .then(() => {
                SYSTEM_STATE = constants.SYSTEM_STATE.SYNCED_TIME;
                websocketSubscriptions.commandUpdates = true;
              });
          }
          else {
            SYSTEM_STATE = constants.SYSTEM_STATE.SYNCED_TIME;
          }
        });
      break;

    case constants.SYSTEM_STATE.SYNCED_TIME:
      _operation = fetchCommands()
        .then(() => {
          CommandService.startBackgroundTask();
          SYSTEM_STATE = constants.SYSTEM_STATE.OPERATING;
        });
      break;

    case constants.SYSTEM_STATE.OPERATING:
      const now = TimeService.getTime(),
        timeSinceLastCommandRefresh = now - lastCommandRefreshTimestamp;

      if (timeSinceLastCommandRefresh < constants.COMMAND_REFRESH_MIN_INTERVAL_MS) {
        _operation = Promise.delay(500);
        break;
      }

      if (nextCommandRefreshTimestamp > now) {
        if (timeSinceLastCommandRefresh >= constants.COMMAND_REFRESH_MAX_INTERVAL_MS) {
          _operation = fetchCommands();
        }
        else {
          _operation = Promise.delay(500);
        }
      }
      else {
        _operation = fetchCommands();
      }

      break;
  }

  let operationFailed = false;

  _operation
    .catch((err) => {
      operationFailed = true;
      logger.error(err);
    })
    .then(() => {
      let delay = null;

      if (operationFailed) {
        delay = MIN_OPERATION_TIME;
      }

      return Promise.delay(delay);
    })
    .then(() => {
      logger.debug(">> NEXT OP");
      run();
    });
}


function fetchCommands() {
  return websocketClient.request({
    path: `/controllers/${machineId}/commands`,
  }).then(({payload}) => {
    logger.info("Fetched commands from server");
    processCommands(payload);
  });
}


function processCommands(payload) {
  CommandService.ingestCommands(payload);
  const now = TimeService.getTime(),
    commandRefreshTimeHint = CommandService.refreshCommandsHint();
  lastCommandRefreshTimestamp = now;
  nextCommandRefreshTimestamp = Math.max(now + constants.COMMAND_REFRESH_MIN_INTERVAL_MS, commandRefreshTimeHint);

  logger.info(`Next command retrieval: +${Math.trunc((nextCommandRefreshTimestamp - now)/1000)} seconds`)
}


function sendStatus() {
  const payload = {
    softwareVersion,
    deviceTime: new Date().toISOString(),
    applicationTime: new Date(TimeService.getTime()).toISOString(),
    ipAddresses: getLocalIpAddresses(),
    commands: CommandService.getCommands(),
    pinState: HardwareIOService.getPinState(),
    recentLogs: logger.getHistory()
  };

  return websocketClient.request({
      method: "POST",
      path: `/controllers/${machineId}/status`,
      payload,
    })
    .catch((err) => {
      logger.error("**** Failed to send status");
      logger.error(err);
    });
}

run();
