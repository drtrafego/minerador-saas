// Mock server-only para scripts Node.js fora do contexto Next.js
const Module = require('module');
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'server-only') return request;
  return orig.call(this, request, ...args);
};
require.cache['server-only'] = {
  id: 'server-only',
  filename: 'server-only',
  loaded: true,
  exports: {},
};
