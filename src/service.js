import _ from 'lodash';
import * as fs from 'fs';
import * as path from 'path';
import * as childProcess from 'child_process';
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
const bootTime = new Date();
const commitHash = childProcess.execSync('git rev-parse HEAD').toString().trim();

let SYSTEM_STATE = null,
  lastCommandRefreshTimestamp = 0,
  nextCommandRefreshTimestamp = 0,
  lastHearbeatTimestamp = 0,
  lastOutletHistoryReportTimestamp = 0,
  websocketClient = null,
  machineId = null;


function transitionTo(state) {
  if (SYSTEM_STATE === state) { return; }

  logger.info(`>>> Transitioning to state ${state}`);
  SYSTEM_STATE = state;
}


function sleep(ms) {
  return Promise.delay(ms);
}


function shouldRequestNewCommands() {
  const now = TimeService.getTime(),
    timeSinceLastCommandRefresh = now - lastCommandRefreshTimestamp;

  if (timeSinceLastCommandRefresh < constants.COMMAND_REFRESH_MIN_INTERVAL_MS) {
    return false;
  }

  if (nextCommandRefreshTimestamp <= now) {
    return true;
  } else if (timeSinceLastCommandRefresh >= constants.COMMAND_REFRESH_MAX_INTERVAL_MS) {
    return true;
  }

  return false;
}


function shouldHeartbeat() {
  const now = TimeService.getTime(),
    timeSinceLastHeartbeat = now - lastHearbeatTimestamp;

  if (timeSinceLastHeartbeat < constants.HEARTBEAT_MIN_INTERVAL_MS) {
    return false;
  } else if (timeSinceLastHeartbeat >= constants.HEARTBEAT_MAX_INTERVAL_MS) {
    return true;
  }
  return false;
}


function shouldSendOutletHistory() {
  const now = TimeService.getTime(),
    timeSinceLastOutletHistoryWasSent = now - lastOutletHistoryReportTimestamp;

  if (timeSinceLastOutletHistoryWasSent < constants.OUTLET_HISTORY_REPORT_INTERVAL_MS) {
    return false;
  } else if (timeSinceLastOutletHistoryWasSent >= constants.OUTLET_HISTORY_REPORT_INTERVAL_MS) {
    return true;
  }
  return false;
}


transitionTo(constants.SYSTEM_STATE.INITIALIZING);

function run() {

  let _operation;

  switch (SYSTEM_STATE) {
    case constants.SYSTEM_STATE.INITIALIZING:
      _operation = Promise.resolve()
        .then(() => {
          const websocketProtocol = config.USE_SECURE_WEBSOCKETS === false ? "ws" : "wss";
          websocketClient = new Nes.Client(`${websocketProtocol}://${config.API_HOST}:${config.API_PORT}`, {
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
      if (shouldRequestNewCommands()) {
        _operation = fetchCommands();
      } else if (shouldHeartbeat()) {
        _operation = heartbeat();
      } else if (shouldSendOutletHistory()) {
        _operation = reportOutletHistory();
      } else {
        _operation = sleep(500);
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

      return sleep(delay);
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
  }).catch((err) => {
    logger.error("**** Error fetching commands");
    throw err;
  });
}


function heartbeat() {
  return websocketClient.request({
    path: `/controllers/${machineId}/heartbeat`,
    method: "POST"
  }).then(() => {
    logger.debug("Heartbeat");
    lastHearbeatTimestamp = TimeService.getTime();
  }).catch((err) => {
    logger.error("**** Error sending heartbeat");
    throw err;
  });
}


function reportOutletHistory() {
  const outletHistory = HardwareIOService.getSwitchingHistory();
  const cutoffTimestamp = HardwareIOService.getLatestSwitchingHistoryTimestamp();

  if (outletHistory.length === 0) {
    return Promise.resolve();
  }

  return websocketClient.request({
    path: `/controllers/${machineId}/outlets/history`,
    method: "POST",
    payload: {history: outletHistory}
  }).then(() => {
    logger.info(`Sent outlet history (${outletHistory.length} records)`);
    HardwareIOService.clearSwitchingHistory(cutoffTimestamp);
    lastOutletHistoryReportTimestamp = TimeService.getTime();
  }).catch((err) => {
    if (_.get(err, "data.statusCode") === 422) {
      // Server already saw some of the history records that we sent.  This is OK.
      logger.info(`Sent outlet history (${outletHistory.length} records)`);
      logger.warn("Server indicated that some outlet history records were already seen");
      HardwareIOService.clearSwitchingHistory(cutoffTimestamp);
      lastOutletHistoryReportTimestamp = TimeService.getTime();
      return;
    }
    logger.error("**** Error sending outlet history");
    throw err;
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
    commitHash,
    bootTime: bootTime.toISOString(),
    deviceTime: new Date().toISOString(),
    applicationTime: new Date(TimeService.getTime()).toISOString(),
    lastHeartbeat: new Date(lastHearbeatTimestamp).toISOString(),
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
