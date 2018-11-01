const sleep = require("../helpers/sleep");
const MIN_OPERATION_TIME = 2000;

class StateMachine {
  constructor({logger}) {
    this._logger = logger;
    this._state = null;
    this._stateHandlers = {};
  }

  addHandlerForState(state, handler) {
    this._stateHandlers[state] = handler;
  }

  changeState(newState) {
    if (this._state === newState) { return; }

    this._logger.info(`>>> Transitioning to state ${newState}`);
    this._state = newState;
  }

  async runForever() {
    while (true) {
      try {
        await this._executeHandlerForCurrentState();
      } catch (err) {
        this._logger.error(err);
        await sleep(MIN_OPERATION_TIME);
      }
    }
  }

  async _executeHandlerForCurrentState() {
    const operation = this._stateHandlers[this._state];

    if (!operation) {
      throw new Error(`No handler is registered for state ${this._state}`);
    }

    await operation({changeState: this.changeState.bind(this)});
  }
}

module.exports = StateMachine;
