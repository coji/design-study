# このリポジトリに含まれるもの、アプリに同梱されるものの扱い

このリポジトリで溝口が書いたコードと文書は、MIT ライセンス（`LICENSE`）で公開している。それ以外のものは、次のとおり。

## OpenAI の Sign in with ChatGPT DevKit

アプリは、ChatGPT でのサインインと AI の呼び出しに、OpenAI の DevKit（`@siwc/local`）を使っている。

- **ライセンス:** Sign-In with ChatGPT DevKit Noncommercial License 1.0（非商用）。個人の学習、実験、開発のための利用に限られ、事業のための製品やサービスの開発、配布、運用には使えない
- **このリポジトリには入っていない:** `app/scripts/setup-devkit.mjs` が、決めた版を GitHub から取得して、使う人の手元でビルドする。取得先の `app/vendor/` は、リポジトリに入れていない
- **手を入れている箇所:** 取得したあと、`packages/local/src/responses.ts` と `types.ts` の 2 か所を書き換える（画像つきの入力を通す、送る本文に追加の項目を足せるようにする）。書き換えたファイルの先頭に、その旨を書き足している
- **ビルドしたアプリには入る:** `pnpm build:mac` で作ったアプリには DevKit のコードが含まれ、ライセンスの写しを `Contents/Resources/licenses/` に添えている

このため、**ビルドしたアプリは、非商用の目的でしか使えず、配れない**。MIT ライセンスが及ぶのは、このリポジトリのコードだけである。

取得元: https://github.com/openai/sign-in-with-chatgpt-devkit

## techtalk.jp の写し

`prototypes/01-pick-and-reveal/copy/` と `prototypes/02-say-and-pick/copy/techtalk-jp/` には、溝口の会社のサイト（https://www.techtalk.jp/）の写しが入っている。試作と試験の教材として置いたもので、文章と画像の権利は株式会社 TechTalk にある。MIT ライセンスの対象ではない。

写しに含まれるフォント（LINE Seed JP）は、SIL Open Font License 1.1 で配られているものである。

## そのほかの依存

npm のパッケージ（Electron、React、React Router、Zod など）は、それぞれのライセンスに従う。一覧は `app/package.json` にある。
