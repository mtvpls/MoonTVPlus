const HUB_KEY = '__moonTvRemoteHub';

function getGlobalHub() {
  if (!globalThis[HUB_KEY]) {
    globalThis[HUB_KEY] = {
      io: null,
      devices: new Map(),
      socketToDevice: new Map(),
    };
  }
  return globalThis[HUB_KEY];
}

function attachTVRemoteIO(io) {
  const hub = getGlobalHub();
  hub.io = io;
}

function registerTVRemoteDevice(socketId, username, data) {
  const hub = getGlobalHub();
  const deviceId = String(data?.deviceId || '').slice(0, 128);
  if (!deviceId) return { success: false, error: '缺少设备 ID' };

  const device = {
    deviceId,
    socketId,
    username,
    deviceName: String(data?.deviceName || 'Web TV').slice(0, 80),
    currentPath: String(data?.currentPath || '/tv').slice(0, 240),
    title: String(data?.title || '').slice(0, 120),
    lastActiveAt: Date.now(),
  };

  hub.devices.set(deviceId, device);
  hub.socketToDevice.set(socketId, deviceId);
  return { success: true };
}

function updateTVRemoteDevice(socketId, username, data) {
  const hub = getGlobalHub();
  const deviceId = String(data?.deviceId || hub.socketToDevice.get(socketId) || '');
  const device = hub.devices.get(deviceId);
  if (!device || device.socketId !== socketId || device.username !== username) {
    return false;
  }

  device.currentPath = String(data?.currentPath || device.currentPath).slice(0, 240);
  device.title = String(data?.title || device.title || '').slice(0, 120);
  device.lastActiveAt = Date.now();
  hub.devices.set(deviceId, device);
  return true;
}

function removeTVRemoteSocket(socketId) {
  const hub = getGlobalHub();
  const deviceId = hub.socketToDevice.get(socketId);
  if (!deviceId) return;

  const device = hub.devices.get(deviceId);
  if (device?.socketId === socketId) {
    hub.devices.delete(deviceId);
  }
  hub.socketToDevice.delete(socketId);
}

function listTVRemoteDevices(username) {
  const hub = getGlobalHub();
  const now = Date.now();
  return Array.from(hub.devices.values())
    .filter((device) => device.username === username && now - device.lastActiveAt < 45_000)
    .map(({ deviceId, deviceName, currentPath, title, lastActiveAt }) => ({
      deviceId,
      deviceName,
      currentPath,
      title,
      lastActiveAt,
    }))
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}

function sendTVRemoteCommand(username, deviceId, eventName, command) {
  const hub = getGlobalHub();
  const device = hub.devices.get(String(deviceId || ''));
  if (!hub.io) return { success: false, error: '遥控服务未启动' };
  if (!device || device.username !== username) {
    return { success: false, error: '电视端不在线' };
  }

  device.lastActiveAt = Date.now();
  hub.devices.set(device.deviceId, device);
  hub.io.to(device.socketId).emit(eventName, command);
  return { success: true };
}

function cleanupTVRemoteDevices() {
  const hub = getGlobalHub();
  const now = Date.now();
  for (const [deviceId, device] of hub.devices.entries()) {
    if (now - device.lastActiveAt > 90_000) {
      hub.devices.delete(deviceId);
      hub.socketToDevice.delete(device.socketId);
    }
  }
}

function clearTVRemoteHub() {
  const hub = getGlobalHub();
  hub.io = null;
  hub.devices.clear();
  hub.socketToDevice.clear();
}

module.exports = {
  attachTVRemoteIO,
  cleanupTVRemoteDevices,
  clearTVRemoteHub,
  listTVRemoteDevices,
  registerTVRemoteDevice,
  removeTVRemoteSocket,
  sendTVRemoteCommand,
  updateTVRemoteDevice,
};
