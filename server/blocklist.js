import {readFileSync} from 'node:fs'

/**
 * Hard word blocklist for chat and usernames — a deterministic backstop for
 * the OpenAI moderation, which is an LLM judging context and intent, so a
 * bare slur with no surrounding context can read as "low confidence" and slip
 * through. This catches the exact terms you list, every time.
 *
 * Matching folds case, accents and common leetspeak (@->a, 3->e, 0->o, 1->i,
 * 5->s…), tolerates a little separator obfuscation ("f.u.c.k", "f u c k"),
 * and uses word boundaries so innocent substrings (class, assassin) aren't
 * flagged — compound forms like "dumb<slur>" need their own entry.
 *
 * Two sources, checked in order:
 *   1. CHAT_BLOCKLIST env var (comma- or newline-separated). Use this on
 *      Heroku and other ephemeral hosts — set it with `heroku config:set`;
 *      a gitignored file wouldn't survive a deploy or dyno restart there.
 *   2. `blocklist.words.local` (one term per line, # for comments), for local
 *      dev — gitignored (matches *.local) so the list is never pushed. See
 *      blocklist.words.example for the format.
 *
 * Read once at startup, so restart / redeploy after editing. Neither present
 * = no terms blocked.
 */

// Split a comma/newline list, dropping blanks and # comment lines
function parseWords(text) {
    return text
        .split(/[\n,]/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
}

function loadWords() {
    if (process.env.CHAT_BLOCKLIST)
        return parseWords(process.env.CHAT_BLOCKLIST)

    try {
        const path = new URL('./blocklist.words.local', import.meta.url)
        return parseWords(readFileSync(path, 'utf8'))
    } catch {
        console.warn('No CHAT_BLOCKLIST env var or blocklist.words.local file — word blocklist is empty')
        return []
    }
}

const WORDS = loadWords()

// Leetspeak / lookalikes folded to letters before matching
const LEET = {
    '@': 'a', '4': 'a', '3': 'e', '1': 'i', '!': 'i',
    '0': 'o', '5': 's', '$': 's', '7': 't', '9': 'g', '8': 'b',
}

function normalize(text) {
    return text
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '') // strip accents/diacritics
        .replace(/[@!$0-9]/g, (character) => LEET[character] ?? character)
}

function escapeRegExp(character) {
    return character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Each term becomes a regex that allows up to two separators between its
// letters (so "f.u.c.k" / "f u c k" match) and is word-bounded (so "ass"
// doesn't fire inside "class"). Built once at load.
const MATCHERS = WORDS.map((word) => {
    const body = [...normalize(word)]
        .filter((character) => character !== ' ')
        .map(escapeRegExp)
        .join('[\\s._*\\-]{0,2}')

    return new RegExp(`\\b${body}\\b`, 'i')
})

export function matchesBlocklist(text) {
    if (typeof text !== 'string' || MATCHERS.length === 0)
        return false

    const normalized = normalize(text)

    return MATCHERS.some((matcher) => matcher.test(normalized))
}
