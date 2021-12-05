import {OutletType, SensorType} from "./constants";

type Outlet = {
  internalName: string,
  type: OutletType,
  pin: number
};

type Sensor = {
  internalName: string,
  type: SensorType
}

type RuntimeConfiguration = {
  API_HOST: string,
  API_PORT: number,
  USE_SSL: boolean,
  HTTP_REQUEST_TIMEOUT_MS: number,
  OUTLETS: Outlet[],
  SENSORS: Sensor[]
};

function getConfig() {

  let configuration: RuntimeConfiguration;
  const environment = (process.env.NODE_ENV || "local").toLowerCase();

  const commonConfiguration = {
    HTTP_REQUEST_TIMEOUT_MS: 5000,
    OUTLETS: [
      {internalName: "A", type: OutletType.ELECTRIC, pin: 29},
      {internalName: "B", type: OutletType.ELECTRIC, pin: 31},
      {internalName: "C", type: OutletType.ELECTRIC, pin: 33},
      {internalName: "D", type: OutletType.ELECTRIC, pin: 35},
    ],
    SENSORS: [
      {internalName: "E", type: SensorType.WEIGHT},
      {internalName: "F", type: SensorType.WEIGHT},
      {internalName: "G", type: SensorType.WEIGHT},
      {internalName: "H", type: SensorType.WEIGHT},
    ]
  };

  switch(environment) {
    case "production":
      configuration = {
        API_HOST: "api.marcpeters.ca",
        API_PORT: 443,
        USE_SSL: true,
        ...commonConfiguration
      };
      break;

    case "local":
      configuration = {
        API_HOST: "localhost",
        API_PORT: 8000,
        USE_SSL: false,
        ...commonConfiguration
      };
      break;

    case "test":
      // Return fake values.  Tests don't actually connect to the API host.
      configuration = {
        API_HOST: "",
        API_PORT: -1,
        USE_SSL: false,
        ...commonConfiguration
      };
      break;

    default:
      throw new Error(`getConfig: unknown environment ${process.env.NODE_ENV}`);
  }

  return configuration;
}

export const config = getConfig();
