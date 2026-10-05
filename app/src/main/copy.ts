// 取り込んだ写しを、画面（renderer）に渡す。
//
// 写しの HTML は、IPC で文字列として渡し、画面側で iframe の srcdoc に入れる。srcdoc の iframe は親と同じ出どころになるので、
// 中の DOM を測ったり書き換えたりできる。写しの中の画像やフォントは、copy:// という独自のプロトコルで配る。
import { app, ipcMain, net, protocol } from 'electron'
import { readFile } from 'node:fs/promises'
import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

// いまは試作 2 が取り込んだ写しを借りる。取り込みを移したら、アプリの保存先（userData）に変える
const COPY_DIR =
  process.env['DESIGN_STUDY_COPY_DIR'] ||
  join(app.getAppPath(), '../prototypes/02-say-and-pick/copy')

// 準備ができる前に呼ぶ必要がある
export function registerCopyScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'copy',
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
    }
  ])
}

export function serveCopies(): void {
  // copy://<写しの名前>/<ファイル> を、写しのフォルダの中のファイルに対応させる
  protocol.handle('copy', async (request) => {
    const url = new URL(request.url)
    const root = join(COPY_DIR, url.hostname)
    const file = normalize(join(root, decodeURIComponent(url.pathname)))
    if (!file.startsWith(root + sep)) return new Response(null, { status: 403 })
    const response = await net.fetch(pathToFileURL(file).href)
    // srcdoc の中から読むフォントは別の出どころ扱いになるので、読めるように許可を付ける
    const headers = new Headers(response.headers)
    headers.set('access-control-allow-origin', '*')
    return new Response(response.body, { status: response.status, headers })
  })

  // 写しの HTML。中の相対パス（assets/…）が copy:// を指すように、基準の場所を書き足す
  ipcMain.handle('copy:html', async (_event, slug: string) => {
    if (!/^[\w-]+$/.test(slug)) throw new Error('写しの名前が正しくありません')
    const html = await readFile(join(COPY_DIR, slug, 'snapshot.html'), 'utf8')
    return html.replace(/<head([^>]*)>/i, `<head$1><base href="copy://${slug}/">`)
  })
}
