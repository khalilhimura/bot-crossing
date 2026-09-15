const base = `${import.meta.env.BASE_URL}api/assets`

export async function assetRequest(path = '', method = 'GET', body, headers = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body instanceof File ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : body instanceof File ? body : JSON.stringify(body),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || `Asset request failed (${response.status})`)
  return result
}

export const assetPath = (id) => `/${encodeURIComponent(id)}`
