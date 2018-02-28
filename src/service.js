import _ from 'lodash';
import * as fs from 'fs';
import * as path from 'path';
import Promise from 'bluebird';
import { config } from './config';
import constants from './constants';
import logger, {logLevels} from './services/Logger';
import TimeService from './services/TimeService';
import CommandService from './services/CommandService';
import Nes from 'nes';

logger.setLevel(logLevels.debug);

const MIN_OPERATION_TIME = 2000;
const websocketClient = new Nes.Client(`ws://${config.CONDUCTOR_HOST}:${config.CONDUCTOR_PORT}`);
const authToken = fs.readFileSync(path.join(__dirname, "..", "/auth_token.txt"));

let SYSTEM_STATE = constants.SYSTEM_STATE.INITIAL,
  lastCommandRefreshTimestamp = 0,
  nextCommandRefreshTimestamp = new Date().getTime(),
  machineId;

websocketClient.onConnect = () => {
  if (SYSTEM_STATE === constants.SYSTEM_STATE.OPERATING) {
    nextCommandRefreshTimestamp = new Date().getTime(); // Refresh commands now
  }
};

function run() {

  let _operation;

  switch (SYSTEM_STATE) {

    case constants.SYSTEM_STATE.INITIAL:
      _operation = websocketClient.connect({
        auth: { headers: { authorization: `Bearer ${authToken}` } },
        timeout: constants.HTTP_REQUEST_TIMEOUT_MS,
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
          logger.debug(`Received id ${id}`);
          machineId = id;
          SYSTEM_STATE = constants.SYSTEM_STATE.GOT_ID;
        });
      break;

    case constants.SYSTEM_STATE.GOT_ID:

      _operation = websocketClient.request({
        path: "/time"
      })
        .then(({payload: {time}}) => {
          TimeService.resetTime(time);
          websocketClient.subscribe(`/controllers/${machineId}/commands`, (update, flags) => {
            processCommands(update);
          });
          SYSTEM_STATE = constants.SYSTEM_STATE.SYNCED_TIME;
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
        _operation = Promise.delay(100);
        break;
      }

      if (nextCommandRefreshTimestamp > now) {
        if (timeSinceLastCommandRefresh >= constants.COMMAND_REFRESH_MAX_INTERVAL_MS) {
          _operation = fetchCommands();
        }
        else {
          _operation = Promise.delay(100);
        }
      }
      else {
        _operation = fetchCommands();
      }

      break;
  }

  const start = new Date().getTime();
  let operationFailed = false;

  _operation
    .catch((err) => {
      operationFailed = true;
      console.log(err);
    })
    .then(() => {
      const end = new Date().getTime(),
        operationTime = end - start;
      let delay = null;
      //
      // if (SYSTEM_STATE !== constants.SYSTEM_STATE.OPERATING && !operationFailed) {
      //   delay = 0;
      // }
      // else {
      //   delay = Math.max(MIN_OPERATION_TIME - operationTime, 0);
      // }

      if (operationFailed) {
        delay = 2000;
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
    processCommands(payload);
  });
}

function processCommands(payload) {
  CommandService.ingestCommands(payload);
  const now = TimeService.getTime(),
    commandRefreshTimeHint = CommandService.refreshCommandsHint();
  lastCommandRefreshTimestamp = now;
  nextCommandRefreshTimestamp = Math.max(now + constants.COMMAND_REFRESH_MIN_INTERVAL_MS, commandRefreshTimeHint);

  logger.debug(`Next commands will be retreived in ${Math.trunc((nextCommandRefreshTimestamp - now)/1000)} seconds`)
}

run();
