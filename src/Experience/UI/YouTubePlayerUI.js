import Experience from '../Experience.js'
import songs from '../../../shared/songs.js'

const DRIFT_TOLERANCE = 0.2 // seconds off the room clock before reseeking
const DRIFT_CHECK_INTERVAL = 2000
const SEEK_SETTLE_DELAY = 800 // how long after a seek before measuring the result
const MAX_SETTLE_ATTEMPTS = 5
const VOLUME_STORAGE_KEY = 'immersive-theatre-volume'
const DEFAULT_VOLUME = 50

/**
 * Embeds the current song's official YouTube video (IFrame Player API) and
 * keeps it on the room's clock: every couple of seconds the player position
 * is compared against the synced trackTime and reseeked when it drifts — a
 * viewer who buffers falls behind, then snaps back.
 *
 * Seeks aren't instant (the video resumes a few hundred ms after seekTo),
 * so every seek aims ahead of the clock by an adaptive `seekLead`; after
 * each seek the landing error is measured and the lead corrected, so
 * clients converge to within ~DRIFT_TOLERANCE of each other instead of
 * chronically lagging by their seek latency.
 *
 * The player starts un-muted at the saved volume: joining a room requires a
 * click, which counts as the page interaction browsers want before allowing
 * audible autoplay. Some browsers (notably Safari) may still refuse — if the
 * video isn't playing shortly after load, we fall back to muted playback and
 * the 🔇 button shows, one click away from sound.
 */
export default class YouTubePlayerUI {
    constructor() {
        this.experience = new Experience()
        this.network = this.experience.network

        this.element = document.getElementById('video-panel')
        this.muteButton = document.getElementById('video-mute')
        this.volumeSlider = document.getElementById('video-volume')

        this.player = null
        this.playerReady = false
        this.currentVideoId = null
        this.seekLead = 0.25 // learned estimate of seek latency, in seconds
        this.settleTimer = null
        this.settleAttempts = 0

        this.muted = false
        this.volume = this.loadVolume()
        this.volumeSlider.value = this.volume

        this.setEvents()
        this.setNetworkEvents()
        this.updateMuteButton()

        setInterval(() => this.correctDrift(), DRIFT_CHECK_INTERVAL)

        console.log('YouTubePlayerUI loaded')
    }

    loadVolume() {
        const stored = Number(localStorage.getItem(VOLUME_STORAGE_KEY))

        return Number.isFinite(stored) && stored > 0 ? Math.min(100, stored) : DEFAULT_VOLUME
    }

    setEvents() {
        this.muteButton.addEventListener('click', () => {
            this.muted = !this.muted

            // Unmuting at zero volume would stay silent — bump to something audible
            if (!this.muted && this.volume === 0) {
                this.volume = DEFAULT_VOLUME
                this.volumeSlider.value = this.volume
            }

            this.applyAudioState()
        })

        this.volumeSlider.addEventListener('input', () => {
            this.volume = Number(this.volumeSlider.value)
            this.muted = this.volume === 0
            localStorage.setItem(VOLUME_STORAGE_KEY, this.volume)

            this.applyAudioState()
        })
    }

    applyAudioState() {
        this.updateMuteButton()

        if (!this.playerReady)
            return

        if (this.muted) {
            this.player.mute()
        } else {
            this.player.unMute()
            this.player.setVolume(this.volume)
        }
    }

    updateMuteButton() {
        this.muteButton.textContent = this.muted ? '🔇' : (this.volume < 50 ? '🔉' : '🔊')
    }

    setNetworkEvents() {
        this.network.on('roomJoined', () => this.syncFromState())
        this.network.on('danceStateChanged', () => this.syncFromState())
        this.network.on('roomLeft', () => this.hide())
    }

    trackTime() {
        const dance = this.network.dance

        return Math.max(0, (this.network.serverClock.now() - dance.startedAt) / 1000)
    }

