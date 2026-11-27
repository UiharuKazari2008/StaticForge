'use strict';

// Android's KeyEvent key codes (android.view.KeyEvent, API 1 to 33: KEYCODE_UNKNOWN 0 up to KEYCODE_MACRO_4 316), by code.
// The soft key profiles (#1067) name a key as key:KEYCODE_X and a combo as combo:KEYCODE_A+KEYCODE_B; the phone (DSApp
// SoftKeys.kt) accepts a name with or without the KEYCODE_ prefix, or a digit string 1..KeyEvent.getMaxKeyCode(). #1414: the
// AI-generated profiles are checked here (modules/softKeyGenerate.js) so a button never carries a key the phone would refuse.
// Codes newer than API 33 (317 and up: emoji picker, screenshot, F13 to F24 ...) are left out: the phones run Android 14+, but
// a profile made for one phone must also work on an older one, and none of them is a key an app is driven with.

// the name after KEYCODE_, at its code (index = code)
const NAMES_BY_CODE = [
    'UNKNOWN', 'SOFT_LEFT', 'SOFT_RIGHT', 'HOME', 'BACK', 'CALL', 'ENDCALL', '0', '1', '2',
    '3', '4', '5', '6', '7', '8', '9', 'STAR', 'POUND', 'DPAD_UP',
    'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT', 'DPAD_CENTER', 'VOLUME_UP', 'VOLUME_DOWN', 'POWER', 'CAMERA', 'CLEAR', 'A',
    'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K',
    'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U',
    'V', 'W', 'X', 'Y', 'Z', 'COMMA', 'PERIOD', 'ALT_LEFT', 'ALT_RIGHT', 'SHIFT_LEFT',
    'SHIFT_RIGHT', 'TAB', 'SPACE', 'SYM', 'EXPLORER', 'ENVELOPE', 'ENTER', 'DEL', 'GRAVE', 'MINUS',
    'EQUALS', 'LEFT_BRACKET', 'RIGHT_BRACKET', 'BACKSLASH', 'SEMICOLON', 'APOSTROPHE', 'SLASH', 'AT', 'NUM', 'HEADSETHOOK',
    'FOCUS', 'PLUS', 'MENU', 'NOTIFICATION', 'SEARCH', 'MEDIA_PLAY_PAUSE', 'MEDIA_STOP', 'MEDIA_NEXT', 'MEDIA_PREVIOUS', 'MEDIA_REWIND',
    'MEDIA_FAST_FORWARD', 'MUTE', 'PAGE_UP', 'PAGE_DOWN', 'PICTSYMBOLS', 'SWITCH_CHARSET', 'BUTTON_A', 'BUTTON_B', 'BUTTON_C', 'BUTTON_X',
    'BUTTON_Y', 'BUTTON_Z', 'BUTTON_L1', 'BUTTON_R1', 'BUTTON_L2', 'BUTTON_R2', 'BUTTON_THUMBL', 'BUTTON_THUMBR', 'BUTTON_START', 'BUTTON_SELECT',
    'BUTTON_MODE', 'ESCAPE', 'FORWARD_DEL', 'CTRL_LEFT', 'CTRL_RIGHT', 'CAPS_LOCK', 'SCROLL_LOCK', 'META_LEFT', 'META_RIGHT', 'FUNCTION',
    'SYSRQ', 'BREAK', 'MOVE_HOME', 'MOVE_END', 'INSERT', 'FORWARD', 'MEDIA_PLAY', 'MEDIA_PAUSE', 'MEDIA_CLOSE', 'MEDIA_EJECT',
    'MEDIA_RECORD', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9',
    'F10', 'F11', 'F12', 'NUM_LOCK', 'NUMPAD_0', 'NUMPAD_1', 'NUMPAD_2', 'NUMPAD_3', 'NUMPAD_4', 'NUMPAD_5',
    'NUMPAD_6', 'NUMPAD_7', 'NUMPAD_8', 'NUMPAD_9', 'NUMPAD_DIVIDE', 'NUMPAD_MULTIPLY', 'NUMPAD_SUBTRACT', 'NUMPAD_ADD', 'NUMPAD_DOT', 'NUMPAD_COMMA',
    'NUMPAD_ENTER', 'NUMPAD_EQUALS', 'NUMPAD_LEFT_PAREN', 'NUMPAD_RIGHT_PAREN', 'VOLUME_MUTE', 'INFO', 'CHANNEL_UP', 'CHANNEL_DOWN', 'ZOOM_IN', 'ZOOM_OUT',
    'TV', 'WINDOW', 'GUIDE', 'DVR', 'BOOKMARK', 'CAPTIONS', 'SETTINGS', 'TV_POWER', 'TV_INPUT', 'STB_POWER',
    'STB_INPUT', 'AVR_POWER', 'AVR_INPUT', 'PROG_RED', 'PROG_GREEN', 'PROG_YELLOW', 'PROG_BLUE', 'APP_SWITCH', 'BUTTON_1', 'BUTTON_2',
    'BUTTON_3', 'BUTTON_4', 'BUTTON_5', 'BUTTON_6', 'BUTTON_7', 'BUTTON_8', 'BUTTON_9', 'BUTTON_10', 'BUTTON_11', 'BUTTON_12',
    'BUTTON_13', 'BUTTON_14', 'BUTTON_15', 'BUTTON_16', 'LANGUAGE_SWITCH', 'MANNER_MODE', '3D_MODE', 'CONTACTS', 'CALENDAR', 'MUSIC',
    'CALCULATOR', 'ZENKAKU_HANKAKU', 'EISU', 'MUHENKAN', 'HENKAN', 'KATAKANA_HIRAGANA', 'YEN', 'RO', 'KANA', 'ASSIST',
    'BRIGHTNESS_DOWN', 'BRIGHTNESS_UP', 'MEDIA_AUDIO_TRACK', 'SLEEP', 'WAKEUP', 'PAIRING', 'MEDIA_TOP_MENU', '11', '12', 'LAST_CHANNEL',
    'TV_DATA_SERVICE', 'VOICE_ASSIST', 'TV_RADIO_SERVICE', 'TV_TELETEXT', 'TV_NUMBER_ENTRY', 'TV_TERRESTRIAL_ANALOG', 'TV_TERRESTRIAL_DIGITAL', 'TV_SATELLITE', 'TV_SATELLITE_BS', 'TV_SATELLITE_CS',
    'TV_SATELLITE_SERVICE', 'TV_NETWORK', 'TV_ANTENNA_CABLE', 'TV_INPUT_HDMI_1', 'TV_INPUT_HDMI_2', 'TV_INPUT_HDMI_3', 'TV_INPUT_HDMI_4', 'TV_INPUT_COMPOSITE_1', 'TV_INPUT_COMPOSITE_2', 'TV_INPUT_COMPONENT_1',
    'TV_INPUT_COMPONENT_2', 'TV_INPUT_VGA_1', 'TV_AUDIO_DESCRIPTION', 'TV_AUDIO_DESCRIPTION_MIX_UP', 'TV_AUDIO_DESCRIPTION_MIX_DOWN', 'TV_ZOOM_MODE', 'TV_CONTENTS_MENU', 'TV_MEDIA_CONTEXT_MENU', 'TV_TIMER_PROGRAMMING', 'HELP',
    'NAVIGATE_PREVIOUS', 'NAVIGATE_NEXT', 'NAVIGATE_IN', 'NAVIGATE_OUT', 'STEM_PRIMARY', 'STEM_1', 'STEM_2', 'STEM_3', 'DPAD_UP_LEFT', 'DPAD_DOWN_LEFT',
    'DPAD_UP_RIGHT', 'DPAD_DOWN_RIGHT', 'MEDIA_SKIP_FORWARD', 'MEDIA_SKIP_BACKWARD', 'MEDIA_STEP_FORWARD', 'MEDIA_STEP_BACKWARD', 'SOFT_SLEEP', 'CUT', 'COPY', 'PASTE',
    'SYSTEM_NAVIGATION_UP', 'SYSTEM_NAVIGATION_DOWN', 'SYSTEM_NAVIGATION_LEFT', 'SYSTEM_NAVIGATION_RIGHT', 'ALL_APPS', 'REFRESH', 'THUMBS_UP', 'THUMBS_DOWN', 'PROFILE_SWITCH', 'VIDEO_APP_1',
    'VIDEO_APP_2', 'VIDEO_APP_3', 'VIDEO_APP_4', 'VIDEO_APP_5', 'VIDEO_APP_6', 'VIDEO_APP_7', 'VIDEO_APP_8', 'FEATURED_APP_1', 'FEATURED_APP_2', 'FEATURED_APP_3',
    'FEATURED_APP_4', 'DEMO_APP_1', 'DEMO_APP_2', 'DEMO_APP_3', 'DEMO_APP_4', 'KEYBOARD_BACKLIGHT_DOWN', 'KEYBOARD_BACKLIGHT_UP', 'KEYBOARD_BACKLIGHT_TOGGLE', 'STYLUS_BUTTON_PRIMARY', 'STYLUS_BUTTON_SECONDARY',
    'STYLUS_BUTTON_TERTIARY', 'STYLUS_BUTTON_TAIL', 'RECENT_APPS', 'MACRO_1', 'MACRO_2', 'MACRO_3', 'MACRO_4'
];

