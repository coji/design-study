# Design Study（アプリ本体）

Mac 用の Electron アプリ。何をするアプリかは、リポジトリの `README.md` にある。ここには、作りと動かし方を書く。

## 動かす

```sh
pnpm install     # 依存を入れ、Electron と OpenAI の DevKit を用意する
pnpm dev         # 開発用に起動する。コードを直すと、すぐ反映される
pnpm typecheck   # 型の検査
pnpm lint        # 書き方の検査
pnpm test        # 単体の試験（測定、形の検証）
pnpm smoke       # アプリを起動して、1 回の流れを最後まで通す試験（AI は呼ばない）
pnpm build:mac   # 配るためのアプリ（dist/ に dmg ができる。署名と公証はしない）
```

`pnpm install` のあとに、2 つの準備が自動で走る。

- **Electron 本体の確認（`scripts/ensure-electron.mjs`）:** Node の版によっては、Electron 本体の展開が途中で止まる（`pnpm dev` が「Electron uninstall」で止まる）。そのときは、取得済みの圧縮ファイルを展開し直す
- **DevKit の取得とビルド（`scripts/setup-devkit.mjs`）:** OpenAI の Sign in with ChatGPT DevKit は npm になく、非商用ライセンスなので、リポジトリに入れていない。決めた版を GitHub から `vendor/` に取得し、2 か所に手を入れてビルドする。くわしくはリポジトリの `THIRD_PARTY.md`

pnpm 12 は、パッケージのビルドを既定で止める。`pnpm-workspace.yaml` の `allowBuilds` で、electron と esbuild だけ許可している。

## 構成

```
src/shared/     main と画面で共有する形（Zod）。AI の返事と記録のファイルも、この形で検証する
src/main/       Node の側
  index.ts        窓を作る
  ipc.ts          画面からの呼び出しを受ける。main のできることの全部が、ここに並ぶ
  ai.ts           案を AI に作らせる
  prompts.ts      AI への指示文
  auth.ts         Sign in with ChatGPT
  pages.ts        画面を、写しとして取り込む
  shots.ts        写しを撮る（AI に見せる画像、記録に残す画像）
  records.ts      記録を保存する、読む
  store.ts        写しと記録の置き場所
src/preload/    画面から main を呼ぶための口（window.api）
src/renderer/   画面（React）
  stage/          左の画面。写しを測る、案を当てる、並べる
  practice/       練習の流れ（状態と、順番のある仕事）
  components/     右の列と帯の部品
test/           アプリを起動して通す試験
```

## 作りの要点

**左の画面は、React を通さない。** 写しを入れた iframe を 4 つ開いたままにして、並べる、大きく見る、元と案を切り替える、幅を変える、のどれでも読み込み直さない（`stage/stage.ts`）。iframe の中の DOM を測って書き換える処理が中心なので、素の TypeScript で書き、React からは 1 つの部品（`StageView`）として包んでいる。

**練習の流れは、1 か所で持つ。** 指す → 一言 → 案を待つ → 選ぶ → 理由を残す → 記録した、の段階と、順に届く案や時計のような順番のある仕事を、`practice/controller.ts` に集めている。状態は書き換えずに差し替え、React の部品はそれを映すだけにする。段階ごとの入力欄とボタンは、`components/Composer.tsx` の 1 か所で決める。

**写しは `srcdoc` の iframe に入れる。** main から HTML を文字列で渡し、iframe の `srcdoc` に入れる。`srcdoc` の iframe は親と同じ出どころになるので、中の DOM に触れる。写しの中の画像とフォントは、`copy://<写しの名前>/<ファイル>` という独自のプロトコルで配る。記録の画像は `record://<記録の id>/<ファイル>`。`srcdoc` の iframe は親の CSP を引き継ぐので、`src/renderer/index.html` の CSP で `copy:`、`record:`、`https:` を許可している。

**取り込みと撮影は、アプリの中のブラウザで行う。** 取り込みは、窓を出さずに URL を開き、表示された DOM と効いている CSS を集め、フォントと画像を写しの中に持つ（`pages.ts`）。ログインが要る画面は、窓を開いてログインしてもらってから取り込む。ログインの状態は、取り込み用の入れ物（`persist:capture`）に残る。

**案は、5 つの呼び出しで同時に作る。** まず短い呼び出しで、読みと 3 つの方向（名前だけ）を決める。方向が 1 つ決まるたびに、その案を作る呼び出しを始める。元の画面の判定も、別の呼び出しで作る（`ai.ts`）。方向の名前は、選ぶ前には画面に出さない。目で選んでから言葉を知る、という順を守るためである。

**AI の説明と、実際の画面を分ける。** 案を当てたあとの値をアプリが測り、元との違いを「アプリが画面から測った変化」として出す。AI の説明と食い違うこと（指定した太さがフォントにない、書いた CSS が効いていない）があるためである。

## 置き場所

使う人が作るものは、リポジトリの中には置かない。既定は、アプリの保存先（`~/Library/Application Support/design-study/`）の中である。「設定」で、別のフォルダに変えられる。

```
data/
  copies/<写しの名前>/    snapshot.html、assets/、meta.json
  records/<日時>/        record.md、record.json、pc-A.jpg … sp-D.jpg
  theory.md             理論帳。初めて使うときに docs/theory-v0.md が写される。自分で書き足していける
  last-round.json       直前の 1 回分の、届いた順と間合い
auth/                   ChatGPT のサインインの情報（OS の仕組みで暗号化している）
settings.json
```

## 環境変数（開発と試験のためのもの）

- `DESIGN_STUDY_DATA_DIR`: 写しと記録の置き場所
- `DESIGN_STUDY_MOCK`: 1 回分の記録（`last-round.json` の形）のパス。AI を呼ばずに、その 1 回分を、届いた間合いのまま再生する。待っている間の見え方を、ChatGPT の枠を使わずに確かめるためのもの
- `DESIGN_STUDY_MOCK_SPEED`: 再生の速さ（6 なら 6 倍速）
- `DESIGN_STUDY_MODEL`: 使うモデル。既定は、一覧の先頭
- `DESIGN_STUDY_EFFORT`: 考える深さ。既定は low（既定のままだと、最初の文字が出るまでが遅い）

## まだできていないこと

- **署名と公証:** Apple の開発者登録がないので、していない。開くときに警告が出る
- **記録の履歴の管理:** 設計メモでは jj を使うと決めているが、入れていない
- **写しの修正を Codex に任せること:** 入れていない。案は、AI が返した CSS と文章を、アプリが写しに当てている
- **選んだ案を写しに書き戻すこと:** 次の回も、取り込んだときの画面から始まる
- **写しが元と一致するかの確認:** 取り込んだ写しと元の画面を画像で比べる工程は、入れていない
- **アイコン:** 雛形のものを仮に使っている
