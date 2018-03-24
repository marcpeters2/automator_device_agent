import * as _ from 'lodash';
// import * as tty from 'tty';
import logger from './Logger'
import constants from '../constants';
import { config } from '../config';

const rpio = require('rpio');


class HardwareIOService {

  constructor () {
    rpio.init({
      mapping: "physical",
      gpiomem: false
    });

    config.OUTLETS.forEach((outlet) => {
      rpio.open(outlet.pin, rpio.OUTPUT, rpio.LOW);
    });

    this._pinMeta = _.fromPairs(config.OUTLETS.map(outlet => [outlet.pin, {lastSwitched: 0, state: constants.OUTLET_OFF}]));
  }


  setPinState(pinNum, state) {
    const millisNow = new Date().getTime();

    if (this._pinMeta[pinNum].state === state) {
      // logger.debug(`Won't switch pin ${pinNum}: switching too fast`);
      return;
    }
    else if(this._pinMeta[pinNum].lastSwitched + constants.OUTLET_MIN_SWITCHING_INTERVAL_MS > millisNow) {
      logger.debug(`Won't switch pin ${pinNum}: switching too fast`);
      return;
    }

    switch(state) {
      case constants.OUTLET_ON:
        this._pinMeta[pinNum].state = constants.OUTLET_ON;
        this._pinMeta[pinNum].lastSwitched = millisNow;
        logger.debug(`Pin ${pinNum} ON`);
        rpio.write(12, rpio.HIGH);
        // process.stdout.write("\x1B[1;1H");
        // process.stdout.write(`Pin ${pinNum} ON`);
        break;
      case constants.OUTLET_OFF:
        this._pinMeta[pinNum].state = constants.OUTLET_OFF;
        this._pinMeta[pinNum].lastSwitched = millisNow;
        logger.debug(`Pin ${pinNum} OFF`);
        rpio.write(12, rpio.LOW);
        // process.stdout.write("\x1B[1;1H");
        // process.stdout.write(`Pin ${pinNum} OFF`);
        break;
      default:
        throw new Error(`setPinState: Unknown pin state ${state}`);
    }
  }


  getPinState() {
    return this._pinMeta;
  }
}

const singleton = new HardwareIOService();

export default singleton;
