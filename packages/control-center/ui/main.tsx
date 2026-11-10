// The Control Center page: connects to the plugin over the WebSocket and shows the app.

import { render } from 'preact';
import { App } from './app.tsx';
import { Rpc } from './rpc.ts';

const rpc = new Rpc(`ws://${location.host}/rpc`);
rpc.connect();
render(<App rpc={rpc} />, document.body);