    syncFromState() {
        const dance = this.network.dance
        const song = (dance?.phase === 'playing' || dance?.phase === 'preparing')
            ? songs.find((candidate) => candidate.id === dance.songId)
            : null

        if (!song?.youtubeId) {
            this.hide()
            return
        }

        // Pre-cue during the intermission so playback starts instantly when
        // the song begins; the cued thumbnail doubles as the "up next" visual
        if (dance.phase === 'preparing') {
            if (this.playerReady) {
                this.element.classList.remove('hidden')

                if (this.currentVideoId !== song.youtubeId) {
                    this.currentVideoId = song.youtubeId
                    this.player.cueVideoById(song.youtubeId)
                }
            }

            return
        }

        this.element.classList.remove('hidden')

        this.loadApi().then(() => this.playVideo(song.youtubeId))
    }

    hide() {
        this.element.classList.add('hidden')
        this.currentVideoId = null

        if (this.playerReady)
            this.player.stopVideo()
    }

    loadApi() {
        if (this.apiPromise)
            return this.apiPromise

        this.apiPromise = new Promise((resolve) => {
            const script = document.createElement('script')
            script.src = 'https://www.youtube.com/iframe_api'
            document.head.appendChild(script)

            window.onYouTubeIframeAPIReady = () => resolve()
        })

        return this.apiPromise
    }

    playVideo(videoId) {
        if (!this.player) {
            this.player = new window.YT.Player('youtube-player', {
                videoId,
                playerVars: {autoplay: 1, controls: 0, disablekb: 1, rel: 0, playsinline: 1},
                events: {
                    onReady: () => {
                        this.playerReady = true
                        this.applyAudioState()
                        this.seekToClock()
                        this.player.playVideo()

                        setTimeout(() => this.ensurePlaying(), 1500)
                    },
                },
            })
            this.currentVideoId = videoId
            return
        }

        if (!this.playerReady)
            return

        if (this.currentVideoId !== videoId) {
            this.currentVideoId = videoId
            this.player.loadVideoById({videoId, startSeconds: this.trackTime() + this.seekLead})
            this.scheduleSettleCheck()
        } else {
            this.seekToClock()
            this.player.playVideo()
        }
    }

    seekToClock() {
        this.player.seekTo(this.trackTime() + this.seekLead, true)
        this.settleAttempts = 0
        this.scheduleSettleCheck()
    }

    scheduleSettleCheck() {
        clearTimeout(this.settleTimer)
        this.settleTimer = setTimeout(() => this.checkSeekSettled(), SEEK_SETTLE_DELAY)
    }

    // Measure where the last seek actually landed and tune seekLead so the
    // next one lands closer; reseek if we're still too far off
    checkSeekSettled() {
        if (!this.playerReady || this.network.dance?.phase !== 'playing')
            return

        if (this.settleAttempts++ >= MAX_SETTLE_ATTEMPTS)
            return

        if (this.player.getPlayerState() !== window.YT.PlayerState.PLAYING) {
            this.scheduleSettleCheck() // still buffering, look again shortly
            return
        }

        const residual = this.player.getCurrentTime() - this.trackTime()

        // Half-step damping to avoid oscillating around the target
        this.seekLead = Math.min(1, Math.max(0, this.seekLead - residual * 0.5))

        if (Math.abs(residual) > DRIFT_TOLERANCE) {
            this.player.seekTo(this.trackTime() + this.seekLead, true)
            this.scheduleSettleCheck()
        }
    }

    // If the browser refused un-muted autoplay, restart muted instead of
    // leaving a frozen player
    ensurePlaying() {
        if (!this.playerReady || this.muted)
            return
        if (this.network.dance?.phase !== 'playing')
            return

        const state = this.player.getPlayerState()
        const {PLAYING, BUFFERING} = window.YT.PlayerState

        if (state !== PLAYING && state !== BUFFERING) {
            this.muted = true
            this.applyAudioState()
            this.seekToClock()
            this.player.playVideo()
        }
    }

    correctDrift() {
        if (!this.playerReady || this.currentVideoId === null)
            return
        if (this.network.dance?.phase !== 'playing')
            return
        if (this.player.getPlayerState() !== window.YT.PlayerState.PLAYING)
            return

        const drift = Math.abs(this.player.getCurrentTime() - this.trackTime())

        if (drift > DRIFT_TOLERANCE)
            this.seekToClock()
    }
}
