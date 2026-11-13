import { useState } from 'react'

// The Game panel opens per chat: each chat may be working on a different game.
const key = 'mrmak.gamePanel.chats'
const read = (): string[] => {
  try { const value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [] } catch { return [] }
}

export function useGamePanel(id: string | undefined): [boolean, () => void] {
  const [chats, setChats] = useState(read)
  const open = !!id && chats.includes(id)
  const toggle = () => {
    if (!id) return
    const next = open ? chats.filter(item => item !== id) : [...chats, id].slice(-100)
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* The panel still toggles for this window. */ }
    setChats(next)
  }
  return [open, toggle]
}

export const folderName = (value: string) => value.split(/[\\/]/).filter(Boolean).slice(-1)[0] || value

export const sameFolder = (left: string, right: string) => {
  const folder = (value: string) => value.replace(/[\\/]+$/, '').toLowerCase()
  return folder(left) === folder(right)
}
