# 下調べの道具

設計の前提を確かめるために書いた、使い捨てに近いスクリプト。出力は `lab/out/` に置く（リポジトリには入れない）。

## 準備

```sh
cd lab
npm install
```

Chrome が入っていること（Playwright が手元の Chrome を使う）。

## 写しを取り込んで、元と比べる

```sh
mkdir -p out/ref out/copy
node capture.mjs https://www.techtalk.jp/ out/ref      # 画像 2 枚、写し、要素の値
cp -r out/ref/snapshot.html out/ref/assets out/copy/
node shot.mjs "$PWD/out/copy/snapshot.html" "$PWD/out/copy"   # 写しを 2 つの幅で撮る
python3 diff.py out/ref/pc.png out/copy/pc.png out/copy/diff-pc.png
python3 diff.py out/ref/sp.png out/copy/sp.png out/copy/diff-sp.png
```

- `capture.mjs`: PC 幅（1280px）とスマホ幅（390px）の画像、表示された HTML と効いている CSS をまとめた写し（`snapshot.html` と `assets/`）、主な要素の実際の値（`values.json`）を採る
- `shot.mjs`: 写しを手元の HTTP サーバーから配って、2 つの幅で撮る
- `diff.py`: 2 枚の画像を比べ、違う画素の割合と差分の画像を出す（Pillow が要る）

写しを作るときの勘所は 3 つある。`<html>` の属性を残すこと（テーマの指定が入っている）、CSS の中の相対 URL を絶対にすること、フォントと画像を写しの中に持つこと（別の場所から開くと、フォントが読めなくなる）。

## 写しを、指示で直させる

写しのあるフォルダで Codex を呼ぶ。標準入力を閉じないと、入力待ちで止まる。

```sh
cd out/copy
codex exec --skip-git-repo-check -s workspace-write --json "（指示）" < /dev/null
```

下調べでは、3 か所の値を変える指示が 35 秒で反映された。

## Sign in with ChatGPT で、画像つきの診断を通す

DevKit を `vendor/` に置いて、手元でビルドする。

```sh
git clone https://github.com/openai/sign-in-with-chatgpt-devkit.git ../vendor/sign-in-with-chatgpt-devkit
cd ../vendor/sign-in-with-chatgpt-devkit
npm install --workspace packages/local --include-workspace-root=false --ignore-scripts
(cd packages/local && npx -p typescript@5 tsc -p tsconfig.json)
```

DevKit の `streamResponse` は文字だけに対応している。画像を通すために、`packages/local/dist/responses.js` の入力の検査を 1 か所変える。

```
typeof message.content !== "string"
→ (typeof message.content !== "string" && !Array.isArray(message.content))
```

そのうえで実行する。初回はブラウザが開き、ChatGPT でのサインインと許可を求められる。

```sh
cd ../../lab
node siwc-test.mjs out/ref/pc.png out/ref/sp.png
```

トークンは `~/.config/design-practice-lab/` に、AES-256-GCM で暗号化して保存する。鍵は macOS のキーチェーンに置く。
