import { useEffect, useState } from 'react'
import type { Settings } from '@shared/schema'
import { practice } from '../practice/controller'
import { usePractice } from '../practice/usePractice'

/** 設定。ChatGPT とのつながりと、写しと記録の置き場所 */
export function SettingsPage(): React.JSX.Element {
  const { session } = usePractice()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.api.settings.get().then(setSettings)
  }, [])

  async function sign(action: () => Promise<void>): Promise<void> {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }
  async function moved(next: Settings): Promise<void> {
    setSettings(next)
    // 置き場所が変わったので、画面と記録を読み直す
    await practice.init()
  }

  return (
    <div id="records">
      <section>
        <h2>ChatGPT</h2>
        <p className="muted">
          案を作るのに、自分の ChatGPT のプラン（Plus か Pro）の枠を使います。API キーは要りません。
        </p>
        {session?.connected ? (
          <>
            <p>
              つながっています（{session.name ?? '名前なし'}
              {session.model ? `、${session.model}` : ''}）
            </p>
            <div>
              <button className="plain" disabled={busy} onClick={() => void sign(practice.signOut)}>
                サインアウトする
              </button>
            </div>
          </>
        ) : (
          <>
            <p>つながっていません。{session?.error}</p>
            <div>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void sign(practice.signIn)}
              >
                {busy ? 'ブラウザで続けてください' : 'ChatGPT でサインインする'}
              </button>
            </div>
          </>
        )}
      </section>
      <section>
        <h2>写しと記録の置き場所</h2>
        <p className="muted">
          取り込んだ写し、記録（画像と
          Markdown）、理論帳（theory.md）を、ここに置きます。ただのファイルなので、そのまま読んだり、ほかの道具に渡したりできます。
        </p>
        <p className="instruction">{settings?.dataDir}</p>
        <div className="group">
          <button className="plain" onClick={() => void window.api.settings.openDataDir()}>
            フォルダを開く
          </button>
          <button
            className="plain"
            onClick={() => void window.api.settings.chooseDataDir().then(moved)}
          >
            別のフォルダにする
          </button>
          {settings && !settings.isDefault && (
            <button
              className="text"
              onClick={() => void window.api.settings.resetDataDir().then(moved)}
            >
              既定の場所に戻す
            </button>
          )}
        </div>
      </section>
      <section>
        <h2>取り込み用のブラウザ</h2>
        <p className="muted">
          ログインが要る画面を取り込むときのログインの状態は、アプリの中に残ります。
        </p>
        <div>
          <button className="plain" onClick={() => void window.api.pages.clearLogins()}>
            ログインの状態を消す
          </button>
        </div>
      </section>
    </div>
  )
}
