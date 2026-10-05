import { useSyncExternalStore } from 'react'
import { practice } from './controller'
import type { PracticeState } from './types'

/** 練習の状態を読む。状態が差し替わると、描き直される */
export function usePractice(): PracticeState {
  return useSyncExternalStore(practice.subscribe, practice.snapshot)
}
