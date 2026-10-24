import { createServer } from 'node:http';
import { handle } from './server.ts';

const PORT = Number(process.env.PORT ?? 8089);

createServer((req, res) => void handle(req, res)).listen(PORT, '127.0.0.1', () => {
  console.log(`Shortcut → Jira proxy on http://localhost:${PORT}`);
});
