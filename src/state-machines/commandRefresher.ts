import sleep from '../helpers/sleep';
import {StateMachine} from "../services/StateMachine";
import {logger} from "../services/Logger";
import constants from "../constants";
import timeService from "../services/TimeService";
import commandService from "../services/CommandService";


export function buildCommandRefresherStateMachine(machineId: number, websocketService: any) {
  const stateMachine = new StateMachine({logger, name: "Commands"});

  let lastCommandRefreshTimestamp = 0,
    nextCommandRefreshTimestamp = 0;


  function shouldRequestNewCommands() {
    const now = timeService.getTime(),
      timeSinceLastCommandRefresh = now - lastCommandRefreshTimestamp;

    if (timeSinceLastCommandRefresh < constants.COMMAND_REFRESH_MIN_INTERVAL_MS) {
      return false;
    }

    if (nextCommandRefreshTimestamp <= now) {
      return true;
    } else if (timeSinceLastCommandRefresh >= constants.COMMAND_REFRESH_MAX_INTERVAL_MS) {
      return true;
    }

    return false;
  }


  stateMachine.addHandlerForState(constants.COMMAND_REFRESHER_STATE.WAITING, async ({changeState}) => {
    if (shouldRequestNewCommands()) {
      return changeState(constants.COMMAND_REFRESHER_STATE.FETCHING_COMMANDS);
    } else {
      await sleep(100);
    }
  });

  stateMachine.addHandlerForState(constants.COMMAND_REFRESHER_STATE.FETCHING_COMMANDS, async ({changeState}) => {
    await commandService.fetchAndProcessCommands(machineId, websocketService);

    const now = timeService.getTime(),
      commandRefreshTimeHint = commandService.refreshCommandsHint();
    lastCommandRefreshTimestamp = now;
    nextCommandRefreshTimestamp = Math.max(now + constants.COMMAND_REFRESH_MIN_INTERVAL_MS, commandRefreshTimeHint);

    logger.info(`Next command retrieval: +${Math.trunc((nextCommandRefreshTimestamp - now)/1000)} seconds`);

    return changeState(constants.COMMAND_REFRESHER_STATE.WAITING);
  });

  stateMachine.changeState(constants.COMMAND_REFRESHER_STATE.WAITING);

  return stateMachine;
}
