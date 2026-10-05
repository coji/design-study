// 使う人が作るもの（取り込んだ写し、記録、理論帳）の置き場所。リポジトリの中には置かない。
// 既定はアプリの保存先（userData）の中。設定で、別のフォルダに変えられる（記録を、自分の非公開の場所に置きたいとき）。
import { app } from 'electron'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Settings } from '@shared/schema'
import bundledTheory from '../../../docs/theory-v0.md?asset'

const settingsFile = (): string => join(app.getPath('userData'), 'settings.json')
const defaultDataDir = (): string => join(app.getPath('userData'), 'data')

function saved(): { dataDir?: string } {
  try {
    return JSON.parse(readFileSync(settingsFile(), 'utf8'))
  } catch {
    return {}
  }
}

/** 写しと記録を置く場所。環境変数（試験用）、設定、既定の順で決まる */
export function dataDir(): string {
  return process.env['DESIGN_STUDY_DATA_DIR'] || saved().dataDir || defaultDataDir()
}
export const copiesDir = (): string => join(dataDir(), 'copies')
export const recordsDir = (): string => join(dataDir(), 'records')
export const lastRoundFile = (): string => join(dataDir(), 'last-round.json')

export function settings(): Settings {
  const dir = dataDir()
  return { dataDir: dir, isDefault: dir === defaultDataDir() }
}
export async function setDataDir(dir: string | null): Promise<Settings> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(settingsFile(), JSON.stringify(dir ? { dataDir: dir } : {}, null, 2))
  return settings()
}

/** 理論帳。初めて使うときに、アプリに入っている版を保存先へ写す。写したあとは、使う人が自分で書き足していける */
export async function theory(): Promise<string> {
  const file = join(dataDir(), 'theory.md')
  if (!existsSync(file)) {
    await mkdir(dataDir(), { recursive: true })
    await copyFile(bundledTheory, file)
  }
  return readFile(file, 'utf8')
}
