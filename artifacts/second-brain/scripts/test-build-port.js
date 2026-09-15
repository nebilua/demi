const assert = require('node:assert/strict');
const { createServer } = require('node:net');
const {
  DEFAULT_METRO_PORT,
  createMetroConfig,
  getMetroPort,
  getMetroUrl,
} = require('./build-config');

function holdPortIfAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        resolve(null);
        return;
      }
      reject(error);
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const portHolder = await holdPortIfAvailable(8081);

  try {
    const defaultConfig = createMetroConfig();
    assert.equal(DEFAULT_METRO_PORT, 8082);
    assert.equal(defaultConfig.port, DEFAULT_METRO_PORT);
    assert.notEqual(defaultConfig.port, 8081);

    const overrideConfig = createMetroConfig('9123');
    assert.equal(overrideConfig.port, 9123);
    assert.equal(overrideConfig.baseUrl, 'http://127.0.0.1:9123');

    const metroEndpoints = ['/status', '/manifest', 'bundles/entry.bundle', '/assets/icon.png'];
    for (const config of [defaultConfig, overrideConfig]) {
      for (const endpoint of metroEndpoints) {
        assert.equal(new URL(getMetroUrl(config, endpoint)).port, String(config.port));
      }
    }

    for (const invalidPort of ['not-a-port', '1023', '65536', '9123.5']) {
      assert.throws(
        () => getMetroPort(invalidPort),
        /EXPO_BUILD_PORT must be an integer between 1024 and 65535/,
      );
    }

    console.log(
      portHolder
        ? 'Build port regression check passed with a local 8081 holder.'
        : 'Build port regression check passed while 8081 was already occupied.',
    );
  } finally {
    if (portHolder) {
      await new Promise((resolve) => portHolder.close(resolve));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});