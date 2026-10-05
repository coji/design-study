import { useEffect } from 'react'
import { createHashRouter, NavLink, Outlet, RouterProvider } from 'react-router'
import { Composer } from './components/Composer'
import { LeftBar } from './components/LeftBar'
import { RecordDetail, RecordList } from './components/Records'
import { ReviewImages } from './components/ReviewImages'
import { SettingsPage } from './components/SettingsPage'
import { Thread } from './components/Thread'
import { practice } from './practice/controller'
import { usePractice } from './practice/usePractice'
import { StageView } from './stage/StageView'

/** 画面の枠組み。左が画面、右が言葉。左の画面は、右の列で何を見ていても開いたままにする */
function Layout(): React.JSX.Element {
  const { html, review, records, session, pages } = usePractice()

  useEffect(() => {
    void practice.init()
    document.addEventListener('keydown', practice.onKey)
    return () => document.removeEventListener('keydown', practice.onKey)
  }, [])

  const tab = ({ isActive }: { isActive: boolean }): string => (isActive ? 'tab current' : 'tab')
  return (
    <div className="app">
      <main className="left" aria-label="画面">
        <LeftBar />
        <div className="stagewrap">
          {/* 記録を見直すあいだ、写しの枠は消さずに隠す（開いたままにして、戻ったときに読み込み直さない） */}
          <div className={review ? 'away' : undefined} style={{ position: 'absolute', inset: 0 }}>
            <StageView
              html={html}
              events={{ point: practice.pointed, cell: practice.look, key: practice.onKey }}
              onReady={(stage) => practice.attach(stage)}
            />
          </div>
          <ReviewImages />
          {!html && pages.length === 0 && (
            <p className="muted empty">左上に URL を入れて、練習に使う画面を取り込んでください。</p>
          )}
        </div>
      </main>
      <aside className="right" aria-label="言葉のやりとりと記録">
        <nav className="bar">
          <span className="tabs" id="tabs">
            <NavLink to="/" end className={tab}>
              やりとり
            </NavLink>
            <NavLink to="/records" className={tab}>
              記録（{records.length}）
            </NavLink>
            <NavLink to="/settings" className={tab}>
              設定{session && !session.connected ? '（未接続）' : ''}
            </NavLink>
          </span>
        </nav>
        <Outlet />
        <p className="sr" role="status" id="status" />
      </aside>
    </div>
  )
}

function Practice(): React.JSX.Element {
  const { session } = usePractice()
  return (
    <>
      {session && !session.connected && (
        <div className="notice">
          <div className="alert" role="alert">
            ChatGPT につながっていません。案を作るには、「設定」でサインインしてください。
          </div>
        </div>
      )}
      <Thread />
      <Composer />
    </>
  )
}

// サーバーがないので、アドレスの # から先で画面を切り替える
const router = createHashRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Practice /> },
      { path: 'records', element: <RecordList /> },
      { path: 'records/:id', element: <RecordDetail /> },
      { path: 'settings', element: <SettingsPage /> }
    ]
  }
])

export default function App(): React.JSX.Element {
  return <RouterProvider router={router} />
}
