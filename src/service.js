import _ from 'lodash';
import Promise from 'bluebird';
import { config } from './config';
import constants from './constants';
import logger, {logLevels} from './services/Logger';
import {uniqueMachineId} from './helpers/machine';
import TimeService from './services/TimeService';
import CommandService from './services/CommandService';
import request from 'request-promise';

logger.setLevel(logLevels.debug);

const MIN_OPERATION_TIME = 2000;

const machineMAC = uniqueMachineId();

let SYSTEM_STATE = constants.SYSTEM_STATE.INITIAL,
  machineId;

function run() {

  let _operation;

  switch (SYSTEM_STATE) {

    case constants.SYSTEM_STATE.INITIAL:
      const body = {MAC: machineMAC};

      constants.ALL_OUTLET_TYPES.forEach((outletType) => {
        const outletsOfType = config.OUTLETS.filter((outlet) => outlet.type === outletType);
        if (outletsOfType.length === 0) return;
        body[outletType] = {};
        outletsOfType.forEach(outlet => {
          _.set(body, `${outletType}.${outlet.pin}`, outlet.internalName);
        })
      });

      _operation = request({
          method: 'POST',
          uri: `http://${config.CONDUCTOR_HOST}:${config.CONDUCTOR_PORT}/controllers`,
          body,
          json: true,
          timeout: constants.HTTP_REQUEST_TIMEOUT_MS
        })
        .then((response) => {
          logger.debug(`Received id ${response.id}`);
          machineId = response.id;
          SYSTEM_STATE = constants.SYSTEM_STATE.GOT_ID;
        });
      break;

    case constants.SYSTEM_STATE.GOT_ID:

      _operation = request({
        uri: `http://${config.CONDUCTOR_HOST}:${config.CONDUCTOR_PORT}/time`,
        json: true,
        timeout: constants.HTTP_REQUEST_TIMEOUT_MS
      })
        .then((response) => {
          TimeService.resetTime(response.time);
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
  return request({
    uri: `http://${config.CONDUCTOR_HOST}:${config.CONDUCTOR_PORT}/controllers/${machineId}/commands`,
    json: true,
    timeout: constants.HTTP_REQUEST_TIMEOUT_MS
  }).then((response) => {
    CommandService.ingestCommands(response);
  });
}

run();
