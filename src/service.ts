import childProcess from "child_process";
import fs from "fs";
import path from "path";
import * as _ from 'lodash';
import constants from "./constants";
import {StateChangePriority, StateHandlerArgs, StateMachine} from "./services/StateMachine";
import {config} from './config';
import {getLocalIpAddresses} from './helpers/ipAddress';
import {logger} from "./services/Logger";
import sleep from './helpers/sleep';
import CommandService from './services/CommandService';
import HardwareIOService from './services/HardwareIOService';
import {PostControllersPayload} from "./types/api";
import {HardwareCommands} from "./types/commands";
import TimeService from "./services/TimeService";
import {HeartbeatStateMachineInterface} from "./state-machines/heartbeat";
import {buildCommandRefresherStateMachine} from './state-machines/commandRefresher';
import {buildHeartbeatStateMachine} from './state-machines/heartbeat';
// @ts-ignore
import {WebsocketClient} from 'websocket-transport';
import assert from "assert";

const {logLevels} = logger;

const stateMachine = new StateMachine({logger, name: "Root"});

logger.setLevel(logLevels.info);

const authToken = fs.readFileSync(path.join(__dirname, "..", "/auth_token.txt")).toString().trim();
const softwareVersion = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "/package.json")).toString()).version;
const bootTime = new Date();
const commitHash = childProcess.execSync('git rev-parse HEAD').toString().trim();

function abort() {
  stateMachine.changeState(constants.SYSTEM_STATE.INITIALIZING, {priority: StateChangePriority.HIGHEST});
}

const websocketService = new WebsocketClient({config, logger, host: config.API_HOST, port: config.API_PORT, useSsl: config.USE_SSL});
websocketService.onDisconnect(() => {
  abort();
});


let lastOutletHistoryReportTimestamp = 0,
  lastHeartbeatTimestamp = 0,
  lastSensorReportTimestamp = 0,
  machineId: number | null = null,
  commandRefresherStateMachine: StateMachine | null = null,
  heartbeatStateMachine: StateMachine<HeartbeatStateMachineInterface> | null,
  didSignalBoot = false;


function shouldSendOutletHistory() {
  const now = TimeService.getTime(),
    timeSinceLastOutletHistoryWasSent = now - lastOutletHistoryReportTimestamp;

  if (timeSinceLastOutletHistoryWasSent < constants.OUTLET_HISTORY_REPORT_INTERVAL_MS) {
    return false;
  } else if (timeSinceLastOutletHistoryWasSent >= constants.OUTLET_HISTORY_REPORT_INTERVAL_MS) {
    return true;
  }
  return false;
}

stateMachine.addHandlerForState(constants.SYSTEM_STATE.INITIALIZING, async ({changeState}: StateHandlerArgs) => {
  if (!websocketService.connected) {
    return sleep(200);
  }

  return changeState(constants.SYSTEM_STATE.AUTHENTICATING);
});


stateMachine.addHandlerForState(constants.SYSTEM_STATE.AUTHENTICATING, async ({changeState}) => {
  await websocketService.authenticate(authToken);
  return changeState(constants.SYSTEM_STATE.PUBLISHING_CAPABILITIES);
});


stateMachine.addHandlerForState(constants.SYSTEM_STATE.PUBLISHING_CAPABILITIES, async ({changeState}) => {
  const payload: PostControllersPayload = {};

  constants.ALL_OUTLET_TYPES.forEach((outletType) => {
    const outletsOfType = config.OUTLETS.filter((outlet) => outlet.type === outletType);
    if (outletsOfType.length === 0) return;
    payload[outletType] = {};
    outletsOfType.forEach(outlet => {
      _.set(payload, `${outletType}.${outlet.pin}`, outlet.internalName);
    })
  });

  const {payload: {id}} = await websocketService.request({method: "POST", path: "/controllers", payload});

  logger.info(`Received id ${id}`);
  machineId = id;

  websocketService.subscribe(constants.SERVER_EVENTS.SEND_STATUS, () => {
    logger.info("-------------- Sending status data");
    sendStatus();
  });

  if (!didSignalBoot) {
    return changeState(constants.SYSTEM_STATE.SIGNAL_DEVICE_BOOT);
  } else {
    return changeState(constants.SYSTEM_STATE.SYNCING_TIME);
  }
});


stateMachine.addHandlerForState(constants.SYSTEM_STATE.SIGNAL_DEVICE_BOOT, async ({changeState}) => {
  await websocketService.request({method: "POST", path: `/controllers/${machineId}/boot`,});

  logger.info(`Signalled device boot`);
  didSignalBoot = true;
  return changeState(constants.SYSTEM_STATE.SYNCING_TIME);
});


