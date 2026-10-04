import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'

const sourceRoot = path.resolve(process.cwd(), 'src')

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(fullPath)
    return /\.(?:js|jsx|ts|tsx)$/.test(entry.name) ? [fullPath] : []
  }))
  return nested.flat()
}

test('Toast singleton: solo AppToaster monta react-hot-toast', async () => {
  const files = await sourceFiles(sourceRoot)
  const toasterMounts = []

  for (const file of files) {
    const content = await readFile(file, 'utf8')
    const mounts = content.match(/<Toaster\b/g) || []
    if (mounts.length) toasterMounts.push({ file, count: mounts.length })
  }

  assert.deepEqual(toasterMounts, [
    { file: path.join(sourceRoot, 'shared', 'components', 'ui', 'AppToaster.jsx'), count: 1 },
  ])
})

test('AppToaster conserva el formato visual global original', async () => {
  const file = path.join(sourceRoot, 'shared', 'components', 'ui', 'AppToaster.jsx')
  const content = await readFile(file, 'utf8')

  for (const expected of [
    'position="top-right"',
    'containerStyle={{ top: 20, right: 20 }}',
    "borderRadius: '12px'",
    "padding:      '12px 16px'",
    "maxWidth:     '380px'",
    "borderLeft: '3px solid #10b981'",
    "borderLeft: '3px solid #f43f5e'",
  ]) {
    assert.match(content, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})
