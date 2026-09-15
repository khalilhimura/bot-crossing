#!/usr/bin/env node
import { dispatch, METHODS } from './service.mjs';
import { VERSION, check } from './common.mjs';
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(`SovMem Mock CLI — DEMO MEMORY / SIMULATED AUTHORITY\nUsage: node mock-sovmem/cli.mjs --store DIRECTORY [--role agent|owner]\nSend one {"version":"${VERSION}","method":"...","params":{}} JSON object on stdin.\nMethods: ${METHODS.join(', ')}\nNo production SovMem compatibility or security guarantee.`);
} else {
  try {
    let store, role = 'agent';
    for (let i = 0; i < args.length; i += 2) { check(args[i + 1] && ['--store','--role'].includes(args[i]), 'Unknown or incomplete argument'); if (args[i] === '--store') store = args[i + 1]; else role = args[i + 1]; }
    check(store, '--store is required');
    const chunks = []; let size = 0;
    for await (const chunk of process.stdin) { size += chunk.length; check(size <= 262144, 'Request exceeds 256 KiB'); chunks.push(chunk); }
    let request; try { request = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('Expected one JSON request'), { code: 'request.json' }); }
    const result = dispatch(store, request, role);
    console.log(JSON.stringify({ version: VERSION, demo: true, ok: true, result }));
  } catch (e) {
    console.log(JSON.stringify({ version: VERSION, demo: true, ok: false, error: { code: e.code?.includes('.') ? e.code : 'store.io', message: e.code?.includes('.') ? e.message : 'Mock filesystem operation failed' } }));
    process.exitCode = 1;
  }
}
