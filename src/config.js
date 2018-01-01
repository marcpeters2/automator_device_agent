import constants from './constants'

function getConfig() {

  let configuration;

  switch((process.env.NODE_ENV || "").toLowerCase()) {
    case "production":
      configuration = {};
      break;

    case "local":
      configuration = {
        CONDUCTOR_HOST: "localhost",
        CONDUCTOR_PORT: 8000
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
