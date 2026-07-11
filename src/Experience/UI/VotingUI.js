import Experience from '../Experience.js'
import songs from '../../../shared/songs.js'

export default class VotingUI {
    constructor() {
        this.experience = new Experience()
        this.network = this.experience.network

        this.element = document.getElementById('voting')
        this.timerElement = document.getElementById('voting-timer')
        this.songsList = document.getElementById('voting-songs')

        this.songItems = new Map()
        this.myVote = null

        this.setSongs()
        this.setNetworkEvents()

        setInterval(() => this.updateTimer(), 250)

        console.log('VotingUI loaded')
    }

    setSongs() {
        for (const song of songs) {
            const item = document.createElement('li')
            item.innerHTML =
                `<span class="voting-song-name">${song.name} <small>${song.artist}</small></span>` +
                `<span class="voting-count">0</span>`
            item.addEventListener('click', () => this.vote(song.id))

            this.songsList.appendChild(item)
            this.songItems.set(song.id, item)
        }
    }

    setNetworkEvents() {
        this.network.on('roomJoined', () => this.syncFromState())
        this.network.on('danceStateChanged', () => this.syncFromState())
        this.network.on('danceVotesChanged', (votes) => this.updateCounts(votes))
        this.network.on('roomLeft', () => this.element.classList.add('hidden'))
    }

    syncFromState() {
        const dance = this.network.dance

        if (dance?.phase === 'voting') {
            this.myVote = null
            this.updateCounts(dance.votes ?? {})
            this.updateTimer()
            this.element.classList.remove('hidden')
        } else {
            this.element.classList.add('hidden')
        }
    }

    vote(songId) {
        this.myVote = songId
        this.network.castVote(songId)

        for (const [id, item] of this.songItems)
            item.classList.toggle('selected', id === songId)
    }

    updateCounts(votes) {
        for (const [id, item] of this.songItems) {
            item.querySelector('.voting-count').textContent = votes[id] ?? 0
            item.classList.toggle('selected', id === this.myVote)
        }
    }

    updateTimer() {
        const dance = this.network.dance

        if (dance?.phase !== 'voting')
            return

        const secondsLeft = Math.max(0, Math.ceil((dance.endsAt - this.network.serverClock.now()) / 1000))
        this.timerElement.textContent = `${secondsLeft}s`
    }
}
