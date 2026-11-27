# Soft keys: AI generation (client WS)

Modules: `modules/softKeyGenerate.js`, `modules/androidKeycodes.js`, `modules/ws/handlers/45-softKeysHandler.js`
(StaticForge #1414; the soft key manager is #1067). The phone reads an Android app's own activities, link filters, shortcuts and
keyboard shortcuts and sends **only that**; the generation runs on this server with the chosen chat model, and every answer is
checked here before it reaches the page. Request/response with `requestId`, like `director_settings_get`. Nothing is pushed or
broadcast, and no notice, sound or toast is raised: the page shows the answer.

A profile is `{ left, center, right }`, each `{ action, label, menu?: [{ label, action } | { label: '-', action: 'sep' }] }`
(DSApp `SoftKeys.kt`). New action: `uri:<link>`, an Android Intent that opens a target **inside** the app from outside (a deep link).

## `softkeys_engines`

Request `{}` -> `softkeys_engines_response`
`{ success, engines: [{ id, name, defaultModel, ready, models: [string] }], saved: { engine, model } }`

`engines` is the Director's engine list for chat endpoints (`agentSupervisor.engines`): `tokenrouter` (TokenRouter; its models
include the Claude ones it offers) plus every custom provider (`deepinfra`, `sloproxy`, a `deepseek` provider ...). The Director's
`cursor` and `claude` engines are CLI agents, not chat endpoints, and are not listed. `ready` = the engine has an API key.
`models` come from the catalogs the Director picker already keeps (10 minute cache; an engine with no key lists none); the page
may also let the user type any model id.

`saved` is the default pick: the one saved with `softkeys_default_set`, else DeepSeek: a ready direct DeepSeek provider
(`api.deepseek.com`), else TokenRouter with `deepseek/deepseek-v4.1-flash`, else a ready provider whose default model is a DeepSeek
one, else the first ready engine (`{ engine: '', model: '' }` when none is ready).

## `softkeys_default_set`

Request `{ engine, model }` -> `softkeys_default_set_response` `{ success, saved: { engine, model } }`. Saved in config key
`softKeyGen` (`{ engine, model }`). `engine` may be written `custom:<id>`; a blank `model` takes the engine's default model.
Errors: `SOFTKEYS_ENGINE` (unknown engine), `SOFTKEYS_MODEL` (no model / not a valid model id).

## `softkeys_generate`

Request `{ pkg, label, probe, wish, design, engine, model }`; `engine` / `model` empty = the saved default.

- `pkg` required (`com.example.app`); `label` the app's name; `wish` free text, at most 2000 characters.
- `probe` is what the phone read (tolerant, capped: 200 activities, 150 links, 60 shortcuts, 60 keyboardShortcuts, strings 300 characters):
  `{ pkg, label, versionName, routes: [{ route: 'package-manager'|'manifest'|'shell', ok, error? }], activities: [{ name, exported, label? }],
  links: [{ activity, actions: [...], scheme, host?, path?, pathPrefix?, pathPattern?, intent? }], shortcuts: [{ id, shortLabel, longLabel?, intent? }],
  keyboardShortcuts: [{ label, keys }], notes: [] }`. `scheme` / `host` may be arrays.
- `design` (optional, the pre-design way) `{ left?: { label }, center?: { label }, right?: { label, menu: [{ label } | { sep: true }] } }`:
  the labels she wrote first; the AI finds the matching action for each. Her labels and dividers are kept exactly; a written label the
  AI could not map comes back in `problems` with the AI's reason.

Response `softkeys_generate_response`:

```
{ success: true,
  profile: { left?, center, right? },          // ONLY actions that passed validation
  items:    [{ side, menuIndex|null, profileIndex?, label, action, via, why }],
  problems: [{ side, menuIndex|null, label, action, reason }],
  notes, engine, model, ms }
```

- `via` is exactly one of `link` (the action starts with `uri:`: opens the target from outside, by a deep link / intent), `keys`
  (`key:` / `combo:`: the app is DRIVEN with key events) or `builtin` (`back`, `home`, `recents`, `tasks`, ... `do:<row>`, the app's own `open:android:<pkg>`).
  `why` is the model's one sentence; for `link` it ends with how the link was checked, for `keys` it says honestly that the app is driven
  (`unverified: the phone read no link filters` when the probe had no links).
- `menuIndex` is the row's index in the menu **as written** (the design's menu in the pre-design way, else the model's); an item also
  carries `profileIndex`, its index in the saved `profile.right.menu`. `side` is `left`, `center`, `right`, or `''` for an entry the model
  listed as unmapped that matches no key.
- `problems` is every rejected thing, kept so the page SHOWS it: never saved as a dead button, never dropped. `action` is `''` when the
  model gave none. A side whose key failed is **absent** from `profile` (the page keeps what that side had); `center` is always present
  (default `{ action: 'tasks', label: '' }`).
- A key with a menu has action `ownmenu` (set here when the model forgot); `ownmenu` with no usable rows and `ownmenu` inside a menu
  are problems; a menu left with no valid rows makes the key a problem; dividers never lead, trail or repeat.
- `ms` is the whole generation, one model call (90 s timeout, no polling).

Errors (`type: 'error'`, `requestId`, `code`): `SOFTKEYS_BAD_REQUEST` (no valid `pkg`), `SOFTKEYS_NO_ENGINE`, `SOFTKEYS_NO_KEY`,
`SOFTKEYS_MODEL`, `SOFTKEYS_TIMEOUT`, `SOFTKEYS_RATE_LIMIT`, `SOFTKEYS_UPSTREAM` (the provider's answer, never its key),
`SOFTKEYS_BAD_ANSWER` (the model did not answer with soft keys).

## What is accepted

| Action | Rule |
| --- | --- |
| `back menu ownmenu home recents tasks start today notifications quicksettings keyboard` | `via: builtin`. `none` is refused (it does nothing). |
| `open:android:<pkg>` | only this app's own program id; any other `open:` is refused (ids are never invented) |
| `do:taskmanager / maximize / minimize / close / split / windowed / flashlight / screenshot` | `via: builtin` |
| `key:KEYCODE_X` | a real `android.view.KeyEvent` name (`modules/androidKeycodes.js`, codes 1..316) or a digit string 1..316; `via: keys`. `KEYCODE_POWER`, `SLEEP`, `SOFT_SLEEP`, `ENDCALL` are refused. |
| `combo:KEYCODE_A+KEYCODE_B` | 2 to 5 such keys; `via: keys` |
| `uri:<link>` | `intent:` or `https:` only, at most 600 characters. Never `javascript: file: content: data: market: http:`. An `intent:` link must carry `package=<this app>`, no `component=`, no `SEL;`, no extras; only `action`, `category` (BROWSABLE / DEFAULT), `scheme`, `package`, `type`. Its scheme + host (+ path when the filter has `path` / `pathPrefix` / `pathPattern` (a glob where `.*` works) / `pathAdvancedPattern` / `pathSuffix`) must be accepted by a link filter in the probe, or match one of the app's own shortcuts; an action-only link needs the action in a filter. No link filters read at all: accepted as `unverified`. |

Sizes: key label at most 24 characters, menu label 40, menu at most 24 rows (the rest are problems); a longer label is shortened and the
`why` says so. A key or row whose shown text would be empty (`uri:`, `open:`, `do:` with no label) is a problem.
