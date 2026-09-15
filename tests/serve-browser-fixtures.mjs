/** Local browser QA server: synthetic sessions and disposable asset storage only. */
import { createServer } from 'vite'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.env.BOT_CROSSING_DATA ||= await mkdtemp(path.join(tmpdir(), 'bot-crossing-browser-'))
const { apiMiddleware } = await import('../server/api.mjs')
const server = await createServer({
  configFile: false,
  server: { host: '127.0.0.1', port: Number(process.env.PORT) || 5276, strictPort: true },
  plugins: [{
    name: 'asset-browser-fixtures',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] === '/api/threads') {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ threads: [{ id: 'asset-demo-1', project: 'Asset playground', title: 'Synthetic preview session', harness: 'claude-code', harnessName: 'Demo', status: 'working', updatedAt: Date.now(), createdAt: Date.now(), messages: 3, lastRole: 'assistant' }], scannedAt: Date.now() }))
          return
        }
        apiMiddleware(req, res, next)
      })
    },
  }],
})
await server.listen()
server.printUrls()
console.log(`Disposable asset data: ${process.env.BOT_CROSSING_DATA}`)