/** KeyEvent.getMaxKeyCode() for the codes listed here. */
const MAX_KEYCODE = NAMES_BY_CODE.length - 1;

/** Every KEYCODE_ name (UNKNOWN left out: the phone refuses it). */
const KEYCODES = new Set(NAMES_BY_CODE.slice(1).map((n) => `KEYCODE_${n}`));

/** KEYCODE_NAME -> code. */
const CODE_OF = new Map(NAMES_BY_CODE.slice(1).map((n, i) => [`KEYCODE_${n}`, i + 1]));

/**
 * Keys a button must never send: they lock, sleep or power off the phone (an unattended phone that went to sleep cannot be
 * woken by an agent: Yukimi's rule), or end a call.
 */
const BLOCKED = new Set(['KEYCODE_POWER', 'KEYCODE_SLEEP', 'KEYCODE_SOFT_SLEEP', 'KEYCODE_ENDCALL']);

/** Names the page types in lower case or short: the manager's own (wmSettingsPersonal.js SK_NAMES) so a model's "CTRL" is a key too. */
const ALIASES = { CTRL: 'CTRL_LEFT', CONTROL: 'CTRL_LEFT', SHIFT: 'SHIFT_LEFT', ALT: 'ALT_LEFT', WIN: 'META_LEFT', META: 'META_LEFT' };

