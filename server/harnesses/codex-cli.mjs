/**
 * Harness adapter: Codex CLI (OpenAI) — the ChatGPT desktop app / Codex framework.
 *
 * Everything that knows the shape of Codex's own files lives in this one module.
 * `server/scan.mjs` never reaches past the adapter interface, so adding another harness
 * means writing a sibling of this file rather than editing the scanner. The contract is
 * written down in `server/harnesses/README.md`.
 *
 * Data stores (all under `~/.codex/`):
 *   - `state_5.sqlite` — the `threads` table: every thread's id, title, cwd, model,
 *     timestamps, archived flag, git branch, first prompt, rollout path
 *   - `thread_history_1.sqlite` — the `thread_history_projection_state` table maps
 *     thread id to next_rollout_byte_offset (transcript size)
 *   - `.codex-global-state.json` — maps thread ids to project assignments via
 *     `thread-project-assignments`, and `local-projects` / `project_roots`
 *   - `session_index.jsonl` — quick name + updated_at index
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { exists, num } from '../lib/fsutil.mjs'

const execFileAsync = promisify(execFile)
const HOME = os.homedir()

/** Codex data directory (the CLI and the ChatGPT desktop app share ~/.codex/). */
const CODEX_DIR = path.join(HOME, '.codex')

/** SQLite databases holding thread metadata and history. */
const STATE_DB = path.join(CODEX_DIR, 'state_5.sqlite')
const HISTORY_DB = path.join(CODEX_DIR, 'thread_history_1.sqlite')

/** JSONL index of thread names. */
const SESSION_INDEX_FILE = path.join(CODEX_DIR, 'session_index.jsonl')

/** How recently a thread must have been updated to count as "running right now". */
const ACTIVE_WINDOW_MS = 30 * 60 * 1000

/** Cache session metadata to avoid re-parsing on every poll. */
let sessionIndexCache = { entries: null, mtime: 0 }
let projectCache = { assignments: null, projects: null, checkedAt: 0 }

/**
 * Read the session_index.jsonl for quick name/updated_at lookups.
 * Returns a Map of thread-id → { name, updatedAt }.
 */
async function readSessionIndex() {
  try {
    const stat = await fsp.stat(SESSION_INDEX_FILE)
    if (sessionIndexCache.entries !== null && stat.mtimeMs === sessionIndexCache.mtime) {
      return sessionIndexCache.entries
    }
    const raw = await fsp.readFile(SESSION_INDEX_FILE, 'utf8')
    const lines = raw.trim().split('\n')
    const entries = new Map()
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('{')) continue
      try {
        const rec = JSON.parse(trimmed)
        if (rec.id) {
          entries.set(rec.id, {
            name: rec.thread_name || '',
            updatedAt: rec.updated_at ? new Date(rec.updated_at).getTime() || 0 : 0,
          })
        }
      } catch {
        // malformed line — skip
      }
    }
    sessionIndexCache = { entries, mtime: stat.mtimeMs }
    return entries
  } catch {
    return new Map()
  }
}

/**
 * Read project assignments from the global state JSON.
 * Returns { assignments: Map<threadId, projectId>, projects: Map<projectId, {name, rootPaths}> }.
 */
async function readProjectData() {
  const now = Date.now()
  if (projectCache.assignments !== null && now - projectCache.checkedAt < 30000) {
    return projectCache
  }

  const globalStateFile = path.join(CODEX_DIR, '.codex-global-state.json')
  try {
    const raw = await fsp.readFile(globalStateFile, 'utf8')
    const data = JSON.parse(raw)

    const assignments = new Map()
    const rawAssignments = data['thread-project-assignments'] || {}
    for (const [threadId, val] of Object.entries(rawAssignments)) {
      if (val && val.projectId) {
        assignments.set(threadId, val.projectId)
      }
    }

    const projects = new Map()
    const rawProjects = data['local-projects'] || {}
    for (const [id, proj] of Object.entries(rawProjects)) {
      if (proj && proj.name) {
        projects.set(id, {
          name: proj.name,
          rootPaths: proj.rootPaths || [],
        })
      }
    }

    projectCache = { assignments, projects, checkedAt: now }
    return projectCache
  } catch {
    return projectCache
  }
}

/**
 * SQLite reader — tries better-sqlite3 first, then falls back to the `sqlite3` CLI.
 *
 * Returns an object with a `query(sql, params?)` method. Each call returns an array of rows.
 * The first successful method is cached for the lifetime of the process.
 */
