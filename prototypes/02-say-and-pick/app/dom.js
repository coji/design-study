// 画面の部品を作るための小さな道具

export const $ = (selector) => document.querySelector(selector)

// h('div', { class: 'card', onclick: fn }, 子…) で要素を作る。null の子は飛ばす
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') el.className = value
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value)
    else el.setAttribute(key, value)
  }
  el.append(...kids.filter(kid => kid != null))
  return el
}

export const wait = (ms) => new Promise(done => setTimeout(done, ms))
