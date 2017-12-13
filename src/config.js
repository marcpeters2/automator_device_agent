
function getConfig() {
  switch((process.env.NODE_ENV || "").toLowerCase()) {
    case "production":
      return {};
      break;

    case "local":
      return {
        CONDUCTOR_HOST: "localhost",
        CONDUCTOR_PORT: 8000
      };
      break;

    case "test":
      return {};
      break;

    default:
      throw new Error(`getConfig: unknown environment ${process.env.NODE_ENV}`);
      break;
  }
}

const config = getConfig();

export { config };
