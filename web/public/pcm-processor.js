class DshPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.targetRate = 16000
    this.sourceRate = sampleRate
    this.ratio = this.sourceRate / this.targetRate
    this.position = 0
    this.pending = []
    this.packetSamples = 1600 // 100 ms @ 16 kHz
    this.port.onmessage = ({ data }) => {
      if (!data || data.type !== 'flush') return
      if (this.pending.length) {
        const packet = new Int16Array(this.pending.length)
        for (let i = 0; i < this.pending.length; i++) packet[i] = this.pending[i]
        this.pending.length = 0
        this.port.postMessage(packet.buffer, [packet.buffer])
      }
      this.port.postMessage({ type: 'flushed' })
    }
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0]
    if (!input || !input.length) return true
    while (this.position < input.length) {
      const idx = Math.min(input.length - 1, Math.floor(this.position))
      const sample = Math.max(-1, Math.min(1, input[idx]))
      this.pending.push(sample < 0 ? sample * 32768 : sample * 32767)
      this.position += this.ratio
    }
    this.position -= input.length
    while (this.pending.length >= this.packetSamples) {
      const packet = new Int16Array(this.packetSamples)
      for (let i = 0; i < this.packetSamples; i++) packet[i] = this.pending[i]
      this.pending.splice(0, this.packetSamples)
      this.port.postMessage(packet.buffer, [packet.buffer])
    }
    return true
  }
}
registerProcessor('dsh-pcm-processor', DshPcmProcessor)
