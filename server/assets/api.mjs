import { assetError, MAX_GLB_BYTES } from './glb.mjs'
function send(res, status, data) {
  const payload = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}
function sameOrigin(req) {
  try {
    const origin = new URL(req.headers.origin)
    return (
      origin.origin ===
        `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}` &&
      origin.href === origin.origin + '/'
    )
  } catch {
    return false
  }
}
function body(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0,
      over = false
    const chunks = []
    if (Number(req.headers['content-length']) > limit) {
      req.resume()
      reject(
        assetError(
          `Request exceeds ${limit === MAX_GLB_BYTES ? '50 MiB' : 'metadata'} limit`,
          413,
        ),
      )
      return
    }
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        if (!over) {
          over = true
          chunks.length = 0
          reject(assetError('Request body too large', 413))
        }
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!over) resolve(Buffer.concat(chunks))
    })
    req.on('error', reject)
    req.on('aborted', () => reject(assetError('Upload interrupted')))
  })
}
async function json(req) {
  const bytes = await body(req, 256 * 1024)
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch {
    throw assetError('Invalid JSON body')
  }
}
export function createAssetMiddleware(store) {
  return async (req, res, next) => {
    const url = new URL(req.url, 'http://localhost')
    if (
      url.pathname !== '/api/assets' &&
      !url.pathname.startsWith('/api/assets/')
    )
      return next?.()
    if (!['GET', 'HEAD'].includes(req.method) && !sameOrigin(req))
      return send(res, 403, {
        error: 'Asset changes require the exact same origin as this server',
      })
    try {
      if (url.pathname === '/api/assets' && req.method === 'GET')
        return send(res, 200, await store.list())
      if (url.pathname === '/api/assets/import' && req.method === 'POST') {
        let name = req.headers['x-asset-name'] || 'Imported model'
        try {
          name = decodeURIComponent(name)
        } catch {
          throw assetError('Invalid asset name encoding')
        }
        const result = await store.upload(await body(req, MAX_GLB_BYTES), name)
        return send(res, result.duplicate ? 200 : 201, result)
      }
      const placement = url.pathname.match(
        /^\/api\/assets\/placements\/([^/]+)$/,
      )
      if (placement) {
        const id = decodeURIComponent(placement[1])
        if (req.method === 'PUT')
          return send(res, 200, {
            placement: await store.putPlacement({ ...(await json(req)), id }),
          })
        if (req.method === 'DELETE')
          return send(res, 200, await store.removePlacement(id))
      }
      const match = url.pathname.match(
        /^\/api\/assets\/([^/]+)(?:\/(file|finalize))?$/,
      )
      if (match) {
        const id = decodeURIComponent(match[1]),
          action = match[2]
        if (action === 'file' && req.method === 'GET') {
          const bytes = await store.binary(id)
          res.writeHead(200, {
            'Content-Type': 'model/gltf-binary',
            'Content-Length': bytes.length,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          })
          return res.end(bytes)
        }
        if (action === 'finalize' && req.method === 'POST')
          return send(res, 200, {
            asset: await store.finalize(id, await json(req)),
          })
        if (!action && req.method === 'PATCH')
          return send(res, 200, {
            asset: await store.update(id, await json(req)),
          })
        if (!action && req.method === 'DELETE')
          return send(
            res,
            200,
            await store.remove(
              id,
              url.searchParams.get('cascade') === '1',
              url.searchParams.get('pending') === '1',
            ),
          )
      }
      return send(res, 404, { error: 'Unknown asset endpoint' })
    } catch (error) {
      return send(
        res,
        error.status || (error instanceof URIError ? 400 : 500),
        {
          error: error.status
            ? error.message
            : error instanceof URIError
              ? 'Invalid URL encoding'
              : 'Asset storage failed; check the server data directory and retry',
        },
      )
    }
  }
}
