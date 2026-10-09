const assert = require("assert");
const { cleanCursorChildEnv } = require("../modules/cursorAccountAuthStore");
const env = cleanCursorChildEnv({ CURSOR_CONFIG_DIR: "/x", BROWSER: "echo" },
    { HOME: "/h", PATH: "/p", CURSOR_API_KEY: "k", CURSOR_AGENT: "1", CURSOR_AGENT_STORE_A: "s", VSCODE_IPC_HOOK: "i" });
assert.deepStrictEqual(env, { HOME: "/h", PATH: "/p", CURSOR_CONFIG_DIR: "/x", BROWSER: "echo" });
assert.ok(!("CURSOR_API_KEY" in cleanCursorChildEnv()));
console.log("ok clean-cursor-child-env");
