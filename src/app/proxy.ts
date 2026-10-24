import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { handle, type ProxyHooks } from '../server.ts';

export interface RunningProxy {
  port: number;
  close(): Promise<void>;
}

export function startProxy(port: number, hooks: ProxyHooks): Promise<RunningProxy> {
  const server = createServer((q, s) => void handle(q, s, hooks));
  return new Promise((resolve, reject) => {
    let listening = false;
    // Stays attached for the server's lifetime: an unhandled 'error' event would crash the Electron main process.
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (listening) return console.error('proxy server error:', err);
      reject(
        err.code === 'EADDRINUSE'
          ? new Error(`Port ${port} is already in use. Quit whatever is using it, or pick another port in Settings.`)
          : err,
      );
    });
    server.listen(port, '127.0.0.1', () => {
      listening = true;
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () =>
          new Promise((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
            server.closeAllConnections();
          }),
      });
    });
  });
}
