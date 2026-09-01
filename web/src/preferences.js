const KEYS = {
  voiceSendMode: 'dsh-voice-send-mode',
  inputMode: 'dsh-composer-input-mode',
  taskSound: 'dsh-sound-task-complete',
  voiceSound: 'dsh-sound-voice-send'
}

const SOUND_TYPES = ['off', 'soft', 'chime', 'digital']

function read(key, fallback) {
  try { return localStorage.getItem(key) || fallback } catch (e) { return fallback }
}

function write(key, value) {
  try { localStorage.setItem(key, value) } catch (e) {}
  try { window.dispatchEvent(new CustomEvent('dsh-preference-change', { detail: { key, value } })) } catch (e) {}
}

export function getVoiceSendMode() {
  return read(KEYS.voiceSendMode, 'edit') === 'auto' ? 'auto' : 'edit'
}
export function setVoiceSendMode(value) { write(KEYS.voiceSendMode, value === 'auto' ? 'auto' : 'edit') }

export function getComposerInputMode() {
  return read(KEYS.inputMode, 'text') === 'voice' ? 'voice' : 'text'
}
export function setComposerInputMode(value) { write(KEYS.inputMode, value === 'voice' ? 'voice' : 'text') }

export function getSoundPreference(kind) {
  const key = kind === 'voice' ? KEYS.voiceSound : KEYS.taskSound
  const value = read(key, kind === 'voice' ? 'soft' : 'chime')
  return SOUND_TYPES.includes(value) ? value : 'off'
}
export function setSoundPreference(kind, value) {
  const key = kind === 'voice' ? KEYS.voiceSound : KEYS.taskSound
  write(key, SOUND_TYPES.includes(value) ? value : 'off')
}

export const soundOptions = [
  { value: 'off', label: '关闭' },
  { value: 'soft', label: '轻柔' },
  { value: 'chime', label: '清脆' },
  { value: 'digital', label: '数字提示' }
]