/**
 * The code of one key as the phone reads it (SoftKeys.keyCode): a digit string 1..MAX_KEYCODE, or a KEYCODE_ name (the prefix
 * may be left off). null when the phone would refuse it. Case matters on the phone (KeyEvent.keyCodeFromString), so it does
 * here: names are upper case.
 */
function keyCode(name) {
    const n = String(name == null ? '' : name).trim();
    if (!n) return null;
    if (/^\d+$/.test(n) && n.length <= 4) {
        // the phone tries the digits first: "7" is code 7 (the 7 key's code too), never the name KEYCODE_7
        const c = Number(n);
        return c >= 1 && c <= MAX_KEYCODE ? c : null;
    }
    const full = n.startsWith('KEYCODE_') ? n : `KEYCODE_${n}`;
    return CODE_OF.get(full) || null;
}

/** The KEYCODE_ name of a code (1..MAX_KEYCODE), or ''. */
function nameOf(code) {
    const c = Number(code);
    return Number.isInteger(c) && c >= 1 && c <= MAX_KEYCODE ? `KEYCODE_${NAMES_BY_CODE[c]}` : '';
}

/** Is this a KEYCODE_ name the phone knows (the prefix required)? */
function isKeycodeName(name) {
    return KEYCODES.has(String(name || ''));
}

/** A key written any usual way -> 'KEYCODE_X' ('' when it is none). Digits stay digits' codes: "29" -> KEYCODE_A. */
function normalizeName(name) {
    const n = String(name == null ? '' : name).trim();
    if (!n) return '';
    if (/^\d+$/.test(n)) return nameOf(keyCode(n));
    const bare = n.toUpperCase().replace(/^KEYCODE_/, '');
    const full = `KEYCODE_${ALIASES[bare] || bare}`;
    return KEYCODES.has(full) ? full : '';
}

/** A combo's key codes in order (SoftKeys.keyCodes: 2..5 parts here, as the manager writes them), or null. */
function keyCodes(combo) {
    const parts = String(combo == null ? '' : combo).split('+').filter((p) => p.trim());
    if (parts.length < 2 || parts.length > 5) return null;
    const codes = [];
    for (const p of parts) {
        const c = keyCode(p);
        if (c == null) return null;
        codes.push(c);
    }
    return codes;
}

/** Does the key send something a button must never send (power, sleep, end call)? */
function isBlocked(name) {
    const c = keyCode(name);
    return c != null && BLOCKED.has(nameOf(c));
}

module.exports = { NAMES_BY_CODE, KEYCODES, MAX_KEYCODE, BLOCKED, keyCode, keyCodes, nameOf, isKeycodeName, normalizeName, isBlocked };

require('./hotReload').mark(module);
