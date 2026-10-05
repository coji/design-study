import { contextBridge, ipcRenderer } from 'electron'

// 画面（renderer）から main を呼ぶための口。ここに並べたものだけが、画面から使える
const api = {
  /** 取り込んだ写しの HTML */
  copyHtml: (slug: string): Promise<string> => ipcRenderer.invoke('copy:html', slug)
}
export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
