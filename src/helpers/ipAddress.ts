import os from "os";

/**
 * Returns a map of public IPv4 network interface names to their IP addresses.
 * @example
 * {
 *     "wlan0": "192.168.0.100"
 * }
 */
export function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces(),
    // Result is a map of network interface names to IP addresses
    result: {[key: string]: string} = {};

  Object.keys(interfaces).forEach((interfaceName) => {
    let alias = 0;

    interfaces[interfaceName]!.forEach((_interface) => {
      if (_interface.family !== "IPv4" || _interface.internal) {
        // skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
        return;
      }

      if (alias >= 1) {
        // this single interface has multiple ipv4 addresses
        result[`${interfaceName}:${alias}`] = _interface.address;
      } else {
        // this interface has only one ipv4 address
        result[interfaceName] = _interface.address;
      }

      ++alias;
    });
  });

  return result;
}
