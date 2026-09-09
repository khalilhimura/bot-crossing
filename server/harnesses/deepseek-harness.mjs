/**
 * Harness adapter: DeepSeek Harness (DSH) — runs as `dsh web` on the local machine.
 *
 * Everything that knows where DSH keeps its session data lives in this one module.
 * `server/scan.mjs` never reaches past the adapter interface, so adding another harness
 * means writing a sibling of this file rather than editing the scanner. The contract is
 * written down in `server/harnesses/README.md`.
 *
 * DSH stores session metadata in a JSON projection cache and the raw compacted
 * conversation log in per-session zstd-compressed JSONL files:
 *   - `~/.dsh/storages/session_projcache.json` — fast index of every session (title, cwd,
 *     timestamps, token usage, pending step state, blank/archived flags)
 *   - `~/.dsh/storages/workspace.json` — maps workspace (repo) paths to session IDs,
 *     including which sessions have been archived
 *   - `~/.dsh/sessions/<encoded-cwd>/<session-id>/session.jsonl.zstd` — the compressed
 *     conversation log for size estimation
 *   - `$DSH_HOME` defaults to `~/.dsh/`
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { exists, listFiles, num } from '../lib/fsutil.mjs'

const execFileAsync = promisify(execFile)
const HOME = os.homedir()
const DSH_HOME = process.env.DSH_HOME || path.join(HOME, '.dsh')

/** Paths relative to DSH home. */
const STORAGE_DIR = path.join(DSH_HOME, 'storages')
const SESSIONS_DIR = path.join(DSH_HOME, 'sessions')
const SESSION_CACHE_FILE = path.join(STORAGE_DIR, 'session_projcache.json')
const WORKSPACE_FILE = path.join(STORAGE_DIR, 'workspace.json')

/** How recently a session must have had activity to count as "running right now". */
const ACTIVE_WINDOW_MS = 30 * 60 * 1000

/**
 * Decode a DSH directory name like `--Users-khalilhimura-Projects-bot-crossing--` back
 * to an absolute path. DSH encodes `/` as `-` and the leading `/` becomes `-` too.
 * Windows paths like `C--Users-...` decode the drive letter from the first segment.
 */
function decodeDshDirName(dirName) {
  // Strip leading and trailing `--` if present
  let name = dirName
  if (name.startsWith('--') && name.endsWith('--')) {
    name = name.slice(2, -2)
  }

  // Check for Windows drive letter: `C--Users-...`
  const drive = /^([A-Za-z])-(.*)$/.exec(name)
  if (drive) return `${drive[1]}:\\${drive[2].replace(/-/g, '\\')}`

  // macOS/Linux: encoded absolute path where / = -, starts with -
  return name.startsWith('-') ? '/' + name.slice(1).replace(/-/g, '/') : name
}

/**
 * Read the session projection cache — the fast metadata index.
 * Returns a Map of session-id → metadata.
 */
async function readSessionCache() {
  try {
    const raw = await fsp.readFile(SESSION_CACHE_FILE, 'utf8')
    const data = JSON.parse(raw)
    const sessions = data?.tables?.sessions
    if (!sessions || typeof sessions !== 'object') return new Map()
    return new Map(Object.entries(sessions))
  } catch {
    return new Map()
  }
}

/**
 * Read the workspace registry — maps workspaces (repos) to session IDs.
 * Returns `{ workspaces, archivedIds }`.
 */
async function readWorkspaceRegistry() {
  try {
    const raw = await fsp.readFile(WORKSPACE_FILE, 'utf8')
    const data = JSON.parse(raw)
    const workspaces = data?.tables?.workspaces
    const archivedIds = new Set(data?.global?.archivedSessionIds || [])
    return {
      workspaces: workspaces && typeof workspaces === 'object'
        ? Object.values(workspaces)
        : [],
      archivedIds,
    }
  } catch {
    return { workspaces: [], archivedIds: new Set() }
  }
}

/**
 * Get the size of the session's compressed conversation log to use as
 * the "how finished a building looks" metric.
 */
const sizeCache = new Map()
async function sessionSize(sessionId) {
  const cached = sizeCache.get(sessionId)
  if (cached && Date.now() - cached.checkedAt < 15000) return cached.size

  // DSH stores sessions at: ~/.dsh/sessions/<encoded-cwd>/<session-id>/session.jsonl.zstd
  // Walk the sessions directory to find the matching file without knowing the cwd encoding.
  try {
    const entries = await fsp.readdir(SESSIONS_DIR, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const sessionDir = path.join(SESSIONS_DIR, entry.name, sessionId)
      const logFile = path.join(sessionDir, 'session.jsonl.zstd')
      if (await exists(logFile)) {
        const stat = await fsp.stat(logFile)
        const result = { size: stat.size }
        sizeCache.set(sessionId, { ...result, checkedAt: Date.now() })
        return result
      }
    }
  } catch {
    // session directory may not exist
  }

  const result = { size: 0 }
  sizeCache.set(sessionId, { ...result, checkedAt: Date.now() })
  return result
}

