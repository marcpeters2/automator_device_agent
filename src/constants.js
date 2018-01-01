const constants = {
  OUTLET_TYPE_ELECTRIC: 'electric',
  OUTLET_TYPE_HYDRAULIC: 'hydraulic',
  OUTLET_ON: 1,
  OUTLET_OFF: 0,
  SYSTEM_STATE: {
    INITIAL: 0,
    GOT_ID: 1,
    SYNCED_TIME: 2,
    OPERATING: 3,
  },
  HTTP_REQUEST_TIMEOUT_MS: 5000,
  OUTLET_MIN_SWITCHING_INTERVAL_MS: 2000,
};

constants.ALL_OUTLET_TYPES = [constants.OUTLET_TYPE_ELECTRIC, constants.OUTLET_TYPE_HYDRAULIC];

export default constants;

