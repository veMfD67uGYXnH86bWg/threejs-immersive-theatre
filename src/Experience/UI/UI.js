import Experience from '../Experience.js'
import LobbyUI from './LobbyUI.js'
import ChatUI from './ChatUI.js'
import EmoteBarUI from './EmoteBarUI.js'
import VotingUI from './VotingUI.js'
import YouTubePlayerUI from './YouTubePlayerUI.js'
import CameraViewUI from './CameraViewUI.js'
import songs from '../../../shared/songs.js'

export default class UI {
    constructor() {
        this.experience = new Experience()
        this.network = this.experience.network

        this.hudElement = document.getElementById('hud')
        this.roomInfoElement = document.getElementById('room-info')
        this.roomInviteButton = document.getElementById('room-invite')
        this.roomLeaveButton = document.getElementById('room-leave')
        this.nowPlayingElement = document.getElementById('now-playing')

        this.lobby = new LobbyUI()
        this.chat = new ChatUI()
        this.emoteBar = new EmoteBarUI()
        this.voting = new VotingUI()
        this.youtubePlayer = new YouTubePlayerUI()
        this.cameraView = new CameraViewUI()

        this.setNetworkEvents()
        this.setRoomActions()

        setInterval(() => {
            this.updateNowPlaying()
            this.updateTitle()
        }, 500)

        console.log('UI loaded')
    }

    setNetworkEvents() {
        this.network.on('roomJoined', () => {
            this.lobby.hide()
            this.hudElement.classList.remove('hidden')
            this.updateRoomInfo()
        })

        this.network.on('roomLeft', (reason) => {
            this.hudElement.classList.add('hidden')
            this.lobby.show(reason === 'disconnected' ? 'Connection lost — join again' : '')
        })

        this.network.on('playerJoined', () => this.updateRoomInfo())
        this.network.on('playerLeft', () => this.updateRoomInfo())
    }

    setRoomActions() {
        this.roomInviteButton.addEventListener('click', async () => {
            if (!this.network.room)
                return

            const inviteUrl =
                `${window.location.origin}${window.location.pathname}?room-code=${this.network.room.code}`

            try {
                await navigator.clipboard.writeText(inviteUrl)
                this.roomInviteButton.textContent = 'Link copied!'
                setTimeout(() => {
                    this.roomInviteButton.textContent = 'Invite friends'
                }, 1200)
            } catch {
                // Clipboard unavailable (permissions/insecure context) — ignore
            }
        })

        this.roomLeaveButton.addEventListener('click', () => {
            this.network.leaveRoom()
        })
    }

    updateRoomInfo() {
        const room = this.network.room

        if (!room)
            return

        this.roomInfoElement.textContent =
            `Room ${room.code} · ${this.network.players.size}/${room.maxPlayers}`
    }

    updateNowPlaying() {
        const dance = this.network.dance

        if (!dance) {
            this.nowPlayingElement.textContent = ''
            return
        }

        if (dance.phase === 'voting') {
            this.nowPlayingElement.textContent = '🗳 Vote for the next song!'
            return
        }

        const song = songs.find((candidate) => candidate.id === dance.songId)
        const songLabel = song ? `${song.name} — ${song.artist}` : dance.songId

        if (dance.phase === 'preparing') {
            const secondsLeft = Math.max(0, Math.ceil((dance.endsAt - this.network.serverClock.now()) / 1000))
            this.nowPlayingElement.textContent = `🎤 Up next: ${songLabel} · ${secondsLeft}s`
            return
        }

        const position = Math.max(0, this.network.serverClock.now() - dance.startedAt)

        this.nowPlayingElement.textContent =
            `♪ ${song?.name ?? dance.songId} · ${this.formatTime(position)} / ${this.formatTime(dance.duration)}`
    }

    updateTitle() {
        const dance = this.network.dance
        const song = dance?.phase === 'playing'
            ? songs.find((candidate) => candidate.id === dance.songId)
            : null

        const title = song
            ? `${song.name} by ${song.artist} - Immersive Theatre`
            : 'Immersive Theatre'

        if (document.title !== title)
            document.title = title
    }

    formatTime(milliseconds) {
        const totalSeconds = Math.floor(milliseconds / 1000)
        const minutes = Math.floor(totalSeconds / 60)
        const seconds = `${totalSeconds % 60}`.padStart(2, '0')

        return `${minutes}:${seconds}`
    }
}
