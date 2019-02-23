const constants = require('./constants');

function getConfig() {

  let configuration;

  switch((process.env.NODE_ENV || "").toLowerCase()) {
    case "production":
      configuration = {
        API_HOST: "api.marcpeters.ca",
        API_PORT: 443,
        USE_SSL: true
      };
      break;

    case "local":
      configuration = {
        API_HOST: "localhost",
        API_PORT: 8000,
        USE_SSL: false
      };
      break;

    case "test":
      configuration = {};
      break;

    default:
      throw new Error(`getConfig: unknown environment ${process.env.NODE_ENV}`);
      break;
  }

  configuration.OUTLETS = [
    {internalName: "A", type: constants.OUTLET_TYPE_ELECTRIC, pin: 29},
    {internalName: "B", type: constants.OUTLET_TYPE_ELECTRIC, pin: 31},
    {internalName: "C", type: constants.OUTLET_TYPE_ELECTRIC, pin: 33},
    {internalName: "D", type: constants.OUTLET_TYPE_ELECTRIC, pin: 35},
  ];

  configuration.HTTP_REQUEST_TIMEOUT_MS = 5000;

  return configuration;
}

const config = getConfig();

module.exports = { config };
