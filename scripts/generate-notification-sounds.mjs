import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'android', 'app', 'src', 'main', 'res', 'raw')
mkdirSync(out, { recursive: true })
const rate = 22050

function make(name, duration, notes, wave = 'sine') {
  const samples = Math.ceil(duration * rate)
  const pcm = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i++) {
    const t = i / rate
    let value = 0
    for (const note of notes) {
      if (t < note.start || t > note.start + note.duration) continue
      const local = (t - note.start) / note.duration
      const envelope = Math.sin(Math.PI * local) ** 1.4
      const phase = 2 * Math.PI * note.frequency * (t - note.start)
      const raw = wave === 'square' ? (Math.sin(phase) >= 0 ? 1 : -1) : Math.sin(phase)
      value += raw * envelope * note.gain
    }
    const sample = Math.max(-1, Math.min(1, value))
    pcm.writeInt16LE(Math.round(sample * 32767), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8)
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40)
  writeFileSync(path.join(out, name), Buffer.concat([header, pcm]))
}

make('dsh_soft.wav', 0.42, [
  { start: 0, duration: 0.22, frequency: 520, gain: 0.18 },
  { start: 0.12, duration: 0.28, frequency: 660, gain: 0.16 }
])
make('dsh_chime.wav', 0.62, [
  { start: 0, duration: 0.24, frequency: 660, gain: 0.2 },
  { start: 0.12, duration: 0.3, frequency: 880, gain: 0.18 },
  { start: 0.27, duration: 0.32, frequency: 1100, gain: 0.15 }
])
make('dsh_digital.wav', 0.42, [
  { start: 0, duration: 0.09, frequency: 740, gain: 0.12 },
  { start: 0.11, duration: 0.09, frequency: 980, gain: 0.11 },
  { start: 0.23, duration: 0.14, frequency: 780, gain: 0.1 }
], 'square')
console.log(out)
