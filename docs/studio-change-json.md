# Studio change JSON

Paste this entire file into Grok or another web AI. Reply with JSON only — no markdown unless fenced as json.

Hard rules (do these before writing JSON):
- characters: ALWAYS `"action":"replace"` and ALWAYS set `"index"`. index 0 = first slot, index 1 = second slot. NEVER `"add"`. If you write `"add"` it is wrong. Never copy character 0's prompt/uc/name into character 1.
- fields: only `prompt`, `uc`, `promptNegative`. ALWAYS `"action":"replace"`. Never `character:N:...` ids. Named chunks are labels you choose (Scene, Lighting), not one chunk per comma. Do not split text on commas.
- expanders: if you include `"expanders"`, Studio DELETES every current request expander and installs only this list. Put long/repeated blocks here. In prompts write `!prefix` only — do not paste the expander value again.
- Default is replace (overwrite). `remove` deletes a span or slot. Omit unused keys. Only include params you want to change.
- Named resolution (e.g. `normal_portrait`): omit width/height. Custom size only: `"resolution":"custom"` plus width and height.

Example:

```json
{
  "dreamscape": "change",
  "v": 1,
  "title": "short name",
  "params": {
    "steps": 28,
    "guidance": 5,
    "sampler": "k_euler_ancestral",
    "noiseScheduler": "karras",
    "model": "v5",
    "resolution": "normal_portrait",
    "append_uc": 3
  },
  "expanders": [
    { "prefix": "alice_base", "value": "long shared appearance, hair, body" }
  ],
  "fields": [
    {
      "id": "prompt",
      "action": "replace",
      "chunks": [
        { "name": "Subject", "text": "1girl, looking at viewer" },
        { "name": "Lighting", "text": "sunset, golden hour" }
      ]
    },
    {
      "id": "uc",
      "action": "replace",
      "chunks": [{ "name": "Quality", "text": "blurry, lowres" }]
    }
  ],
  "characters": [
    {
      "index": 0,
      "action": "replace",
      "name": "Alice",
      "prompt": "!alice_base, school uniform, smile",
      "uc": "ganyu (genshin impact), goat horns"
    },
    {
      "index": 1,
      "action": "replace",
      "name": "Bob",
      "prompt": "bob prompt, sitting",
      "uc": "alice (name), school uniform"
    }
  ]
}
```