let reader = null
async function getReader() {
  if (reader) return reader

  // Try better-sqlite3
  try {
    const betterSqlite3 = (await import('better-sqlite3')).default
    reader = {
      query(sql, params) {
        const db = betterSqlite3(STATE_DB, { readonly: true })
        try {
          return params ? db.prepare(sql).all(params) : db.prepare(sql).all()
        } finally {
          db.close()
        }
      },
      get(sql, params) {
        const db = betterSqlite3(STATE_DB, { readonly: true })
        try {
          return params ? db.prepare(sql).get(params) : db.prepare(sql).get()
        } finally {
          db.close()
        }
      },
    }
    return reader
  } catch {
    // better-sqlite3 not available — use sqlite3 CLI fallback
  }

  // Fallback: sqlite3 CLI
  reader = {
    async query(sql) {
      const { stdout } = await execFileAsync('sqlite3', [
        '-readonly', '-json', STATE_DB, sql,
      ], { maxBuffer: 256 * 1024 * 1024 })
      return stdout.trim() ? JSON.parse(stdout) : []
    },
    async get(sql) {
      const rows = await this.query(sql)
      return rows[0] || null
    },
  }
  return reader
}

/**
 * Same pattern for the history database (thread_history_1.sqlite).
 */
let historyReader = null
async function getHistoryReader() {
  if (historyReader) return historyReader

  try {
    const betterSqlite3 = (await import('better-sqlite3')).default
    historyReader = {
      get(sql, params) {
        const db = betterSqlite3(HISTORY_DB, { readonly: true })
        try {
          return params ? db.prepare(sql).get(params) : db.prepare(sql).get()
        } finally {
          db.close()
        }
      },
    }
    return historyReader
  } catch {
    // fallback
  }

  historyReader = {
    async get(sql) {
      const { stdout } = await execFileAsync('sqlite3', [
        '-readonly', '-json', HISTORY_DB, sql,
      ], { maxBuffer: 8 * 1024 * 1024 })
      const rows = stdout.trim() ? JSON.parse(stdout) : []
      return rows[0] || null
    },
  }
  return historyReader
}

/**
 * Query the `threads` table in state_5.sqlite.
 */
async function queryThreads() {
  const db = await getReader()
  if (!db) return []

  try {
    return await db.query(`
      SELECT
        id,
        rollout_path,
        created_at_ms,
        updated_at_ms,
        title,
        cwd,
        model,
        archived,
        git_sha,
        git_branch,
        git_origin_url,
        first_user_message,
        preview,
        tokens_used,
        project_id
      FROM threads
      ORDER BY updated_at_ms DESC
    `)
  } catch {
    return []
  }
}

/**
 * Get the transcript file size for a thread.
 * Uses next_rollout_byte_offset from thread_history_projection_state
 * or falls back to fsp.stat on the rollout file.
 */
const sizeCache = new Map()
async function getTranscriptSize(threadId, rolloutPath) {
  const cached = sizeCache.get(threadId)
  if (cached && Date.now() - cached.checkedAt < 15000) return cached.size

  // Try to get size from thread_history_projection_state first (more reliable)
  try {
    const db = await getHistoryReader()
    if (db) {
      const row = await db.get(
        'SELECT next_rollout_byte_offset FROM thread_history_projection_state WHERE thread_id = ?',
        [threadId]
      )
      if (row && row.next_rollout_byte_offset > 0) {
        const result = { size: row.next_rollout_byte_offset }
        sizeCache.set(threadId, { ...result, checkedAt: Date.now() })
        return result
      }
    }
  } catch {
    // fall through
  }

  // Fallback: stat the rollout file directly
  if (rolloutPath) {
    try {
      const stat = await fsp.stat(rolloutPath)
      const result = { size: stat.size }
      sizeCache.set(threadId, { ...result, checkedAt: Date.now() })
      return result
    } catch {
      // file may not exist yet
    }
  }

  const result = { size: 0 }
  sizeCache.set(threadId, { ...result, checkedAt: Date.now() })
  return result
}

/**
 * Determine which project a thread belongs to.
 * Uses the thread-project-assignments map from global state JSON,
 * then falls back to the cwd for projectless threads.
 */
function resolveProject(threadId, cwd, projectData) {
  const projectId = projectData.assignments.get(threadId)
  if (projectId) {
    const project = projectData.projects.get(projectId)
    if (project) {
      const rootPath = project.rootPaths[0] || ''
      return {
        project: project.name,
        projectPath: rootPath,
      }
    }
  }

  // Fallback: derive from cwd
  if (cwd) {
    return {
      project: path.basename(cwd),
      projectPath: cwd,
    }
  }

  return { project: 'unknown', projectPath: '' }
}

