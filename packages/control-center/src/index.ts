// The Control Center: the server inside the plugin (server.ts), its JSON-RPC protocol
// (protocol.ts), what it reports about the mixer and the connection, and the Setup Assistant.
// The page itself lives in ui/ and is built by scripts/build-ui.ts.
export * from './diagnostics.ts';
export * from './setup.ts';
export * from './summary.ts';
export * from './protocol.ts';
export * from './server.ts';
