// OpenAI の Sign in with ChatGPT DevKit を取得して、このアプリで使える形にビルドする。
//
// DevKit は npm に置かれておらず、ライセンスが非商用（Sign-In with ChatGPT DevKit Noncommercial License）なので、
// このリポジトリには入れない。使う人の手元で、決めた版を取得する。取得先は app/vendor/（リポジトリには入れない）。
//
// 取得したあと、2 か所に手を入れる（どちらも packages/local/src の中。変更したファイルには、その旨を書き足す）。
//   1. 画像つきの入力を通す。元は、文字だけの入力しか受け付けない
//   2. 送る本文に、追加の項目（考える深さなど）を足せるようにする
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = 'https://github.com/openai/sign-in-with-chatgpt-devkit.git'
// 動くことを確かめた版。上げるときは、下の書き換えが当たるかを確かめる
const COMMIT = 'f723814abdccec135b519c451fb6e1992ee5e933'

const app = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(app, 'vendor/sign-in-with-chatgpt-devkit')
const local = join(dir, 'packages/local')
const marker = join(dir, '.design-study-setup')
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' })

if (
  existsSync(marker) &&
  readFileSync(marker, 'utf8').trim() === COMMIT &&
  existsSync(join(local, 'dist/index.js'))
)
  process.exit(0)

console.log('DevKit を取得します:', COMMIT.slice(0, 7))
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
run('git', ['init', '-q'], dir)
run('git', ['fetch', '-q', '--depth', '1', REPO, COMMIT], dir)
run('git', ['checkout', '-q', 'FETCH_HEAD'], dir)

// 決めた文字列が見つからなければ止める。元のコードが変わったのに、気づかず進むのを防ぐ
function edit(file, replacements) {
  const path = join(local, 'src', file)
  let text = readFileSync(path, 'utf8')
  for (const [from, to] of replacements) {
    if (!text.includes(from))
      throw new Error(
        `${file}: 書き換える箇所が見つかりません。DevKit の版を確かめてください\n  ${from}`
      )
    text = text.replace(from, to)
  }
  writeFileSync(
    path,
    `// Modified by Design Study (scripts/setup-devkit.mjs): accept image content and extra request fields.\n${text}`
  )
}
edit('responses.ts', [
  [
    'typeof message.content !== "string"',
    '(typeof message.content !== "string" && !Array.isArray(message.content))'
  ],
  [
    '      store: false,\n      stream: true,',
    '      ...(options.extra ?? {}),\n      store: false,\n      stream: true,'
  ]
])
edit('types.ts', [
  [
    '  role: "user" | "assistant" | "developer";\n  content: string;',
    '  role: "user" | "assistant" | "developer";\n  content: string | Record<string, unknown>[];'
  ],
  [
    '  input: string | ResponseInputMessage[];\n  instructions?: string;',
    '  input: string | ResponseInputMessage[];\n  instructions?: string;\n  /** Extra fields merged into the request body (for example, reasoning effort). */\n  extra?: Record<string, unknown>;'
  ]
])

console.log('DevKit をビルドします')
run(
  process.execPath,
  [join(app, 'node_modules/typescript/bin/tsc'), '-p', join(local, 'tsconfig.json')],
  app
)
writeFileSync(marker, COMMIT + '\n')
console.log('DevKit の準備ができました')
