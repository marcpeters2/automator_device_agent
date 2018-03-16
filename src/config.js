import constants from './constants'

function getConfig() {

  let configuration;

  switch((process.env.NODE_ENV || "").toLowerCase()) {
    case "production":
      configuration = {
        API_HOST: "api.marcpeters.ca",
        API_PORT: 443,
        USE_SECURE_WEBSOCKETS: true
      };
      break;

    case "local":
      configuration = {
        API_HOST: "localhost",
        API_PORT: 8000,
        USE_SECURE_WEBSOCKETS: false
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
    {internalName: "A", type: constants.OUTLET_TYPE_ELECTRIC, pin: 0},
    {internalName: "B", type: constants.OUTLET_TYPE_ELECTRIC, pin: 1},
    {internalName: "C", type: constants.OUTLET_TYPE_HYDRAULIC, pin: 2},
    {internalName: "D", type: constants.OUTLET_TYPE_HYDRAULIC, pin: 3},
  ];

  return configuration;
}

const config = getConfig();

export { config };
