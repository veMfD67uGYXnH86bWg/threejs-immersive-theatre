/**
 * Validation rules shared by client and server. The server is the authority
 * (everything is re-checked there); the client uses the same rules for
 * instant feedback without a round trip.
 */
export const USERNAME_MAX_LENGTH = 16
export const CHAT_MAX_LENGTH = 240

// Latin letters (accents included), Hangul, Chinese characters and digits —
// no spaces, punctuation or emoji. Add \p{Script=Hiragana}\p{Script=Katakana}
// here if Japanese kana are ever wanted.
export const USERNAME_PATTERN = /^[\p{Script=Latin}\p{Script=Hangul}\p{Script=Han}0-9]{1,16}$/u

// Chat is open: any letter/number/mark/punctuation/symbol (which covers all
// scripts and emoji) plus spaces and the zero-width joiner that composite
// emoji need. What stays banned: control and other invisible characters.
export const CHAT_PATTERN = /^[\p{L}\p{N}\p{M}\p{P}\p{S} \u200d]{1,240}$/u

// Common TLDs, kept as an allowlist so ordinary dotted text (file.png, 3.14,
// U.S.A, e.g.) isn't mistaken for a link. Add more as needed.
const LINK_TLDS =
    'com|net|org|io|gg|co|me|tv|info|biz|app|dev|ai|xyz|link|live|shop|store|' +
    'online|site|club|vip|top|ly|to|gl|cc|be|pw|tk|ml|ga|cf|ru|uk|de|fr|jp|kr|' +
    'cn|us|ca|au|nl|es|it|br|in'

// A link is an explicit scheme (http://, ftp://\u2026), a www. prefix, or a
// domain.tld token. No spaces are allowed around the dot, so a sentence like
// "I agree. Cool." can't trip it \u2014 only a real "example.com" does.
const URL_PATTERN = new RegExp(
    '([a-z][a-z0-9+.-]*://)' +
    '|(\\bwww\\.[a-z0-9-])' +
    `|(\\b[a-z0-9][a-z0-9-]*\\.(?:${LINK_TLDS})\\b)`,
    'i',
)

/**
 * Heuristic link detector for chat. Catches direct links and the common
 * bracketed dot-obfuscations ("example[.]com", "example (dot) com"). It is
 * deliberately not exhaustive \u2014 a determined user can still spell a link out
 * in words \u2014 but it stops casual link posting without false-flagging normal
 * punctuation.
 */
export function containsUrl(raw) {
    if (typeof raw !== 'string')
        return false

    // Fold bracketed dot/"dot" evasions (and any spaces they wrap) to a real
    // dot before testing; the brackets make this unambiguous, so plain text
    // punctuation is untouched.
    const normalized = raw
        .toLowerCase()
        .replace(/\s*[[({]\s*(?:dot|\.)\s*[\])}]\s*/g, '.')

    return URL_PATTERN.test(normalized)
}