async function scanThreads() {
  const [sessionCache, { workspaces, archivedIds }] = await Promise.all([
    readSessionCache(),
    readWorkspaceRegistry(),
  ])

  // Build a lookup: workspace path → workspace title for project names
  const workspaceByPath = new Map()
  for (const ws of workspaces) {
    if (ws.path) workspaceByPath.set(ws.path, ws)
  }

  const now = Date.now()
  const threads = []

  for (const [sessionId, sessionData] of sessionCache) {
    const identity = sessionData.identity || {}
    const rows = sessionData.rows || {}

    const cwd = identity.cwd || ''
    const createdAt = identity.createdAt || 0
    const title = rows.title?.val || ''
    const stats = rows.sessionStats?.val || {}
    const metadata = rows.sessionListMetadata?.val || {}

    // "Running" means the session has an open step (agent is processing a turn)
    const openStep = stats.openStep
    const hasOpenStep = openStep !== null && openStep !== undefined
    const lastPromptAt = metadata.lastPromptAt || 0
    const openStepTime = hasOpenStep ? (openStep.startTime || 0) : 0
    const lastActivityAt = lastPromptAt || openStepTime || stats.createdAt || createdAt || 0

    // Determine the project from cwd
    const projectPath = cwd
    let project = ''
    if (projectPath) {
      const ws = workspaceByPath.get(projectPath)
      project = ws?.title || path.basename(projectPath)
    }

    // Archived flag from the workspace registry
    const archived = archivedIds.has(sessionId)

    // Session size from the compressed log
    const { size: sizeBytes } = await sessionSize(sessionId)

    // Check if the session has errors
    const hasError = Boolean(stats.error)

    // Determine if session is "unread" (new activity since last focused)
    // DSH doesn't expose focus tracking per session in the projection cache,
    // so we leave unread as false for now.
    const unread = false

    // Running = has an open step AND recent activity
    const running = hasOpenStep && (now - lastActivityAt < ACTIVE_WINDOW_MS)

    threads.push({
      id: sessionId,
      harness: 'deepseek-harness',
      title: title || 'Untitled thread',
      preview: '',  // DSH doesn't expose first prompt in the projection cache
      project: project || path.basename(projectPath) || 'unknown',
      projectPath,
      worktree: '',
      cwd,
      gitBranch: '',
      model: '',  // Not stored in the projection cache
      effort: '',
      createdAt,
      lastActivityAt,
      lastFocusedAt: 0,
      running,
      unread,
      hasError,
      starred: false,
      routine: '',
      prState: '',
      archived,
      hasTranscript: sizeBytes > 0,
      sizeBytes,
      source: 'dsh-web',
      canOpen: true,
      canArchive: false,
      ref: { sessionId },
    })
  }

  return threads
}

/**
 * Open a DSH session in the browser. DSH is a web app at the configured
 * port (defaults to 3080 for the running `dsh web` process). The SPA
 * doesn't support direct session URLs through path routing — it uses
 * client-side navigation — so we open the root and let the user navigate.
 *
 * A future improvement could use DSH's `dsh-session:` URI scheme or the
 * the DSH web app's internal JSON-RPC API to navigate directly.
 */
function openThread(ref) {
  const sessionId = ref?.sessionId
  if (!sessionId) return { ok: false, error: 'No session id provided' }
  try {
    return { ok: true, url: `http://127.0.0.1:3080/` }
  } catch {
    return { ok: false, error: 'Could not build DSH web URL' }
  }
}

/**
 * DSH doesn't support deep-linking into a new session at a specific
 * directory. New sessions are started from the web UI.
 */
function newSession(dir) {
  return { ok: false, error: 'Start new sessions from the DSH web interface at http://127.0.0.1:3080/' }
}

/**
 * DSH doesn't have a per-session archive toggle in the harness's own
 * records. Archiving is tracked on the colony side only.
 */
async function setArchived(ref, archived) {
  return { ok: false, error: 'DSH does not support per-session archiving from external tools. Archive sessions from the DSH web interface.' }
}

/**
 * When the `dsh web` process last started — used to tell an archive
 * marker that has already been picked up from one still waiting on disk.
 * This is relevant because the `dsh web` process loads the session cache
 * at startup and may overwrite external changes.
 */
let appStartCache = { at: 0, checkedAt: 0 }
async function appStartedAt() {
  const now = Date.now()
  if (now - appStartCache.checkedAt < 15000) return appStartCache.at

  let started = 0
  try {
    const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,lstart=,command='], { maxBuffer: 8 * 1024 * 1024 })
    for (const line of stdout.split('\n')) {
      const m = line.match(/^\s*\d+\s+(\w{3} \w{3}\s+\d+ \d{2}:\d{2}:\d{2} \d{4})\s+(\/.*dsh.*)$/)
      if (!m) continue
      const [, when, command] = m
      if (!command.includes('/dsh ') && !command.includes('/dsh"')) continue
      const parsed = Date.parse(when)
      if (!Number.isNaN(parsed) && parsed > started) started = parsed
    }
  } catch {
    /* no process listing — treat as never having restarted */
  }
  appStartCache = { at: started, checkedAt: now }
  return started
}

export default {
  id: 'deepseek-harness',
  name: 'DeepSeek Harness',
  detect: async () => await exists(SESSION_CACHE_FILE),
  scanThreads,
  openThread,
  newSession,
  setArchived,
  appStartedAt,
  paths: { DSH_HOME, SESSION_CACHE_FILE, WORKSPACE_FILE },
}
