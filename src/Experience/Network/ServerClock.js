const SAMPLE_COUNT = 5

/**
 * Estimates the server's clock (NTP-style) so every client can compute the
 * same dance playback position: it pings the server a few times, assumes the
 * server timestamp was taken halfway through the round trip, and keeps the
 * lowest-latency sample (least skewed by network jitter).
 */
export default class ServerClock {
    constructor(socket) {
        this.socket = socket
        this.offset = 0

        this.socket.on('connect', () => this.sync())

        if (this.socket.connected)
            this.sync()
    }

    async sync() {
        const samples = []

        for (let i = 0; i < SAMPLE_COUNT; i++)
            samples.push(await this.sample())

        samples.sort((a, b) => a.rtt - b.rtt)
        this.offset = samples[0].offset

        console.log(`ServerClock synced (offset ${this.offset.toFixed(1)}ms, rtt ${samples[0].rtt}ms)`)
    }

    sample() {
        return new Promise((resolve) => {
            const sentAt = Date.now()

            this.socket.emit('time:sync', sentAt, ({serverTime}) => {
                const receivedAt = Date.now()
                const rtt = receivedAt - sentAt

                resolve({rtt, offset: serverTime + rtt / 2 - receivedAt})
            })
        })
    }

    now() {
        return Date.now() + this.offset
    }
}
