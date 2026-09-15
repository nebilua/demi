const DEFAULT_METRO_PORT = 8082;

function getMetroPort(rawPort) {
  const port = rawPort === undefined || rawPort === '' ? DEFAULT_METRO_PORT : Number(rawPort);

  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('EXPO_BUILD_PORT must be an integer between 1024 and 65535.');
  }

  return port;
}

function createMetroConfig(rawPort) {
  const port = getMetroPort(rawPort);
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
  };
}

function getMetroUrl(config, pathname) {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return new URL(normalizedPath, `${config.baseUrl}/`).toString();
}

module.exports = {
  DEFAULT_METRO_PORT,
  createMetroConfig,
  getMetroPort,
  getMetroUrl,
};