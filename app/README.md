# Design Study（本番のアプリ）

Mac 用の Electron アプリ。いまは骨組みだけで、試作 2（`../prototypes/02-say-and-pick/`）の中身を順に移していく。

## 構成

- 土台: Electron + electron-vite。配布は electron-builder
- 画面: React + TypeScript。画面の行き来は React Router をライブラリとして使う（まだ入れていない）
- 左の画面（写しを測る、案を当てる）は、試作 2 の `app/stage.js` と `app/measure.js` を TypeScript にして持ってくる

```
src/main/       取り込み、AI、記録、写しの配信（Node の側）
src/preload/    画面から main を呼ぶための口（window.api）
src/renderer/   画面（React）
```

## 動かす

```sh
cd app
pnpm install
pnpm dev          # アプリの窓が開く
pnpm typecheck
```

入れるときの注意が 2 つある。

- pnpm 12 は、パッケージのビルドを既定で止める。`pnpm-workspace.yaml` の `allowBuilds` で、electron と esbuild だけ許可している
- Node 26 では、Electron 本体の展開が途中で止まることがある（`node_modules/electron/dist` にライセンスのファイルしか入らず、`pnpm dev` が「Electron uninstall」で止まる）。そのときは、取得済みの圧縮ファイルを手で展開する

```sh
Z=$(find ~/Library/Caches/electron -name "electron-v*-darwin-*.zip" | head -1)
rm -rf node_modules/electron/dist && mkdir -p node_modules/electron/dist
unzip -q "$Z" -d node_modules/electron/dist
printf 'Electron.app/Contents/MacOS/Electron' > node_modules/electron/path.txt
```

## 写しの渡し方

写しの HTML は、main から IPC で文字列として渡し、画面側で iframe の `srcdoc` に入れる。`srcdoc` の iframe は親と同じ出どころになるので、中の DOM を測ったり書き換えたりできる。写しの中の画像とフォントは、`copy://<写しの名前>/<ファイル>` という独自のプロトコルで配る（`src/main/copy.ts`）。

`srcdoc` の iframe は親の CSP を引き継ぐ。写しの画像、フォント、CSS を読めるよう、`src/renderer/index.html` の CSP で `copy:` と `https:` を許可している。

いまは、試作 2 が取り込んだ写し（`../prototypes/02-say-and-pick/copy/`）を借りている。取り込みを移したら、アプリの保存先に変える。
