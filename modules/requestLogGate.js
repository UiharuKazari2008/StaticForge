/**
 * Whether the request-logging middleware in web_server.js writes a line for a request (#1230).
 * It used to log every request unconditionally: 62.7% of Dreamscape-out.log. Now it is a DETAILED-level
 * log (config log_verbosity / env, modules/logger.js) or DREAMSCAPE_REQUEST_LOG=1; even then OPTIONS
 * preflights, static asset GETs and the grimoire-browser /sessions/<id>/input ping poll stay out
 * (DREAMSCAPE_REQUEST_LOG=all logs those too).
 */
const DETAILED = 2; // logger.VERBOSITY_LEVELS.DETAILED
const STATIC_EXT = /\.(css|js|mjs|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp3|mp4|webm|ogg|wav|json|wasm)$/i;
const POLL_PATH = /\/sessions\/[^/]+\/input\/?$/;

function envMode(env) {
    const v = String((env || process.env).DREAMSCAPE_REQUEST_LOG || '').toLowerCase();
    return v === 'all' ? 'all' : (v === '1' || v === 'true' ? 'on' : '');
}

function isNoisy(method, reqPath) {
    if (method === 'OPTIONS') return true;
    if (method === 'GET' && STATIC_EXT.test(reqPath)) return true;
    return POLL_PATH.test(reqPath);
}

function shouldLogRequest(method, reqPath, verbosity, env) {
    const mode = envMode(env);
    if (mode === 'all') return true;
    if (!mode && !(verbosity >= DETAILED)) return false;
    return !isNoisy(String(method || '').toUpperCase(), String(reqPath || ''));
}

module.exports = { shouldLogRequest, isNoisy, DETAILED };
