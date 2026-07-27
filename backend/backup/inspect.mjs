import { existsSync, readdirSync, readFileSync, statSync } from 'bare-fs'
import b4a from 'b4a'

export function inspectStorage (storagePath) {
  if (!existsSync(storagePath)) {
    return { ok: false, error: 'Storage path does not exist', path: storagePath, files: [] }
  }

  const items = []

  function walk (dir, relativeDir = '') {
    let entries = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (err) {
      return
    }

    for (const entry of entries) {
      const relPath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
      const fullPath = `${dir}/${entry.name}`
      try {
        const stat = statSync(fullPath)
        if (stat.isDirectory()) {
          items.push({
            name: relPath,
            type: 'dir',
            size: 0,
            mtime: stat.mtime ? stat.mtime.toISOString() : null
          })
          if (relativeDir.split('/').length < 3) {
            walk(fullPath, relPath)
          }
        } else {
          let content = null
          if (relPath.endsWith('.json') && stat.size < 500000) {
            try {
              content = b4a.toString(readFileSync(fullPath), 'utf8')
            } catch (readErr) {}
          }
          items.push({
            name: relPath,
            type: 'file',
            size: stat.size,
            mtime: stat.mtime ? stat.mtime.toISOString() : null,
            content
          })
        }
      } catch (statErr) {}
    }
  }

  walk(storagePath)

  return {
    ok: true,
    path: storagePath,
    files: items
  }
}
