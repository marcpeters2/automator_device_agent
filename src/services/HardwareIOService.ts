import * as _ from "lodash";
import {logger} from "./Logger";
import TimeService from "./TimeService";
import constants, {OutletState, OutletStateString} from "../constants";
import {config} from "../config";
// @ts-ignore
import rpio from "rpio";

type PinMetadata = {
  // Object is keyed by pin number
  [key: number]: {
    lastSwitched: number,
    state: OutletState
  }
};

type SwitchingEvent = {
  outletInternalId: number,
  time: Date,
  state: OutletStateString
};

type SwitchingHistoryOverflow = {
  // Object is keyed by pin number (outlet internal id)
  [key: number]: SwitchingEvent[]
};


class HardwareIOService {
  private readonly _pinMeta: PinMetadata;
  private _switchingHistory: SwitchingEvent[] = [];
  private _switchingHistoryOverflow: SwitchingHistoryOverflow = {};

  constructor () {
    rpio.init({
      mapping: "physical",
      gpiomem: false
    });

    config.OUTLETS.forEach((outlet) => {
      rpio.open(outlet.pin, rpio.OUTPUT, rpio.LOW);
    });

    this._pinMeta = _.fromPairs(config.OUTLETS.map(outlet => [outlet.pin, {lastSwitched: 0, state: OutletState.OFF}]));
    this._initializeSwitchingHistory();
  }


  setPinState(pinNum: number, state: OutletState) {
    const millisNow = new Date().getTime();

    if (this._pinMeta[pinNum].state === state) {
      return;
    }
    else if(this._pinMeta[pinNum].lastSwitched + constants.OUTLET_MIN_SWITCHING_INTERVAL_MS > millisNow) {
      logger.debug(`Won't switch pin ${pinNum}: switching too fast`);
      return;
    }

    switch(state) {
      case OutletState.ON:
        this._pinMeta[pinNum].state = OutletState.ON;
        this._pinMeta[pinNum].lastSwitched = millisNow;
        logger.debug(`Pin ${pinNum} ON`);
        rpio.write(pinNum, rpio.HIGH);
        // process.stdout.write("\x1B[1;1H");
        // process.stdout.write(`Pin ${pinNum} ON`);
        break;
      case OutletState.OFF:
        this._pinMeta[pinNum].state = OutletState.OFF;
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

  _recordSwitchingHistory(pinNum: number, state: OutletState) {
    this._switchingHistory.push({
      outletInternalId: pinNum,
      time: new Date(TimeService.getTime()),
      state: state ? OutletStateString.ON : OutletStateString.OFF
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
        state: OutletStateString.UNKNOWN
      });

      logger.warn(`Outlet history discarded for pin ${removedElement.outletInternalId} from ${outletHistoryUnknownFromDate.toISOString()}`);
    }
  }


  _outletStateToString(state: OutletState) {
    switch(state) {
      case OutletState.ON:
        return OutletStateString.ON;
      case OutletState.OFF:
        return OutletStateString.OFF;
      default:
        throw new Error(`_pinStateToString: Unknown pin state: ${state}`);
    }
  }


  getSwitchingHistory() {
    const now = TimeService.getTime(),
      currentPinStates = _.toPairs(this._pinMeta).map(([outletInternalId, pinMeta]) => ({
        outletInternalId: Number(outletInternalId),
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


  clearSwitchingHistory(onOrBeforeTimestamp: number) {
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

export default singleton;
