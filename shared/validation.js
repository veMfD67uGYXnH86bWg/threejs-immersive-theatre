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
