// アプリを実際に起動して、1 回の流れを最後まで通す。AI は呼ばず、決めておいた 1 回分（fixtures/round.json）を再生する。
// 先に electron-vite build が要る（pnpm smoke が両方やる）。
import { _electron as electron } from 'playwright-core'
import { createServer } from 'node:http'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = join(dirname(fileURLToPath(import.meta.url)), '..')
const data = mkdtempSync(join(tmpdir(), 'design-study-smoke-'))
const shots = join(app, 'test-results')
mkdirSync(shots, { recursive: true })
// 練習に使う写しは、試作 2 に入れてある自分のサイトのものを借りる
cpSync(
  join(app, '../prototypes/02-say-and-pick/copy/techtalk-jp'),
  join(data, 'copies/techtalk-jp'),
  { recursive: true }
)

// 取り込みを試すための、小さなページ。CSS は別のファイル、画像は 1 枚
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAEklEQVR4nGNkYPhfz4AHMOKTBAC7JAIBqCkM2wAAAABJRU5ErkJggg==',
  'base64'
)
const site = createServer((request, response) => {
  if (request.url === '/style.css')
    response
      .writeHead(200, { 'content-type': 'text/css' })
      .end('h1 { color: rgb(10, 20, 30); font-size: 40px } .lead { margin: 24px 0 }')
  else if (request.url === '/dot.png')
    response.writeHead(200, { 'content-type': 'image/png' }).end(PNG)
  else
    response
      .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      .end(
        '<!doctype html><html lang="ja"><head><title>取り込みの試験</title><link rel="stylesheet" href="/style.css"><script>document.title += ""</script></head><body><h1>取り込んだ見出し</h1><p class="lead">本文です。</p><img src="/dot.png" width="8" height="8" alt=""></body></html>'
      )
}).listen(0, '127.0.0.1')
await new Promise((done) => site.once('listening', done))
const siteUrl = `http://127.0.0.1:${site.address().port}/`

const check = (ok, what) => {
  console.log(ok ? '  ok ' : '  NG ', what)
  if (!ok) process.exitCode = 1
}

