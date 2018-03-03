"use strict";

import os from "os";

export function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces(),
    result = {};

  Object.keys(interfaces).forEach((interfaceName) => {
    let alias = 0;

    interfaces[interfaceName].forEach((_interface) => {
      if (_interface.family !== "IPv4" || _interface.internal !== false) {
        // skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
        return;
      }

      if (alias >= 1) {
        // this single interface has multiple ipv4 addresses
        result[`${interfaceName}:${alias}`] = _interface.address;
      } else {
        // this interface has only one ipv4 adress
        result[interfaceName] = _interface.address;
      }

      ++alias;
    });
  });

  return result;
}
