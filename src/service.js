import _ from 'lodash';
import Promise from 'bluebird';
const rpio = require('rpio');
import { config } from './config';
import constants from './constants';
import logger, {logLevels} from './services/Logger';
import {uniqueMachineId} from './helpers/machine';
import TimeService from './services/TimeService';
import request from 'request-promise';

const timeService = new TimeService();

logger.setLevel(logLevels.debug);

const MIN_OPERATION_TIME = 2000,
  outlets = [
    {internalName: "A", type: constants.OUTLET_TYPE_ELECTRIC, pin: 0},
    {internalName: "B", type: constants.OUTLET_TYPE_ELECTRIC, pin: 1},
    {internalName: "C", type: constants.OUTLET_TYPE_HYDRAULIC, pin: 2},
    {internalName: "D", type: constants.OUTLET_TYPE_HYDRAULIC, pin: 3},
  ];
const machineMAC = uniqueMachineId();

let SYSTEM_STATE = constants.SYSTEM_STATE.INITIAL,
  machineId,
  commands,
  commandExecutorRunning = false;


function run() {

  let _operation;

  switch (SYSTEM_STATE) {

    case constants.SYSTEM_STATE.INITIAL:
      const body = {MAC: machineMAC};

      constants.ALL_OUTLET_TYPES.forEach((outletType) => {
        const outletsOfType = outlets.filter((outlet) => outlet.type === outletType);
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
          json: true
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
        json: true
      })
        .then((response) => {
          timeService.resetTime(response.time);
          SYSTEM_STATE = constants.SYSTEM_STATE.SYNCED_TIME;
        });
      break;

    case constants.SYSTEM_STATE.SYNCED_TIME:
      _operation = fetchCommands()
        .then(() => {
          execCommands();
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


function execCommands() {
  if(commandExecutorRunning) return;
  commandExecutorRunning = true;

  let nextExecutionTime = new Date().getTime(),
    executionInterval = 100;

  const pinOff = (pinNum) => {
    logger.debug(`Pin ${pinNum} OFF`);
  }

  const pinOn = (pinNum) => {
    logger.debug(`Pin ${pinNum} ON`);
  }

  const executor = function () {
    const now = timeService.getTime();
    logger.debug(`Executing commands.  Time: ${now}`);

    outlets.forEach((outlet) => {
      const commandsForOutlet = commands[outlet.pin];

      if(!commandsForOutlet) {
        pinOff(outlet.pin);
        return;
      }

      let activeCommand = null;

      for(let i = 0; i < commandsForOutlet.length; i++) {
        const commandTime = new Date(commandsForOutlet[i].time).getTime();
        const nextCommandTime = i + 1 >= commandsForOutlet.length ?
          Number.MAX_SAFE_INTEGER :
          new Date(commandsForOutlet[i + 1].time).getTime();

        if(now >= commandTime && now < nextCommandTime) {
          activeCommand = commandsForOutlet[i];
        }
      }

      if(activeCommand) {
        switch (activeCommand.state) {
          case constants.OUTLET_OFF:
            pinOff(outlet.pin);
            break;
          case constants.OUTLET_ON:
            pinOn(outlet.pin);
            break;
          default:
            logger.error(`Command specifies an invalid outlet state: ${activeCommand}`);
            break;
        }
      }
      else {
        pinOff(outlet.pin);
        return;
      }

    });

    nextExecutionTime += executionInterval;
    const delay = nextExecutionTime - new Date().getTime();
    setTimeout(executor, delay);
  }

  executor();
}

function fetchCommands() {
  return request({
    uri: `http://${config.CONDUCTOR_HOST}:${config.CONDUCTOR_PORT}/controllers/${machineId}/commands`,
    json: true
  }).then((response) => {
    commands = response;
    logger.debug(response);
  });
}

run();
