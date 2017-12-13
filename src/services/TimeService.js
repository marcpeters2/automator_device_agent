import logger from './Logger';


export default class TimeService {

  constructor () {
    this._millisOffset = 0;
  }

  resetTime(now) {
    logger.debug(`Setting time to ${now}.  Current machine time is ${new Date().getTime()}.`);
    this._millisOffset = now - new Date().getTime();
    logger.debug(`New time offset is ${this._millisOffset}ms`);
  }

  getTime() {
    return new Date().getTime() + this._millisOffset;
  }

}
