import logger from './Logger'
import constants from '../constants';

const rpio = require('rpio');

class HardwareIOService {

  setPinState(pinNum, state) {
    switch(state) {
      case constants.OUTLET_ON:
        logger.debug(`Pin ${pinNum} ON`);
        break;
      case constants.OUTLET_OFF:
        logger.debug(`Pin ${pinNum} OFF`);
        break;
      default:
        throw new Error(`setPinState: Unknown pin state ${state}`);
    }
  }
}

const singleton = new HardwareIOService();

export default singleton;