// SMOKE_APP に、ビルドしたアプリの実行ファイルを指定すると、それを試す（配る形で動くかの確認）
const packaged = process.env.SMOKE_APP
const electronApp = await electron.launch({
  ...(packaged ? { executablePath: packaged, args: [] } : { args: [app] }),
  env: {
    ...process.env,
    DESIGN_STUDY_DATA_DIR: data,
    DESIGN_STUDY_MOCK: join(app, 'test/fixtures/round.json'),
    DESIGN_STUDY_MOCK_SPEED: '3'
  }
})
try {
  const page = await electronApp.firstWindow()
  // ビルドしたばかりのアプリは、最初の起動に時間がかかることがある
  page.setDefaultTimeout(60000)
  page.on('pageerror', (error) => check(false, `画面でエラー: ${error.message}`))
  const copy = page.frameLocator('#stage .cell:not(.off) iframe')
  const prompt = page.locator('#prompt')
  const visible = () => page.locator('#stage .cell:not(.off) .tag b').allTextContents()

  console.log('キーボードで指す')
  await copy.locator('body').waitFor()
  await page.locator('#stage .cell:not(.off) iframe').focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await prompt.filter({ hasText: 'どう感じましたか' }).waitFor()
  check(
    (await page.locator('#thread').innerText()).includes('指したところ'),
    '矢印キーと Enter で要素を指せる'
  )

  console.log('指す')
  await copy.locator('h1').click()
  await prompt.filter({ hasText: 'どう感じましたか' }).waitFor()
  check((await page.locator('#thread').innerText()).includes('太さ 700'), '指した要素の値が出る')

  console.log('幅を切り替える')
  await page.getByRole('button', { name: 'スマホ幅' }).click()
  await page.locator('#thread').getByText('スマホ幅 390px').waitFor()
  await page.getByRole('button', { name: 'PC 幅' }).click()
  await page.locator('#thread').getByText('PC幅 1280px').waitFor()
  check(true, '読み込み直さずに、その幅の値に取り直す')

  console.log('一言 → やめる → 送り直す')
  await page.locator('#input').fill('間延びして見える')
  await page.locator('#send').click()
  await prompt.filter({ hasText: '案を作っています' }).waitFor()
  check((await page.locator('.veil:not([hidden])').count()) === 4, '4 つの枠に覆いがかかる')
  await page.locator('#alt').click()
  await prompt.filter({ hasText: 'どう感じましたか' }).waitFor()
  check(
    (await page.locator('#input').inputValue()) === '間延びして見える',
    'やめると、一言が入力欄に戻る'
  )
  await page.locator('#send').click()
  await prompt.filter({ hasText: '案をクリックして' }).waitFor({ timeout: 30000 })
  check((await page.locator('.veil:not([hidden])').count()) === 0, '覆いが全部外れる')
  check((await visible()).sort().join('') === 'ABCD', '4 枚並ぶ')
  check(
    (await page.locator('#thread').innerText()).includes('4 枚そろいました'),
    '進み具合が「そろいました」になる'
  )
  await page.screenshot({ path: join(shots, '1-grid.png') })

  console.log('大きく見て、選ぶ')
  await page.keyboard.press('ArrowRight')
  check((await visible()).length === 1, '矢印キーで 1 枚を大きく見る')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Escape')
  check((await visible()).length === 4, 'Esc で並べた画面に戻る')
  // 字間を詰めた案（CSS が当たっている枠）を探して選ぶ
  let letter = null
  for (const l of 'ABCD') {
    await page.locator('#tools').getByRole('button', { name: l, exact: true }).click()
    const spacing = await copy
      .locator('[data-ds-target]')
      .evaluate((el) => getComputedStyle(el).letterSpacing)
    const size = await copy
      .locator('[data-ds-target]')
      .evaluate((el) => getComputedStyle(el).fontSize)
    if (spacing === '-2.72px' && size === '68px') letter = l
  }
  check(!!letter, '字間を詰めた案が、枠に当たっている')
  await page.locator('#tools').getByRole('button', { name: letter, exact: true }).click()
  await page.keyboard.press('Enter')
  await prompt.filter({ hasText: 'なぜそれを選んだか' }).waitFor()
  const thread = await page.locator('#thread').innerText()
  check(thread.includes('あなたが選んだ案は、理論帳と合っています'), '判定が出る')
  check(/字間\s*-1\.7px → -2\.72px/.test(thread), 'アプリが測った変化が出る')
  // 理由を書く欄に入っているので、元と案の切り替えはボタンで行う
  await page.locator('#tools').getByRole('button', { name: '元', exact: true }).click()
  check(
    (await copy
      .locator('[data-ds-target]')
      .evaluate((el) => getComputedStyle(el).letterSpacing)) === '-1.7px',
    '同じ枠に、元を出す'
  )
  await page
    .locator('#tools')
    .getByRole('button', { name: `案 ${letter}` })
    .click()
  check(
    (await copy
      .locator('[data-ds-target]')
      .evaluate((el) => getComputedStyle(el).letterSpacing)) === '-2.72px',
    '案に戻す'
  )
  await page.screenshot({ path: join(shots, '2-chosen.png') })

  console.log('残す')
  await page.locator('#input').fill('詰めたほうが締まって見える')
  await page.locator('#send').click()
  await prompt.filter({ hasText: '記録しました' }).waitFor()
  await page.locator('#thread').getByText('製品に渡す指示').waitFor()
  const records = existsSync(join(data, 'records')) ? readdirSync(join(data, 'records')) : []
  check(records.length === 1, '記録のフォルダができる')
  const record = records[0]
    ? JSON.parse(readFileSync(join(data, 'records', records[0], 'record.json'), 'utf8'))
    : {}
  check(
    record.picked === letter && record.note === '詰めたほうが締まって見える',
    '記録に、選んだ案と理由が残る'
  )
  check(
    existsSync(join(data, 'records', records[0] ?? '', 'record.md')),
    '人が読む記録（Markdown）ができる'
  )

  // 画像は裏で撮るので、少し待つ
  const dir = join(data, 'records', records[0] ?? '')
  for (let i = 0; i < 60 && readdirSync(dir).filter((f) => f.endsWith('.jpg')).length < 8; i++)
    await new Promise((done) => setTimeout(done, 500))
  check(
    readdirSync(dir).filter((f) => f.endsWith('.jpg')).length === 8,
    '元と各案の画像が、2 つの幅で 8 枚残る'
  )

  console.log('記録を見直す')
  await page.getByRole('link', { name: /記録（1）/ }).click()
  await page.getByRole('link', { name: '見直す' }).click()
  await page.locator('#records').getByText('一言を、こう読みました').waitFor()
  check(
    (await page.locator('#tools').innerText()).includes('✓'),
    '見直しでも、見方の切り替えが出る'
  )
  await page
    .waitForFunction(() => document.querySelector('#review img')?.naturalWidth > 0, null, {
      timeout: 10000
    })
    .then(
      () => check(true, '残した画像が出る'),
      () => check(false, '残した画像が出る')
    )
  await page.screenshot({ path: join(shots, '3-review.png') })
  await page.getByRole('link', { name: 'やりとり' }).click()
  await prompt.filter({ hasText: '記録しました' }).waitFor()
  check((await visible()).length === 1, 'やりとりに戻ると、写しがそのまま出る')

  console.log('別のところを指す')
  await page.locator('#send').click()
  await prompt.filter({ hasText: '気になるところを' }).waitFor()
  check((await copy.locator('#ds-patch').count()) === 0, '当てた案が外れている')

  console.log('画面を取り込む')
  await page.locator('#page').selectOption('+')
  await page.locator('#url').fill(siteUrl)
  await page.locator('#go').click()
  await copy.locator('h1', { hasText: '取り込んだ見出し' }).waitFor({ timeout: 30000 })
  const slug = readdirSync(join(data, 'copies')).find((name) => name !== 'techtalk-jp')
  const snapshot = readFileSync(join(data, 'copies', slug, 'snapshot.html'), 'utf8')
  check(
    snapshot.includes('rgb(10, 20, 30)') && !snapshot.includes('<script'),
    '写しに CSS が入り、スクリプトは外れている'
  )
  check(
    readdirSync(join(data, 'copies', slug, 'assets')).length === 1 &&
      snapshot.includes('src="assets/'),
    '画像を写しの中に持つ'
  )
  check(
    (await copy.locator('h1').evaluate((el) => getComputedStyle(el).fontSize)) === '40px',
    '取り込んだ写しが、同じ見た目で出る'
  )
  check(
    (await copy.locator('img').evaluate((el) => el.naturalWidth)) === 8,
    '写しの中の画像が読める'
  )
  await copy.locator('.lead').click()
  await prompt.filter({ hasText: 'どう感じましたか' }).waitFor()
  check(
    (await page.locator('#thread').innerText()).includes('本文です。'),
    '取り込んだ画面でも指せる'
  )

  console.log('設定')
  await page.getByRole('link', { name: /設定/ }).click()
  check((await page.locator('#records').innerText()).includes(data), '写しと記録の置き場所が出る')
  await page.screenshot({ path: join(shots, '4-settings.png') })
} finally {
  await electronApp.close()
  site.close()
  rmSync(data, { recursive: true, force: true })
}
console.log(process.exitCode ? '\n失敗があります' : '\nすべて通りました')
