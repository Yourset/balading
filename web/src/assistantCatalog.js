import { DSH_WORKSPACE, DSH_PROJECT_DIR } from './workspaceConfig.js'

export const ASSISTANTS = [
  {
    id: 'personal',
    title: '私人助手',
    icon: '👻',
    description: '日常交流、个人记忆与长期陪伴',
    preset: 'mobile',
    cwd: DSH_WORKSPACE,
    legacyStorageKey: 'dsh-assistant-sid'
  },
  {
    id: 'fitness',
    title: '健身助手',
    icon: '💪',
    description: '训练、饮食、体重与减脂计划',
    preset: 'mobile',
    cwd: DSH_WORKSPACE
  },
  {
    id: 'mobile-optimizer',
    title: '优化总管',
    legacyTitles: ['手机端优化助手'],
    icon: '🧞',
    description: '聊需求、看进度，每件事都有结果',
    taskCategory: '手机优化',
    preset: 'mobile',
    cwd: DSH_PROJECT_DIR
  },
  {
    id: 'capsule-organizer',
    title: '闪念胶囊整理助手',
    icon: '💊',
    description: '后台整理语音闪念，不在助手宫格中显示',
    preset: 'mobile',
    cwd: DSH_WORKSPACE,
    hidden: true
  }
]

export function assistantStorageKey(id) {
  return 'dsh-assistant-sid-' + id
}

export function readAssistantSessionIds() {
  const ids = new Set()
  for (const assistant of ASSISTANTS) {
    try {
      const id = localStorage.getItem(assistantStorageKey(assistant.id)) || (assistant.legacyStorageKey ? localStorage.getItem(assistant.legacyStorageKey) : '')
      if (id) ids.add(id)
    } catch (e) {}
  }
  return ids
}

export function isAutomatedTaskSession(session) {
  return session?.origin === 'subagent'
}
