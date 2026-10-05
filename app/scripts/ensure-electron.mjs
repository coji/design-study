// Electron 本体が展開されているかを確かめ、足りなければ展開し直す。
//
// Node の版によっては、electron の postinstall が本体の圧縮ファイルを途中までしか展開しない
// （node_modules/electron/dist にライセンスのファイルだけが入り、起動時に「Electron uninstall」で止まる）。
// そのときは、取得済みの圧縮ファイルを OS の unzip で展開する。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const electron = dirname(require.resolve('electron/package.json'))
const { version } = require('electron/package.json')
if (existsSync(join(electron, 'path.txt'))) process.exit(0)
if (process.platform !== 'darwin') {
  console.error(
    'Electron 本体が展開されていません。node node_modules/electron/install.js を試してください'
  )
  process.exit(0)
}

const cache = process.env.electron_config_cache || join(homedir(), 'Library/Caches/electron')
const name = `electron-v${version}-darwin-${process.arch}.zip`
const find = (dir) => {
  for (const entry of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = find(path)
      if (found) return found
    } else if (entry.name === name) return path
  }
  return null
}
let zip = find(cache)
if (!zip) {
  // まだ取得していなければ、electron 自身の手順で取得だけさせる（展開は失敗してもよい）
  try {
    execFileSync(process.execPath, [join(electron, 'install.js')], { stdio: 'inherit' })
  } catch {}
  if (existsSync(join(electron, 'path.txt'))) process.exit(0)
  zip = find(cache)
}
if (!zip) {
  console.error(
    `Electron 本体（${name}）が見つかりません。ネットワークを確かめて、pnpm install をやり直してください`
  )
  process.exit(1)
}
console.log('Electron 本体を展開し直します:', name)
const dist = join(electron, 'dist')
rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })
execFileSync('unzip', ['-q', zip, '-d', dist])
writeFileSync(join(electron, 'path.txt'), 'Electron.app/Contents/MacOS/Electron')
