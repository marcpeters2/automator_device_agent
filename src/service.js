const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const Promise = require('bluebird');
const { config } = require('./config');
const constants = require('./constants');
const {getLocalIpAddresses} = require('./helpers/ipAddress');
const logger = require('./services/Logger');
const {logLevels} = logger;
const sleep = require('./helpers/sleep');
const TimeService = require('./services/TimeService');
const CommandService = require('./services/CommandService');
const HardwareIOService = require('./services/HardwareIOService');
const StateMachine = require('./services/StateMachine');
const stateMachine = new StateMachine({logger});
const {NesWebsocketTransport} = require('websocket-transport');

logger.setLevel(logLevels.info);

const authToken = fs.readFileSync(path.join(__dirname, "..", "/auth_token.txt"));
const softwareVersion = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "/package.json")).toString()).version;
const bootTime = new Date();
const commitHash = childProcess.execSync('git rev-parse HEAD').toString().trim();

const dataTransport = new NesWebsocketTransport({config, authToken, logger});

let lastCommandRefreshTimestamp = 0,
  nextCommandRefreshTimestamp = 0,
  lastHearbeatTimestamp = 0,
  lastOutletHistoryReportTimestamp = 0,
  machineId = null,
  didSignalBoot = false;


function shouldRequestNewCommands() {
  const now = TimeService.getTime(),
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


function shouldHeartbeat() {
  const now = TimeService.getTime(),
    timeSinceLastHeartbeat = now - lastHearbeatTimestamp;

  if (timeSinceLastHeartbeat < constants.HEARTBEAT_MIN_INTERVAL_MS) {
    return false;
  } else if (timeSinceLastHeartbeat >= constants.HEARTBEAT_MAX_INTERVAL_MS) {
    return true;
  }
  return false;
}


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

stateMachine.addHandlerForState(constants.SYSTEM_STATE.INITIALIZING, async ({changeState}) => {
  dataTransport.onDisconnect(() => {
    nextCommandRefreshTimestamp = TimeService.getTime();
  });

  const initialConnection = new Promise((resolve) => {
    dataTransport.onInitialConnect(() => {
      changeState(constants.SYSTEM_STATE.PUBLISHING_CAPABILITIES);
      return resolve();
    });
  });

  logger.info("-------------- Waiting for initial websocket connection");
  await dataTransport.connect();
  await initialConnection;
});

stateMachine.addHandlerForState(constants.SYSTEM_STATE.PUBLISHING_CAPABILITIES, async ({changeState}) => {
  const payload = {};

  constants.ALL_OUTLET_TYPES.forEach((outletType) => {
    const outletsOfType = config.OUTLETS.filter((outlet) => outlet.type === outletType);
    if (outletsOfType.length === 0) return;
    payload[outletType] = {};
    outletsOfType.forEach(outlet => {
      _.set(payload, `${outletType}.${outlet.pin}`, outlet.internalName);
    })
  });

  const {payload: {id}} = await dataTransport.request({
    method: "POST",
    path: "/controllers",
    payload,
  });

  logger.info(`Received id ${id}`);
  machineId = id;

  await dataTransport.subscribe(`/controllers/${machineId}/status`, (update, flags) => {
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
  await dataTransport.request({
    method: "POST",
    path: `/controllers/${machineId}/boot`,
  });

  logger.info(`Signalled device boot`);
  didSignalBoot = true;
  return changeState(constants.SYSTEM_STATE.SYNCING_TIME);
});

stateMachine.addHandlerForState(constants.SYSTEM_STATE.SYNCING_TIME, async ({changeState}) => {
  const start = new Date().getTime(),
    {payload: {time}} = await dataTransport.request({
      path: "/time"
    }),
    end = new Date().getTime(),
    estimatedLatency = Math.trunc((start - end) / 2);

  TimeService.resetTime(time - estimatedLatency);

  await dataTransport.subscribe(`/controllers/${machineId}/commands`, (update, flags) => {
    logger.info("Received new commands from server");
    processCommands(update);
  });

  changeState(constants.SYSTEM_STATE.STARTING_IO_TASK);
});

stateMachine.addHandlerForState(constants.SYSTEM_STATE.STARTING_IO_TASK, async ({changeState}) => {
  await fetchCommands();
  CommandService.startBackgroundTask();
  changeState(constants.SYSTEM_STATE.OPERATING);
});

stateMachine.addHandlerForState(constants.SYSTEM_STATE.OPERATING, async ({changeState}) => {
  if (shouldRequestNewCommands()) {
    await fetchCommands();
  } else if (shouldHeartbeat()) {
    await heartbeat();
  } else if (shouldSendOutletHistory()) {
    await reportOutletHistory();
  } else {
    await sleep(500);
  }
});

stateMachine.onError(handleStateMachineError);
stateMachine.changeState(constants.SYSTEM_STATE.INITIALIZING);
stateMachine.runForever();


function handleStateMachineError(err) {
  if (err.message === "Websocket is disconnected") return;
  logger.error(err);
}

async function fetchCommands() {
  try {
    const {payload} = await dataTransport.request({
      path: `/controllers/${machineId}/commands`,
    });
    logger.info("Fetched commands from server");
    processCommands(payload);
  } catch (err) {
    logger.error("**** Error fetching commands");
    throw err;
  }
}


async function heartbeat() {
  try {
    await dataTransport.request({
      path: `/controllers/${machineId}/heartbeat`,
      method: "POST"
    });
    logger.debug("Heartbeat");
    lastHearbeatTimestamp = TimeService.getTime();
  } catch (err) {
    logger.error("**** Error sending heartbeat");
    throw err;
  }
}


function reportOutletHistory() {
  const outletHistory = HardwareIOService.getSwitchingHistory();
  const cutoffTimestamp = HardwareIOService.getLatestSwitchingHistoryTimestamp();

  if (outletHistory.length === 0) {
    return Promise.resolve();
  }

  return dataTransport.request({
    path: `/controllers/${machineId}/outlets/history`,
    method: "POST",
    payload: {history: outletHistory}
  }).then(() => {
    logger.info(`Sent outlet history (${outletHistory.length} records)`);
    HardwareIOService.clearSwitchingHistory(cutoffTimestamp);
    lastOutletHistoryReportTimestamp = TimeService.getTime();
  }).catch((err) => {
    if (_.get(err, "data.statusCode") === 422) {
      // Server already saw some of the history records that we sent.  This is OK.
      logger.info(`Sent outlet history (${outletHistory.length} records)`);
      logger.warn("Server indicated that some outlet history records were already seen");
      HardwareIOService.clearSwitchingHistory(cutoffTimestamp);
      lastOutletHistoryReportTimestamp = TimeService.getTime();
      return;
    }
    logger.error("**** Error sending outlet history");
    throw err;
  });
}


function processCommands(payload) {
  CommandService.ingestCommands(payload);
  const now = TimeService.getTime(),
    commandRefreshTimeHint = CommandService.refreshCommandsHint();
  lastCommandRefreshTimestamp = now;
  nextCommandRefreshTimestamp = Math.max(now + constants.COMMAND_REFRESH_MIN_INTERVAL_MS, commandRefreshTimeHint);

  logger.info(`Next command retrieval: +${Math.trunc((nextCommandRefreshTimestamp - now)/1000)} seconds`)
}


function sendStatus() {
  const payload = {
    softwareVersion,
    commitHash,
    bootTime: bootTime.toISOString(),
    deviceTime: new Date().toISOString(),
    applicationTime: new Date(TimeService.getTime()).toISOString(),
    lastHeartbeat: new Date(lastHearbeatTimestamp).toISOString(),
    ipAddresses: getLocalIpAddresses(),
    commands: CommandService.getCommands(),
    pinState: HardwareIOService.getPinState(),
    recentLogs: logger.getHistory()
  };

  return dataTransport.request({
      method: "POST",
      path: `/controllers/${machineId}/status`,
      payload,
    })
    .catch((err) => {
      logger.error("**** Failed to send status");
      logger.error(err);
    });
}