async function scanThreads() {
  const [threads, sessionIndex, projectData] = await Promise.all([
    queryThreads(),
    readSessionIndex(),
    readProjectData(),
  ])

  const now = Date.now()
  const result = []

  for (const t of threads) {
    const threadId = t.id
    if (!threadId) continue

    const cwd = t.cwd || ''
    const { project, projectPath } = resolveProject(threadId, cwd, projectData)

    // Title: prefer `title` from threads table, then session_index name
    // Codex stores ChatGPT conversation references in the title field for
    // imported threads — skip those and use the session_index name instead.
    const indexEntry = sessionIndex.get(threadId)
    const rawTitle = t.title || ''
    const isChatGptReference = rawTitle.startsWith('## Referenced ChatGPT conversation:')
    const title = isChatGptReference
      ? (indexEntry && indexEntry.name) || 'Untitled thread'
      : rawTitle || (indexEntry && indexEntry.name) || 'Untitled thread'

    // Preview / first user message: clean up ChatGPT references for the preview
    const rawPreview = t.first_user_message || t.preview || ''
    const preview = isChatGptReference && rawPreview.startsWith('## Referenced ChatGPT conversation:')
      ? rawPreview.replace(/^## Referenced ChatGPT conversation:[\s\S]*?## My request:\s*/, '').slice(0, 240)
      : rawPreview.slice(0, 240)

    // Timestamps: use ms-granularity fields when available
    const createdAt = t.created_at_ms || 0
    const updatedAtMs = t.updated_at_ms || 0
    const indexUpdatedAt = indexEntry ? indexEntry.updatedAt : 0
    const lastActivityAt = updatedAtMs || indexUpdatedAt || createdAt || 0

    // Model info
    const model = t.model || ''

    // Archived flag
    const archived = Boolean(t.archived)

    // Transcript size (used for building appearance)
    const rolloutPath = t.rollout_path || ''
    const { size: sizeBytes } = await getTranscriptSize(threadId, rolloutPath)

    // Determine if the thread is "running" by checking if the session file
    // has been modified very recently. Codex treats threads as running when
    // actively processing a turn — which shows up as writes to the JSONL.
    // We can't see "currently processing" from the SQLite data alone, but
    // recent file activity is a reliable proxy.
    let running = false
    if (rolloutPath) {
      try {
        const stat = await fsp.stat(rolloutPath)
        running = (now - stat.mtimeMs) < ACTIVE_WINDOW_MS
      } catch {
        // file gone or doesn't exist
      }
    }

    // "Unread" is not reliably trackable from the SQLite data alone since
    // Codex doesn't expose per-thread focus timestamps to external readers.
    const unread = false

    // Git info
    const gitBranch = t.git_branch || ''

    // Token usage as a proxy for how much work happened
    const tokensUsed = num(t.tokens_used)

    result.push({
      id: threadId,
      harness: 'codex-cli',
      title,
      preview: preview.slice(0, 240),
      project,
      projectPath,
      worktree: '',
      cwd,
      gitBranch,
      model,
      effort: '',
      createdAt,
      lastActivityAt,
      lastFocusedAt: 0,
      running,
      unread,
      hasError: false,
      starred: false,
      routine: '',
      prState: '',
      archived,
      hasTranscript: sizeBytes > 0,
      sizeBytes,
      source: 'desktop',
      canOpen: true,
      canArchive: true,
      ref: { sessionId: threadId },
    })
  }

  return result
}

/**
 * Open a Codex thread in the ChatGPT desktop app.
 * The app registers the `codex://` URL scheme, but doesn't support
 * direct deep-linking to a specific thread — it opens to the main UI
 * and the user navigates. Use the generic codex:// URL.
 *
 * A future improvement could leverage the app's internal IPC mechanism
 * or the `codex:` URL scheme with query parameters if documented.
 */
function openThread(ref) {
  const sessionId = ref?.sessionId
  if (!sessionId) return { ok: false, error: 'No session id provided' }
  try {
    return { ok: true, url: `codex://` }
  } catch {
    return { ok: false, error: 'Could not build Codex URL' }
  }
}

/**
 * Start a new Codex session rooted in a directory.
 * The ChatGPT desktop app doesn't support deep-linking a new session
 * to a specific directory via URL scheme.
 */
function newSession(dir) {
  return { ok: false, error: 'Start new sessions from the ChatGPT desktop app.' }
}

/**
 * Archive a Codex thread via the `set_thread_archived` background tool.
 * Since we can't call the desktop app's internal API from here, we
 * mark the archive on the colony side only. The chat app's own records
 * are not modified.
 */
async function setArchived(ref, archived) {
  return { ok: false, error: 'Codex does not support per-session archiving from external tools. Archive sessions from the ChatGPT app.' }
}

/**
 * When the ChatGPT / Codex desktop app last launched — used to detect
 * whether an archive marker has been picked up by the app or is still
 * waiting on disk. The app caches session state at startup.
 */
let appStartCache = { at: 0, checkedAt: 0 }
async function appStartedAt() {
  const now = Date.now()
  if (now - appStartCache.checkedAt < 15000) return appStartCache.at

  let started = 0
  try {
    const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,lstart=,command='], { maxBuffer: 8 * 1024 * 1024 })
    for (const line of stdout.split('\n')) {
      const m = line.match(/^\s*\d+\s+(\w{3} \w{3}\s+\d+ \d{2}:\d{2}:\d{2} \d{4})\s+(\/.*)$/)
      if (!m) continue
      const [, when, command] = m
      // Match the main Codex process (not renderer or helper processes)
      if (!command.includes('/ChatGPT.app/Contents/Resources/codex') || command.includes('--type=')) continue
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
  id: 'codex-cli',
  name: 'Codex CLI',
  /** Detect by checking for the state database. */
  detect: async () => await exists(STATE_DB),
  scanThreads,
  openThread,
  newSession,
  setArchived,
  appStartedAt,
  paths: { CODEX_DIR, STATE_DB, HISTORY_DB },
}
