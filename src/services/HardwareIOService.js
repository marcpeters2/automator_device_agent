const _ = require('lodash');
const logger = require('./Logger');
const TimeService = require('./TimeService');
const constants = require('../constants');
const { config } = require('../config');
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

    this._pinMeta = _.fromPairs(config.OUTLETS.map(outlet => [outlet.pin, {lastSwitched: 0, state: constants.OUTLET_STATE_OFF}]));
    this._initializeSwitchingHistory();
  }


  setPinState(pinNum, state) {
    const millisNow = new Date().getTime();

    if (this._pinMeta[pinNum].state === state) {
      return;
    }
    else if(this._pinMeta[pinNum].lastSwitched + constants.OUTLET_MIN_SWITCHING_INTERVAL_MS > millisNow) {
      logger.debug(`Won't switch pin ${pinNum}: switching too fast`);
      return;
    }

    switch(state) {
      case constants.OUTLET_STATE_ON:
        this._pinMeta[pinNum].state = constants.OUTLET_STATE_ON;
        this._pinMeta[pinNum].lastSwitched = millisNow;
        logger.debug(`Pin ${pinNum} ON`);
        rpio.write(pinNum, rpio.HIGH);
        // process.stdout.write("\x1B[1;1H");
        // process.stdout.write(`Pin ${pinNum} ON`);
        break;
      case constants.OUTLET_STATE_OFF:
        this._pinMeta[pinNum].state = constants.OUTLET_STATE_OFF;
        this._pinMeta[pinNum].lastSwitched = millisNow;
        logger.debug(`Pin ${pinNum} OFF`);
        rpio.write(pinNum, rpio.LOW);
        // process.stdout.write("\x1B[1;1H");
        // process.stdout.write(`Pin ${pinNum} OFF`);
        break;
      default:
        throw new Error(`setPinState: Unknown pin state ${state}`);
    }

    this._recordSwitchingHistory(pinNum, state);
  }

  _recordSwitchingHistory(pinNum, state) {
    this._switchingHistory.push({
      outletInternalId: pinNum,
      time: new Date(TimeService.getTime()),
      state: String(state ? constants.OUTLET_STATE_ON_STRING : constants.OUTLET_STATE_OFF_STRING),
    });

    this._handleSwitchingHistoryOverflow();
  }


  _handleSwitchingHistoryOverflow() {
    const numElementsToRemove = this._switchingHistory.length - constants.MAX_OUTLET_HISTORY_ENTRIES;

    if (numElementsToRemove <= 0) {
      return;
    }

    const removedElements = this._switchingHistory.splice(0, numElementsToRemove);

    for (const removedElement of removedElements) {
      if (!_.isEmpty(this._switchingHistoryOverflow[removedElement.outletInternalId])) {
        // Overflow already occurred for this pin number, and we recorded it
        continue;
      }

      const outletHistoryUnknownFromDate = new Date(removedElement.time.getTime() + 1);
      this._switchingHistoryOverflow[removedElement.outletInternalId].push(removedElement);
      this._switchingHistoryOverflow[removedElement.outletInternalId].push({
        outletInternalId: removedElement.outletInternalId,
        time: outletHistoryUnknownFromDate,
        state: constants.OUTLET_STATE_UNKNOWN_STRING
      });

      logger.warn(`Outlet history discarded for pin ${removedElement.outletInternalId} from ${outletHistoryUnknownFromDate.toISOString()}`);
    }
  }


  _outletStateToString(state) {
    switch(state) {
      case constants.OUTLET_STATE_ON:
        return constants.OUTLET_STATE_ON_STRING;
      case constants.OUTLET_STATE_OFF:
        return constants.OUTLET_STATE_OFF_STRING;
      default:
        throw new Error(`_pinStateToString: Unknown pin state: ${state}`);
    }
  }


  getSwitchingHistory() {
    const now = TimeService.getTime(),
      currentPinStates = _.toPairs(this._pinMeta).map(([outletInternalId, pinMeta]) => ({
        outletInternalId,
        time: new Date(now),
        state: this._outletStateToString(pinMeta.state)
      }));

    return _.flatten(_.values(this._switchingHistoryOverflow)).concat(this._switchingHistory).concat(currentPinStates);
  }


  _getSwitchingHistoryExcludingOverflow() {
    return this._switchingHistory;
  }


  getLatestSwitchingHistoryTimestamp() {
    return this._switchingHistory.reduce((acc, historyItem) => {
      if (historyItem.time.getTime() < acc) {
        return acc;
      }
      return historyItem.time.getTime();
    }, 0);
  }

  _initializeSwitchingHistory() {
    this._switchingHistory = [];
    this._switchingHistoryOverflow = _.fromPairs(config.OUTLETS.map(outlet => [outlet.pin, []]));
  }


  clearSwitchingHistory(onOrBeforeTimestamp) {
    const currentSwitchingHistory = this._getSwitchingHistoryExcludingOverflow();
    this._initializeSwitchingHistory();

    currentSwitchingHistory.forEach((historyItem) => {
      if (historyItem.time.getTime() > onOrBeforeTimestamp) {
        this._switchingHistory.push(historyItem);
      }
    })
  }


  getPinState() {
    return this._pinMeta;
  }
}

const singleton = new HardwareIOService();

module.exports = singleton;
