import _ from 'lodash';
import * as fs from 'fs';
import * as path from 'path';
import Promise from 'bluebird';
import { config } from './config';
import constants from './constants';
import {getLocalIpAddresses} from './helpers/ipAddress';
import {subscribeOnce} from "./helpers/websocket";
import logger, {logLevels} from './services/Logger';
import TimeService from './services/TimeService';
import CommandService from './services/CommandService';
import HardwareIOService from './services/HardwareIOService';
import Nes from 'nes';

logger.setLevel(logLevels.info);

const MIN_OPERATION_TIME = 2000;
const authToken = fs.readFileSync(path.join(__dirname, "..", "/auth_token.txt"));
const softwareVersion = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "/package.json")).toString()).version;

let SYSTEM_STATE = null,
  lastCommandRefreshTimestamp = 0,
  nextCommandRefreshTimestamp = 0,
  websocketClient = null,
  machineId = null;


function transitionTo(state) {
  logger.info(`>>> Transitioning to state ${state}`);
  SYSTEM_STATE = state;
}


transitionTo(constants.SYSTEM_STATE.INITIALIZING);

function run() {

  let _operation;

  switch (SYSTEM_STATE) {
    case constants.SYSTEM_STATE.INITIALIZING:
      _operation = Promise.resolve()
        .then(() => {
          websocketClient = new Nes.Client(`ws://${config.CONDUCTOR_HOST}:${config.CONDUCTOR_PORT}`, {
            timeout: constants.HTTP_REQUEST_TIMEOUT_MS
          });
          websocketClient.onConnect = () => {
            logger.info("******** WEBSOCKET CONNECTED");
          };
          websocketClient.onDisconnect = () => {
            logger.warn("******** WEBSOCKET DISCONNECTED");
            // Websocket has disconnected. When it reconnects, refresh commands immediately
            nextCommandRefreshTimestamp = TimeService.getTime();
          };
          websocketClient.onError = (err) => {
            logger.warn("******** WEBSOCKET ERROR");
            transitionTo(constants.SYSTEM_STATE.CONNECTING_WEBSOCKET);
          };

          transitionTo(constants.SYSTEM_STATE.CONNECTING_WEBSOCKET);
        });
      break;

    case constants.SYSTEM_STATE.CONNECTING_WEBSOCKET:
      _operation =  websocketClient.disconnect()
        .then(() => {
          return websocketClient.connect({
            auth: {headers: {authorization: `Bearer ${authToken}`}},
            timeout: constants.HTTP_REQUEST_TIMEOUT_MS
          });
        })
        .then(() => transitionTo(constants.SYSTEM_STATE.PUBLISHING_CAPABILITIES));
      break;

    case constants.SYSTEM_STATE.PUBLISHING_CAPABILITIES:
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

          return subscribeOnce(websocketClient, `/controllers/${machineId}/status`, (update, flags) => {
              logger.info("****** Sending status data");
              sendStatus();
            })
            .then(() => transitionTo(constants.SYSTEM_STATE.SYNCING_TIME));
        });
      break;

    case constants.SYSTEM_STATE.SYNCING_TIME:
      const start = new Date().getTime();

      _operation = websocketClient.request({
        path: "/time"
      })
        .then(({payload: {time}}) => {
          const end = new Date().getTime(),
            estimatedLatency = Math.trunc((start - end) / 2);
          TimeService.resetTime(time - estimatedLatency);

         subscribeOnce(websocketClient, `/controllers/${machineId}/commands`, (update, flags) => {
              logger.info("Received new commands from server");
              processCommands(update);
            })
            .then(() => transitionTo(constants.SYSTEM_STATE.STARTING_IO_TASK));
        });
      break;

    case constants.SYSTEM_STATE.STARTING_IO_TASK:
      _operation = fetchCommands()
        .then(() => {
          CommandService.startBackgroundTask();
          transitionTo(constants.SYSTEM_STATE.OPERATING);
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
