import _ from 'lodash';
import Promise from 'bluebird';
const rpio = require('rpio');
import { config } from './config';
import constants from './constants';
import {uniqueMachineId} from './helpers/machine';
import request from 'request-promise';

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
  networkTime;


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
          machineId = response.id;
          SYSTEM_STATE = constants.SYSTEM_STATE.GOT_ID;
          console.log(response);
        });
      break;

    case constants.SYSTEM_STATE.GOT_ID:

      _operation = request({
        uri: `http://${config.CONDUCTOR_HOST}:${config.CONDUCTOR_PORT}/time`,
        json: true
      })
        .then((response) => {
          networkTime = response.time;
          SYSTEM_STATE = constants.SYSTEM_STATE.SYNCED_TIME;
          console.log(response);
        });
      break;

    case constants.SYSTEM_STATE.SYNCED_TIME:
      _operation = Promise.resolve();
      console.log("tick");
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


run();
