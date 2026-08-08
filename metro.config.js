const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Allow Metro to bundle WebAssembly files for SQLite
config.resolver.assetExts.push('wasm');

module.exports = config;