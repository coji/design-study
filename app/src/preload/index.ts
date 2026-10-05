import { contextBridge, ipcRenderer } from 'electron'
import type {
  Page,
  PracticeRecord,
  RecordInput,
  RoundEvent,
  RoundRequest,
  Session,
  Settings
} from '@shared/schema'

// 画面（renderer）から main を呼ぶための口。ここに並べたものだけが、画面から使える
const api = {
  pages: {
    list: (): Promise<Page[]> => ipcRenderer.invoke('pages:list'),
    /** 写しの HTML。iframe の srcdoc に入れる */
    html: (slug: string): Promise<string> => ipcRenderer.invoke('pages:html', slug),
    /** URL を開いて取り込む */
    capture: (url: string): Promise<Page> => ipcRenderer.invoke('pages:capture', url),
    remove: (slug: string): Promise<void> => ipcRenderer.invoke('pages:remove', slug),
    /** ログインが要る画面のために、窓を開く */
    openBrowser: (url: string): Promise<void> => ipcRenderer.invoke('pages:openBrowser', url),
    /** 開いた窓の、いまの画面を取り込む */
    captureBrowser: (): Promise<Page> => ipcRenderer.invoke('pages:captureBrowser'),
    clearLogins: (): Promise<void> => ipcRenderer.invoke('pages:clearLogins')
  },
  round: {
    /** 案を作ってもらう。できたものから onEvent に届く。終わると返る */
    async start(request: RoundRequest, onEvent: (event: RoundEvent) => void): Promise<void> {
      const id = crypto.randomUUID()
      api.round.current = id
      const listener = (_e: unknown, target: string, event: RoundEvent): void => {
        if (target === id) onEvent(event)
      }
      ipcRenderer.on('round:event', listener)
      try {
        await ipcRenderer.invoke('round:start', id, request)
      } finally {
        ipcRenderer.removeListener('round:event', listener)
      }
    },
    current: null as string | null,
    cancel: (): Promise<void> => ipcRenderer.invoke('round:cancel', api.round.current)
  },
  records: {
    list: (): Promise<PracticeRecord[]> => ipcRenderer.invoke('records:list'),
    save: (record: RecordInput): Promise<{ id: string; dir: string; instruction: string }> =>
      ipcRenderer.invoke('records:save', record),
    /** 記録の画像が撮り終わったときに呼ばれる。返す関数を呼ぶと、聞くのをやめる */
    onImages(listener: (id: string) => void): () => void {
      const wrapped = (_e: unknown, id: string): void => listener(id)
      ipcRenderer.on('records:images', wrapped)
      return () => ipcRenderer.removeListener('records:images', wrapped)
    }
  },
  session: {
    get: (): Promise<Session> => ipcRenderer.invoke('session:get'),
    signIn: (): Promise<Session> => ipcRenderer.invoke('session:signIn'),
    signOut: (): Promise<Session> => ipcRenderer.invoke('session:signOut')
  },
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    chooseDataDir: (): Promise<Settings> => ipcRenderer.invoke('settings:chooseDataDir'),
    resetDataDir: (): Promise<Settings> => ipcRenderer.invoke('settings:resetDataDir'),
    openDataDir: (): Promise<void> => ipcRenderer.invoke('settings:openDataDir')
  }
}
export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
