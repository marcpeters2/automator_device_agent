const msPerSecond = 1000,
  msPerMin = 60000,
  msPerDay = 86400000;

const constants = {
  OUTLET_TYPE_ELECTRIC: 'electric',
  OUTLET_TYPE_HYDRAULIC: 'hydraulic',
  OUTLET_STATE_ON: 1,
  OUTLET_STATE_ON_STRING: "on",
  OUTLET_STATE_OFF: 0,
  OUTLET_STATE_OFF_STRING: "off",
  OUTLET_STATE_UNKNOWN_STRING: "unknown",
  SYSTEM_STATE: {
    INITIALIZING: "INITIALIZING",
    SYNCING_TIME: "SYNCING_TIME",
    STARTING_IO_TASK: "STARTING_IO_TASK",
    CONNECTING_WEBSOCKET: "CONNECTING_WEBSOCKET",
    PUBLISHING_CAPABILITIES: "PUBLISHING_CAPABILITIES",
    SIGNAL_DEVICE_BOOT: "SIGNAL_DEVICE_BOOT",
    OPERATING: "OPERATING",
  },
  OUTLET_MIN_SWITCHING_INTERVAL_MS: 2000,
  COMMAND_REFRESH_LEAD_TIME_MS: msPerMin * 30,
  COMMAND_REFRESH_MIN_INTERVAL_MS: 5000,
  COMMAND_REFRESH_MAX_INTERVAL_MS: msPerDay,
  HEARTBEAT_MIN_INTERVAL_MS: 5000,
  HEARTBEAT_MAX_INTERVAL_MS: msPerSecond * 30,
  OUTLET_HISTORY_REPORT_INTERVAL_MS: msPerSecond * 10,
  MAX_LOG_ENTRIES: 200,
  MAX_OUTLET_HISTORY_ENTRIES: 1000,
  MS_PER_SEC: 1000,
  MS_PER_MIN: msPerMin,
  MS_PER_HOUR: 3600000,
  MS_PER_DAY: msPerDay,
};

constants.ALL_OUTLET_TYPES = [constants.OUTLET_TYPE_ELECTRIC, constants.OUTLET_TYPE_HYDRAULIC];

module.exports = constants;

