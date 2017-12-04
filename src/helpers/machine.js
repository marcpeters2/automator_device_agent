import assert from 'assert';
import os from 'os';

export function uniqueMachineId() {
  const networkInterfaces = os.networkInterfaces();
  assert(networkInterfaces.en0, "could not find any Ethernet network interfaces");

  const targetInterfaces = networkInterfaces.en0.filter((_interface) => {
    return _interface.family === "IPv4" && !_interface.internal;
  });
  assert(targetInterfaces.length === 1, "could not determine MAC address: found more than one candidate Ethernet interface");

  return targetInterfaces[0].mac;
}
