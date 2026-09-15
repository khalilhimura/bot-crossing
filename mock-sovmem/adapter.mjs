import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VERSION } from './common.mjs';
const CLI = fileURLToPath(new URL('./cli.mjs', import.meta.url));
const error = (code, message) => Object.assign(new Error(message), { code });
export function createMockAdapter({ store, role = 'agent', timeoutMs = 10000 }) {
  if (typeof store !== 'string' || !['owner','agent'].includes(role) || !Number.isInteger(timeoutMs) || timeoutMs < 1) throw error('adapter.config', 'Invalid adapter configuration');
  return {
    request(method, params = {}, { signal } = {}) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(error('adapter.aborted', 'Request cancelled before dispatch'));
        const child = spawn(process.execPath, [CLI, '--store', store, '--role', role], { stdio: ['pipe','pipe','pipe'] });
        let output = '', settled = false;
        function finish(err, value) { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); err ? reject(err) : resolve(value); }
        function abort() { child.kill(); finish(error('adapter.aborted', 'Request cancelled; reconcile mutations before retrying')); }
        const timer = setTimeout(() => { child.kill(); finish(error('adapter.timeout', 'Request timed out; reconcile mutations before retrying')); }, timeoutMs);
        signal?.addEventListener('abort', abort, { once: true });
        child.on('error', e => finish(error('adapter.process', e.message)));
        child.stdin.on('error', () => {});
        child.stderr.resume();
        child.stdout.on('data', chunk => { output += chunk.toString(); if (Buffer.byteLength(output) > 8 * 1024 * 1024) { child.kill(); finish(error('adapter.response_limit', 'Response too large')); } });
        child.on('close', code => {
          if (settled) return;
          try {
            const envelope = JSON.parse(output);
            if (envelope.version !== VERSION || envelope.demo !== true || typeof envelope.ok !== 'boolean') throw new Error('Unexpected envelope');
            if (!envelope.ok) return finish(error(envelope.error.code, envelope.error.message));
            if (code !== 0) throw new Error('Unexpected exit code');
            finish(null, envelope.result);
          } catch { finish(error('adapter.protocol', 'Invalid CLI response')); }
        });
        child.stdin.end(JSON.stringify({ version: VERSION, method, params }));
      });
    },
  };
}
