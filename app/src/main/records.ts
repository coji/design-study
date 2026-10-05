// 記録。1 回の練習を 1 つのフォルダにして、人が読む Markdown、機械が読む JSON、元と各案の画像を置く。
// ただのファイルにしておくと、AI がそのまま読める。用語集を作る、苦手を集計する、ハーネスのルールを書き起こす、に使える。
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  StoredRecord,
  type PracticeRecord,
  type RecordInput,
  type RecordOption,
  type Theory
} from '@shared/schema'
import { recordsDir } from './store'

type Stored = RecordInput & { at: string }

const pad = (n: number): string => String(n).padStart(2, '0')
function stamp(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}
const picked = (r: Stored): RecordOption =>
  r.options.find((o) => o.letter === r.picked) ?? r.options[0]

/** 記録の行き先は製品。選んだ案を、製品のコーディングエージェントにそのまま渡せる指示にする */
export function instruction(r: Stored): string {
  const o = picked(r)
  const text = r.element.text
  const where = `${r.page} の「${text.slice(0, 30)}${text.length > 30 ? '…' : ''}」（${r.element.tag}）`
  if (o.isOriginal) return `${where}は、変えない。\n理由: ${r.note}`
  const lines = [`${where}を直す。`, `変えること: ${o.what_changed}`]
  if (o.html) lines.push(`新しい文章: 「${o.html}」`)
  if (o.edits?.length) lines.push(`変える文章: ${o.edits.map((e) => `「${e.html}」`).join('、')}`)
  if (o.css) lines.push(`見た目の値（写しに当てた CSS。値を参考にする）: ${o.css}`)
  lines.push(`理由: ${r.note}`)
  return lines.join('\n')
}

function markdown(r: Stored): string {
  const theory = (t: Theory | null | undefined): string =>
    t ? `${t.claim}（${t.level}。出どころ: ${t.source}）` : '理論帳に当てはまる項目なし'
  const o = picked(r)
  const original = r.options.find((x) => x.isOriginal)
  const more = r.more.map((m) => `>\n> （案を見て言い足した）${m}\n`).join('')
  const rounds = r.rounds
    .map(
      (round, i) =>
        `## 作り直す前の案（${i + 1} 回目）\n\n${round.map((x) => `- ${x.label}。${x.what_changed}`).join('\n')}\n\n`
    )
    .join('')
  const options = r.options
    .map((x) => {
      const measured = x.changes?.length ? `\n  - 測った変化: ${x.changes.join('／')}` : ''
      return `- ${x.letter}${x.letter === r.picked ? '（選んだ）' : ''}: ${x.label}。${x.what_changed}${measured}\n  - 理論: ${theory(x.theory)}\n  - 判定: ${x.verdict}。${x.verdict_text}`
    })
    .join('\n')
  const changed = `${o.html ? `変えた文章:\n\n> ${o.html}\n\n` : ''}${o.css ? `変えた CSS:\n\n\`\`\`css\n${o.css}\n\`\`\`\n\n` : ''}`
  return `# ${r.page} の「${r.element.text.slice(0, 20)}…」

- 日時: ${new Date(r.at).toLocaleString('ja-JP')}
- 画面: ${r.page}${r.url ? `（${r.url}）` : ''}
- 指したところ: ${r.element.tag} 「${r.element.text}」
- いまの値: ${Object.entries(r.element.values)
    .map(([k, v]) => `${k} ${v}`)
    .join('、')}

## 感じたこと

> ${r.oneLiner}
${more}
AI の読み: ${r.reading ?? ''}

${rounds}## 並んだ案

${options}

## 選んだ案

${o.letter}: ${o.label}。理論との関係は「${o.verdict}」。

${changed}## 自分の言葉

> ${r.note}

## 元と、選んだ案

| | PC 幅 | スマホ幅 |
|---|---|---|
| 元 | ![](pc-${original?.letter}.jpg) | ![](sp-${original?.letter}.jpg) |
| 選んだ案 | ![](pc-${r.picked}.jpg) | ![](sp-${r.picked}.jpg) |

## 製品に渡す指示

${instruction(r)}
`
}

/** 記録を保存する。返すのは、フォルダの名前（id）と場所、製品に渡す指示文 */
export async function save(
  input: RecordInput
): Promise<{ id: string; dir: string; record: Stored; instruction: string }> {
  const record: Stored = { at: new Date().toISOString(), ...input }
  const id = stamp()
  const dir = join(recordsDir(), id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'record.json'), JSON.stringify(record, null, 1))
  await writeFile(join(dir, 'record.md'), markdown(record))
  return { id, dir, record, instruction: instruction(record) }
}

/** 記録の一覧。古い順。読めないフォルダは飛ばす */
export async function list(): Promise<PracticeRecord[]> {
  const names = (await readdir(recordsDir()).catch(() => [] as string[])).sort()
  const records: PracticeRecord[] = []
  for (const id of names) {
    try {
      const parsed = StoredRecord.parse(
        JSON.parse(await readFile(join(recordsDir(), id, 'record.json'), 'utf8'))
      )
      records.push({ ...parsed, id, instruction: instruction(parsed) })
    } catch {
      // 記録でないフォルダや、壊れた記録は一覧に出さない
    }
  }
  return records
}
