import constants  from '../constants';
import sleep  from '../helpers/sleep';
import {logger} from '../services/Logger';
import timeService  from '../services/TimeService';
import {StateMachine} from "../services/StateMachine";


export type HeartbeatStateMachineInterface = {
  onHeartbeat: (callback: (heartbeatTimestamp: number) => unknown) => void;
}

export function buildHeartbeatStateMachine(machineId: number, websocketService: any) {
  let lastHeartbeatTimestamp = 0;
  let _onHeartbeat = (_: number) => {};

  const externalInterface: HeartbeatStateMachineInterface = {
    onHeartbeat(callback: (heartbeatTimestamp: number) => any) {
      _onHeartbeat = callback
    }
  };

  const stateMachine = new StateMachine({logger, name: "Heartbeat", externalInterface});


  function shouldHeartbeat() {
    const now = timeService.getTime(),
      timeSinceLastHeartbeat = now - lastHeartbeatTimestamp;

    if (timeSinceLastHeartbeat < constants.HEARTBEAT_MIN_INTERVAL_MS) {
      return false;
    } else if (timeSinceLastHeartbeat >= constants.HEARTBEAT_MAX_INTERVAL_MS) {
      return true;
    }
    return false;
  }


  stateMachine.addHandlerForState(constants.HEARTBEAT_STATE.WAITING, async ({changeState}) => {
    if (shouldHeartbeat()) {
      return changeState(constants.HEARTBEAT_STATE.SENDING_HEARTBEAT);
    } else {
      await sleep(1000);
    }
  });

  stateMachine.addHandlerForState(constants.HEARTBEAT_STATE.SENDING_HEARTBEAT, async ({changeState}) => {
    try {
      await websocketService.request({method: "POST", path: `/controllers/${machineId}/heartbeat`});
      logger.debug("Heartbeat");
      lastHeartbeatTimestamp = timeService.getTime();
      _onHeartbeat(lastHeartbeatTimestamp);
    } catch (err) {
      logger.error("**** Error sending heartbeat");
      throw err;
    }

    return changeState(constants.HEARTBEAT_STATE.WAITING);
  });

  stateMachine.changeState(constants.HEARTBEAT_STATE.WAITING);

  return stateMachine;
}
