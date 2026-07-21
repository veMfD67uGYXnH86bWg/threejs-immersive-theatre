import {USERNAME_PATTERN, CHAT_PATTERN} from '../../shared/validation.js'

// Re-exported so callers get all chat checks from one module
export {containsUrl} from '../../shared/validation.js'

const EMOTE_ID_MAX_LENGTH = 24

export function sanitizeUsername(raw) {
    if (typeof raw !== 'string')
        return null

    const username = raw.trim()

    return USERNAME_PATTERN.test(username) ? username : null
}

export function sanitizeChatText(raw) {
    if (typeof raw !== 'string')
        return null

    const text = raw.trim().replace(/\s+/g, ' ')

    return CHAT_PATTERN.test(text) ? text : null
}

export function sanitizeEmoteId(raw) {
    if (typeof raw !== 'string')
        return null

    const emoteId = raw.trim().slice(0, EMOTE_ID_MAX_LENGTH)

    return /^[a-zA-Z0-9_-]+$/.test(emoteId) ? emoteId : null
}

export function sanitizeRoomCode(raw) {
    if (typeof raw !== 'string')
        return null

    const code = raw.trim().toUpperCase()

    return /^[A-Z0-9]{4,8}$/.test(code) ? code : null
}
