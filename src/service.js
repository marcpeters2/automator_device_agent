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
  machineId;

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
            CommandService.ingestCommands(update);
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
      _operation = fetchCommands();
      break;
  }

  const start = new Date().getTime();
  _operation
    .catch((err) => {
      console.log(err);
    })
    .then(() => {
      const end = new Date().getTime(),
        operationTime = end - start;

      const delay = Math.max(MIN_OPERATION_TIME - operationTime, 0);
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
    CommandService.ingestCommands(payload);
  });
}

run();
