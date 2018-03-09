const msPerMin = 60000,
  msPerDay = 86400000;

const constants = {
  OUTLET_TYPE_ELECTRIC: 'electric',
  OUTLET_TYPE_HYDRAULIC: 'hydraulic',
  OUTLET_ON: 1,
  OUTLET_OFF: 0,
  SYSTEM_STATE: {
    INITIALIZING: "INITIALIZING",
    SYNCING_TIME: "SYNCING_TIME",
    STARTING_IO_TASK: "STARTING_IO_TASK",
    CONNECTING_WEBSOCKET: "CONNECTING_WEBSOCKET",
    PUBLISHING_CAPABILITIES: "PUBLISHING_CAPABILITIES",
    OPERATING: "OPERATING",
  },
  HTTP_REQUEST_TIMEOUT_MS: 5000,
  OUTLET_MIN_SWITCHING_INTERVAL_MS: 2000,
  COMMAND_REFRESH_LEAD_TIME_MS: msPerMin * 30,
  COMMAND_REFRESH_MIN_INTERVAL_MS: 5000,
  COMMAND_REFRESH_MAX_INTERVAL_MS: msPerDay,
  MS_PER_SEC: 1000,
  MS_PER_MIN: msPerMin,
  MS_PER_HOUR: 3600000,
  MS_PER_DAY: msPerDay,
};

constants.ALL_OUTLET_TYPES = [constants.OUTLET_TYPE_ELECTRIC, constants.OUTLET_TYPE_HYDRAULIC];

export default constants;