stateMachine.addHandlerForState(constants.SYSTEM_STATE.SYNCING_TIME, async ({changeState}) => {
  const start = new Date().getTime(),
    {payload: {time}} = await websocketService.request({path: "/time"}),
    end = new Date().getTime(),
    estimatedLatency = Math.trunc((start - end) / 2);

  TimeService.resetTime(time - estimatedLatency);

  websocketService.subscribe(constants.SERVER_EVENTS.NEW_COMMANDS, (data: HardwareCommands) => {
    logger.info("Received new commands from server");
    CommandService.ingestCommands(data);
  });

  return changeState(constants.SYSTEM_STATE.STARTING_IO_TASK);
});


stateMachine.addHandlerForState(constants.SYSTEM_STATE.STARTING_IO_TASK, async ({changeState}) => {
  await CommandService.fetchAndProcessCommands(machineId!, websocketService);
  CommandService.startBackgroundTask();
  return changeState(constants.SYSTEM_STATE.OPERATING);
});


stateMachine.addHandlerForState(constants.SYSTEM_STATE.OPERATING, async () => {
  assert(machineId !== null, "machineId has not been assigned")

  if (!commandRefresherStateMachine) {
    commandRefresherStateMachine = buildCommandRefresherStateMachine(machineId, websocketService);
    commandRefresherStateMachine.onError(abort);
    commandRefresherStateMachine.run();
  }

  if (!heartbeatStateMachine) {
    heartbeatStateMachine = buildHeartbeatStateMachine(machineId, websocketService);
    heartbeatStateMachine.interface().onHeartbeat((heartbeatTimestamp => lastHeartbeatTimestamp = heartbeatTimestamp))
    heartbeatStateMachine.onError(abort);
    heartbeatStateMachine.run();
  }

  if (shouldSendOutletHistory()) {
    await reportOutletHistory();
  } else {
    await sleep(500);
  }
});


stateMachine.addHandlerForStateTransition({from: constants.SYSTEM_STATE.OPERATING, to: StateMachine.ANY_STATE}, async () => {
  if (commandRefresherStateMachine) {
    await commandRefresherStateMachine.stop();
    commandRefresherStateMachine = null;
  }

  if (heartbeatStateMachine) {
    await heartbeatStateMachine.stop();
    heartbeatStateMachine = null;
  }
});


async function handleStateMachineError(err: any) {
  if (_.get(err, "payload.code") === WebsocketClient.constants.ERROR_CODES.AUTHENTICATE_FIRST) {
    logger.error("Reauthentication needed");
    return stateMachine.changeState(constants.SYSTEM_STATE.AUTHENTICATING);
  } else {
    logger.error(err);
  }
}


async function reportOutletHistory() {
  const outletHistory = HardwareIOService.getSwitchingHistory();
  const cutoffTimestamp = HardwareIOService.getLatestSwitchingHistoryTimestamp();

  if (outletHistory.length === 0) {
    return Promise.resolve();
  }

  try {
    await websocketService.request({
      path: `/controllers/${machineId}/outlets/history`,
      method: "POST",
      payload: {history: outletHistory}
    });

    logger.debug(`Sent outlet history (${outletHistory.length} records)`);
    HardwareIOService.clearSwitchingHistory(cutoffTimestamp);
    lastOutletHistoryReportTimestamp = TimeService.getTime();
  } catch (err) {
    if (_.get(err, "payload.statusCode") === 422) {
      // Server already saw some of the history records that we sent.  This is OK.
      logger.debug(`Sent outlet history (${outletHistory.length} records)`);
      logger.warn("Server indicated that some outlet history records were already seen");
      HardwareIOService.clearSwitchingHistory(cutoffTimestamp);
      lastOutletHistoryReportTimestamp = TimeService.getTime();
      return;
    }
    logger.error("**** Error sending outlet history");
    throw err;
  }
}


async function sendStatus() {
  const payload = {
    softwareVersion,
    commitHash,
    bootTime: bootTime.toISOString(),
    deviceTime: new Date().toISOString(),
    applicationTime: new Date(TimeService.getTime()).toISOString(),
    lastHeartbeat: new Date(lastHeartbeatTimestamp).toISOString(),
    ipAddresses: getLocalIpAddresses(),
    commands: CommandService.getCommands(),
    pinState: HardwareIOService.getPinState(),
    recentLogs: logger.getHistory()
  };

  try {
    await websocketService.request({
      path: `/controllers/${machineId}/status`,
      method: "POST",
      payload,
    });
  } catch (err) {
    logger.error("**** Failed to send status");
    logger.error(err);
  }
}

async function start() {
  stateMachine.onError(handleStateMachineError);
  stateMachine.changeState(constants.SYSTEM_STATE.INITIALIZING);
  await stateMachine.run();
}

start();
