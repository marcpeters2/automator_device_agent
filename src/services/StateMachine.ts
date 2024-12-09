import * as _ from "lodash";
import {Logger} from "./Logger";
import {notifyAllListenersAsync} from "../helpers/events";

import sleep from "../helpers/sleep";
const PAUSE_AFTER_ERROR_MS = 2000;

export enum StateChangePriority {
  NORMAL,
  HIGHEST
}

export type StateHandlerArgs = {changeState: typeof StateMachine.prototype.changeState};
type StateHandler = (args: StateHandlerArgs) => Promise<unknown>;

type StateHandlers = {
  [key: string | symbol]: StateHandler
}

type StateTransitionHandler = () => Promise<void>;

type StateTransitionHandlers = {
  [key: string | symbol]: {
    [key: string | symbol]: StateTransitionHandler
  }
}

type ErrorListener = (error: Error) => (void | Promise<void>);

type CurrentState = string | symbol;

type DesiredState = {
  state: string,
  priority: StateChangePriority
} | null;

type StateChangeOptions = {
  priority?: StateChangePriority
}

function toString(currentState: CurrentState) {
  return String(currentState);
}

export class StateMachine<T = {}> {
  private _logger: Logger;
  private readonly _logLinePrefix: string;

  private _state: CurrentState = StateMachine.INITIAL_STATE;
  private _desiredState: DesiredState = null;
  private readonly _stateHandlers: StateHandlers = {};
  private readonly _stateTransitionHandlers: StateTransitionHandlers = {};
  private readonly _onErrorListeners: ErrorListener[] = [];

  private _running: boolean = false;
  private _stopped: boolean = false;
  private _onStopListener: () => void = () => {};

  private _internals: T | undefined;

  static ANY_STATE = Symbol();
  static INITIAL_STATE = Symbol();

  constructor({logger, name = "Unnamed", externalInterface}: {logger: Logger, name?: string, externalInterface?: T}) {
    this._logger = logger;
    this._logLinePrefix = `-------------- ${name} `.padEnd(30, "-");
    this._internals = externalInterface;
  }

  addHandlerForState(state: string, handler: StateHandler) {
    this._stateHandlers[state] = handler;
  }

  addHandlerForStateTransition({from, to}: {from: string | symbol, to: string | symbol}, handler: StateTransitionHandler) {
    _.set(this._stateTransitionHandlers, [from , to], handler);
  }

  changeState(newState: string, options?: StateChangeOptions) {
    if (this._desiredState?.state === newState) {
      this._logger.info(`${this._logLinePrefix} Duplicate request to transition to state ${newState}.`);
    }

    if (options?.priority === StateChangePriority.HIGHEST || !(this._desiredState?.priority === StateChangePriority.HIGHEST)) {
      const newPriority = options?.priority || StateChangePriority.NORMAL;
      this._desiredState = {state: newState, priority: newPriority};
    }
  }
  
  private async _transitionToState(currentState: CurrentState, desiredState: DesiredState) {
    if (!desiredState) {
      return;
    } else if (currentState === desiredState.state) {
      return;
    }

    try {
      const someoneIsListeningForTransitionFromCurrentState =
        !!_.get(this._stateTransitionHandlers, [currentState, StateMachine.ANY_STATE]);
      const someoneIsListeningForTransitionBetweenStates =
        !!_.get(this._stateTransitionHandlers, [currentState, desiredState.state]);
      const someoneIsListeningForTransitionToState =
          !!_.get(this._stateTransitionHandlers, [StateMachine.ANY_STATE, desiredState.state]);

      if (someoneIsListeningForTransitionFromCurrentState
          || someoneIsListeningForTransitionBetweenStates
          || someoneIsListeningForTransitionToState) {
        this._logger.info(`${this._logLinePrefix} Transitioning from state ${toString(currentState)} to state ${desiredState.state}`);
      }
      if (someoneIsListeningForTransitionFromCurrentState) {
        await this._stateTransitionHandlers[currentState][StateMachine.ANY_STATE]();
      }
      if (someoneIsListeningForTransitionBetweenStates) {
        await this._stateTransitionHandlers[currentState][desiredState.state]();
      }
      if (someoneIsListeningForTransitionToState) {
        await this._stateTransitionHandlers[StateMachine.ANY_STATE][desiredState.state]();
      }

      this._logger.info(`${this._logLinePrefix} State ${desiredState.state}`);
      this._state = desiredState.state;
    } catch (err) {
      this._logger.error(`${this._logLinePrefix} Error transitioning to state ${desiredState.state}`);
      this._logger.error(err);
    } finally {
      this._desiredState = null;
    }
  }

  async run() {
    if (this._running) {
      throw new Error("Can't start state machine since it is already running");
    }

    this._running = true;
    this._stopped = false;

    while (!this._stopped) {
      try {

        if (this._desiredState) {
          await this._transitionToState(this._state, this._desiredState);
        }

        await this._executeHandlerForState(this._state);
      } catch (error: any) {
        await this._handleError(error);
        await sleep(PAUSE_AFTER_ERROR_MS);
      }
    }

    this._onStopListener();
  }

  async stop() {
    this._logger.info(`${this._logLinePrefix} Stopping`);

    return new Promise<void>((resolve) => {
      this._onStopListener = () => {
        this._logger.info(`${this._logLinePrefix} Stopped`);
        resolve();
      };
      this._stopped = true;
    });
  }

  private async _executeHandlerForState(state: CurrentState) {
    const operation = this._stateHandlers[state];

    if (!operation) {
      throw new Error(`No handler is registered for state ${toString(state)}`);
    }

    await operation({changeState: this.changeState.bind(this)});
  }

  interface() {
    if (this._internals === undefined) {
      throw new Error(`State machine has no interface`);
    }

    return this._internals;
  }

  onError(listener: ErrorListener) {
    this._onErrorListeners.push(listener);
  }

  private async _handleError(error: any) {
    await notifyAllListenersAsync(this._onErrorListeners, error);

    if (this._onErrorListeners.length === 0) {
      this._logger.error(`${this._logLinePrefix} Unexpected error`);
      this._logger.error(error);
    }
  }
}
