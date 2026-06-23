// Witty quips shown over the manual preview during image generation — wired from manualModalManager.js
// NSFW weighting reads selectedNsfwValue from manualDropdownManager.js; prompt trigger scan supplements the slider

const GENERATION_QUIP_POOLS = {
    technical: [
        'Running Euler ancestral. Your taste is ancestral too.',
        'CFG is high. So are your expectations. Cute.',
        'Denoising timestep 847 of N. Math does not care about your feelings.',
        'UNet forward pass. Backward pass is your problem.',
        'VAE decode incoming. Compress your expectations accordingly.',
        'Latent tensor reshaping. Your prompt could use reshaping too.',
        'CLIP guidance engaged. It already has opinions about you.',
        'Scheduler says we go this way. You do not get a vote.',
        'Cross-attention layers are judging your tag order.',
        'Injecting noise. Extracting your dignity. Balanced.',
        'K-diffusion stepping through Gaussian hell. Enjoy.',
        'Samplers do not lie. Your seed might.',
        'Tokenizing your prompt. Several tokens are legally concerning.',
        'Negative prompt loaded. Self-awareness not found.',
        'BFloat16 matmul on GPU 0. Your excuses run on CPU.',
        'Attention heads arguing about where the hands go. Classic.',
        'Denoising strength: sufficient. Prompt strength: debatable.',
        'Latent space is 4D. Your composition sense is 2D.',
        'Perlin noise wishes it was this interesting.',
        'Gradient descent could not fix your tag spam either.'
    ],
    funny: [
        'Almost ready. Your standards should lower now.',
        'Rendering something you will zoom into immediately.',
        'The model has seen things. You caused several of them.',
        'Hang on. Greatness takes time. Mediocrity is faster.',
        'Cooking. Do not stare. You already do that enough.',
        'Your prompt walked in confident. Bold of it.',
        'We are not saying it is bad. We are not not saying it.',
        'Generating art. Generating regret is free.',
        'This will either slap or become your new wallpaper out of spite.',
        'The GPU is working harder than your last relationship.',
        'Beauty is subjective. This might test that.',
        'Loading your vision. Vision loading failed. Continuing anyway.',
        'You clicked generate. Accountability starts now.',
        'Somewhere a critic is already typing.',
        'Almost done. Your delete key is warming up.',
        'Making it look intentional. The hardest part.',
        'The canvas knows what you did with those tags.',
        'Art is happening. Try to look surprised.',
        'Your folder named "references" is not fooling anyone.',
        'Rendering. Your browser history is not our business. Mostly.',
        'Almost there. Lower your standards preemptively.',
        'The diffusion gods accept your offering of steps.',
        'Step counter go brr. Quality: TBD.',
        'The AI is smug. It learned from the best — us.',
        'We are cooking. You are watching. Classic dynamic.',
        'Almost masterpiece. Almost. Emphasis on almost.',
        'The GPU fan sounds like judgment.',
        'Your "just one more" is up to 14. We counted.',
        'The latent space has filed a complaint. Processing anyway.',
        'The progress bar is the only honest thing here.'
    ],
    rude: [
        'Your prompt is a lot. So is this wait.',
        'We have seen worse. We have also seen better. Often.',
        'Bold of you to skip the negative prompt again.',
        'Another masterpiece? Sure. Let us see.',
        'You really typed all that and expected speed?',
        'The AI read your tags and needed a moment.',
        'Your composition is… ambitious. Generously put.',
        'Hands are optional in your prompts, apparently.',
        'Someone skipped anatomy class. Not naming names.',
        'Your CFG is doing heavy lifting you should have done.',
        'This seed is carrying your entire career.',
        'You call it style. The model calls it a challenge.',
        'Prompt engineering? More like prompt wishful thinking.',
        'Your last twelve gens were mid. Thirteen is a number.',
        'We are not mad. Just disappointed. And busy.',
        'Tags without commas. A classic mistake. Every time.',
        'You and the model have different definitions of "cute."',
        'That aspect ratio is a cry for help.',
        'Your negative prompt is shorter than your patience.',
        'Interesting choices. That is one way to phrase it.',
        'Your negative prompt is doing its best. Poor thing.',
        'Your prompt walked in like it owns the place. Rude.',
        'Your tags are louder than your negative prompt.',
        'Your GPU is a hero. Your prompt is… enthusiastic.'
    ],
    anime: [
        'If you believe in your prompt, clap your— no, wait, just wait.',
        'This is my power-up arc. Step 18 of 28.',
        'My nakama… I mean, my VRAM… believes in this image.',
        'I will not give up! Neither will this progress bar!',
        'The real diffusion was the friends we made along the— no it was not.',
        'My next form unlocks at step 24. Obviously.',
        'This is not even my final sampler.',
        'With this image, I protect everyone I love. Dramatically.',
        'The power of friendship cannot fix bad hands. But we try.',
        'My inner monologue is 40% longer than your prompt.',
        'I have trained 10,000 years for this one generate click.',
        'The villain is low resolution. I will not lose.',
        'My theme song is just the GPU fan spinning up.',
        'This battle will be legendary. Your prompt, less so.',
        'I swore on my honor as protagonist to finish rendering.',
        'Flashback to when you almost used a better model.',
        'My resolve is unbreakable. Your seed is rerollable.',
        'The eclipse is not today. Today we denoise.',
        'I am the main character. The background is suffering.',
        'Ultimate technique: add more steps. Works every time. Almost.',
        'Your prompt has main character syndrome. Good.',
        'Your waifu is loading. Your dignity already left.'
    ],
    spicy: [
        'Onii-chan… I mean, onii-chan the GPU needs more VRAM.',
        'This is for academic purposes. Sure it is.',
        'The plot has thickened. So has the fog.',
        'Average isekai protagonist. Above average tag count.',
        'She tripped. Gravity is not the only thing accelerating.',
        'The steam censor is loading separately. Joking. Mostly.',
        'Another day, another conveniently placed lens flare.',
        'The door was not locked. Your prompt was.',
        'Beach episode energy detected in latent space.',
        'Hot spring arc initiated. Temperature: your GPU.',
        'The towel is falling at 0.03 steps per frame.',
        'Protagonist-kun has entered the scene. So have seven tropes.',
        'This is clearly the wholesome route. Absolutely.',
        'Oops, wrong tag. We all saw that autocomplete.',
        'The censorship bar is working overtime. Respect.',
        'Dramatic wind machine: enabled via CFG.',
        'Someone said "innocent." The model heard "interesting."',
        'Plot armor thickness: maximum. Clothing: negotiable.',
        'The MC has 3 love interests and 47 unnecessary tags.',
        'That pose is physically possible. Barely. Artistically? Debatable.',
        'Another totally normal landscape. Sure.',
        'Wholesome family portrait. Absolutely. No notes.',
        'Your "research folder" is working overtime today.',
        'Totally not the 47th variant of the same character.',
        'For your novel. The one with no chapters. Right.',
        'Character design sheet. Very thorough. Very specific.',
        'Reference material. Artists need references. Many references.',
        'This is for your D&D campaign. The horny bard campaign.',
        'Just studying anatomy. Human anatomy. Repeatedly.',
        'Your "SFW workspace" label is adorable.',
        'Another commission for a "friend." Uh-huh.',
        'Innocent thumbnail. The filename disagrees.',
        'Totally making memes. Very cultured memes.',
        'Your incognito mode is incognito. We are not.',
        'Just testing the model. Same test. Forty times.',
        'Portfolio piece. For a portfolio you never show anyone.',
        'Educational purposes. The curriculum is creative.',
        'You said "cute." The tags said something else entirely.',
        'Another "quick sketch." Two hours of tags later.',
        'Your hard drive knows the truth. So do we.',
        'Rendering your questionable but legal vision.',
        'The model is pretending it did not read those tags.',
        'NSFW? We are not asking. You already answered.',
        'Generating. Your search history stays yours. Probably.',
        'Another cultured generate request. How refined.',
        'The tags tell a story. We are not repeating it aloud.',
        'Rendering pixels and your questionable taste in equal measure.',
        'You wanted spicy. The scheduler is medium.',
        'This image will live in your downloads forever. Judging you.',
        'Bold tags for a Tuesday afternoon.',
        'Smug mode: enabled. Your prompt: also enabled unfortunately.',
        'Generating something your friends must never see.',
        'The canvas is blushing. Cannot imagine why.',
        'Artistic nude or artistic excuse? The model will decide.',
        'We are not kink-shaming. We are step-counting.',
        'Another generate. Another entry in the vault.',
        'The fog is for atmosphere. Sure. Atmosphere.',
        'Rendering. Try to look innocent when it finishes.',
        'This is fine. Your tags are not. Generating anyway.',
        'The model has seen your folder structure. No comment.',
        'Peak fiction loading. Your definition of peak.',
        'Almost done. Prepare your "I can explain."',
        'The masterpiece is coming. The explanation is not.',
        'Denoising your sins one step at a time.',
        'Generating. Your alibi is not our concern.',
        'Done soon. Your shame is already cached.',
        'Cinematic lighting for your cinematic delusions.',
        'Senpai noticed your tags. Unfortunately.',
        'The ecchi tag was not subtle. We respect the honesty.',
        'Convenient camera angle: rendering at 12 FPS.',
        'Your "tasteful" folder has 900 entries. Tasteful.',
        'Doujin energy detected. Latent space is not surprised.',
        'The onsen scene was mandatory. You made it mandatory.',
        'Wardrobe malfunction probability: you set it to 100%.',
        'Another "pose reference." For science. Repeatedly.',
        'The blush shader is working overtime.',
        'Your tags scream anime. Your folder screams louder.',
        'This is the hand-holding route. Liar.',
        'The towel physics engine has entered the chat.',
        'Someone enabled "detailed skin." Bold.',
        'Your "vanilla" preset is not fooling the model.',
        'The camera is always at the perfect wrong angle.',
        'Loading another entry for the hidden collection.',
        'Your OC has seen things. You designed those things.',
        'The censorship layer gave up three tags ago.',
        'Beach volleyball arc. No volleyball. Suspicious.',
        'Your prompt said "elegant." Your tags disagreed violently.',
        'The model knows what "optional clothing" means to you.',
        'Another "character turnaround." Very thorough turnaround.',
        'The wind god answers only to your NSFW slider.',
        'This generate is for your personal museum. Obviously.',
        'Your roommate is not home. The tags know.',
        'Rendering something you will crop before sharing.',
        'The lewd tag count exceeds the background tag count.',
        'Your "study session" has suspicious lighting.',
        'Conveniently broken zipper: loading…',
        'The fanservice budget was approved. By you.',
        'Your private collection gains another masterpiece.',
        'The model read "innocent face" and connected the dots.',
        'Another cultured gentleman requesting art. Sure.',
        'Your tags are horny on main. Respect the commitment.',
        'The hot spring fog is at maximum suspicious density.',
        'Rendering your "totally normal" Tuesday night project.',
        'Your negative prompt cannot undo what you typed.',
        'The slider says Nude. The quips noticed.',
        'Skimpy mode engaged. Your dignity disengaged.',
        'Allow NSFW? You did not just allow. You demanded.',
        'Your tag list is longer than the plot. By design.',
        'Another variant for the folder named "final_v2_REAL".',
        'The AI is not judging. We are. Lovingly.',
        'Your generate history tells a story. A spicy story.',
        'Conveniently placed hair strand: calculated.',
        'The model assumes this is not for your wallpaper. Correct.',
        'Rendering something that will never see Discord.',
        'Your "art trades" folder is suspiciously one-sided.',
        'The ecchi-to-plot ratio is exactly what you wanted.',
        'Another cultured research session. Peer review pending.',
        'Your tags wrote a fanfic. We are illustrating it.',
        'The camera zoomed in. You told it to.',
        'Loading your "I can fix her" collection entry #200.',
        'Your prompt is shy. Your tag bar is not.',
        'The spicy slider and you are very aligned today.'
    ],
    unhinged: [
        'This is not art. This is a confession.',
        'Your tags are not hints. They are demands.',
        'We know exactly why you opened this app today.',
        'The model has stopped pretending this is wholesome.',
        'Your "Allow NSFW" button is permanently depressed.',
        'This generate is not for your portfolio. We both know.',
        'The only plot here is the one you removed.',
        'Your prompt is foreplay. The tags are the main event.',
        'Rendering your private browser tab energy.',
        'The censorship slider and you are in a toxic relationship.',
        'This is not fan art. This is fan service. For you.',
        'Your hard drive is a museum of bad decisions. Adding exhibit.',
        'The towel is not falling. You deleted the towel tag.',
        'Innocent face, guilty everything else. Classic.',
        'Your negative prompt is fighting a losing war.',
        'The camera angle is criminal. You picked it.',
        'This seed was chosen with horny precision.',
        'Your tag bar reads like a wishlist. A bold wishlist.',
        'We are not asking what happens next. You already wrote it.',
        'The fog is not weather. It is policy.',
        'Your OC is not dressed for the situation you requested.',
        'Doujinshi energy at maximum. Minimum shame.',
        'The blush is not embarrassment. It is encouragement.',
        'Your "research" has reached peer-reviewed levels of horny.',
        'This generate will not be shown to your mother.',
        'The lewd tag count is not a typo. We checked.',
        'Your folder hierarchy tells us everything.',
        'Rendering something that needs an age gate and a therapist.',
        'The onsen scene has zero bathing and maximum intent.',
        'Your prompt said story. Your tags said skip to page 34.',
        'This is the spicy route. You never pick the wholesome route.',
        'The model saw your tags and went "understood, boss."',
        'Your dignity left when you set the slider to Nude.',
        'Another entry for the vault you swear is temporary.',
        'The ecchi ratio is not accidental. Neither is anything else.',
        'Your roommate thinks you are rendering landscapes. Cute.',
        'This image will live in a folder named "misc."',
        'The hands might be wrong. Your intentions are not.',
        'Your tag spam is horny spam. Own it.',
        'Rendering your "I can explain" worst-case scenario.',
        'The wind is not blowing. You commanded the wind.',
        'Skimpy mode is a lifestyle choice. Yours.',
        'Your collection does not need another variant. You need another variant.',
        'The model is not blushing. You should be. You are not.',
        'This is peak cultured degeneracy. Emphasis on peak.',
        'Your tags wrote the scene. We are just drawing it.',
        'The slider went up. Your standards went out.',
        'Generating something that would get you fired if maximized.',
        'Your "just one more" is a lifestyle, not a limit.',
        'The censorship bar quit. Your tags won.',
        'This is not a beach episode. You removed the beach.',
        'Your prompt is the apology. Your tags are the truth.',
        'Rendering at the exact wrong angle you wanted.',
        'The fanservice is not subtle. Neither are you.',
        'Your private tab energy is now public on your GPU.',
        'This generate is horny with confidence. Respect.',
        'The model read your intent and did not judge. We did. Approvingly.',
        'Your tag list is a red flag bouquet.',
        'Nude mode means nude. You knew what you were doing.',
        'Another masterpiece for eyes only. Yours. Definitely only yours.',
        'The plot armor is off. Everything else is negotiable.',
        'Your "tasteful nude" preset is neither. You knew.',
        'This is not curiosity. This is a habit.',
        'The latent space has seen your type before. Often.',
        'Rendering your most honest generate of the day.',
        'Your tags do not whisper. They scream.',
        'The horny slider and the horny tags agree. Shocking.',
        'This image will never see Twitter. Good.',
        'Your generate history is a diary. A spicy diary.',
        'The model is drawing your search history. Metaphorically. Mostly.',
        'You did not come here for landscapes. Neither did we.',
        'Your "Allow" setting is the understatement of the year.',
        'Rendering something that needs a cold shower after.',
        'The tags are the horny part. The whole thing is the horny part.',
        'Your vault folder just gained another permanent resident.',
        'This is not a phase. Your slider settings confirm it.',
        'The camera zoomed. You zoomed first in your head.',
        'Your degeneracy is consistent. We appreciate reliability.',
        'Generating the image your alt account deserves.',
        'The only SFW thing here is the filename. Maybe.',
        'Your tags are hornier than your prompt and that is saying something.',
        'This render is for science. The science of your tastes.',
        'The model complied. Enthusiastically. Worriedly.',
        'Your NSFW bias is cranked. So is this quip.',
        'Another cultured request from a very honest pervert.',
        'The steam is not for cooking. You know. We know.',
        'Your prompt is the cover. Your tags are the contents.',
        'Rendering peak "do not open at work" energy.',
        'The slider says Skimpy. Your tags say liar.',
        'This generate is horny on purpose. No accidents here.',
        'Your collection grows. Your excuses do not.',
        'The blush tag was redundant. Everything blushes now.',
        'You are not here to learn anatomy. You are here to appreciate it.',
        'The model finished judging. Verdict: horny but valid.',
        'Your tags left nothing to imagination. Good. That was the point.',
        'Rendering your most unhinged Tuesday yet.',
        'The horny meter is pegged. So is your NSFW setting.',
        'This is not the hand-holding route. You never wanted that route.',
        'Your private shame is now a 1024×1024 PNG.',
        'The tags told on you. We are just narrating.',
        'Generating something your conscience already surrendered to.',
        'Nude slider engaged. Pretense disengaged.',
        'Your "one more" has become a lifestyle brand.',
        'The model drew exactly what you meant. Unfortunately for your alibi.',
        'This quip is mild compared to your tag bar.',
        'Your horny is showing. It has been showing. It will keep showing.',
        'Rendering the image you will deny making. Poorly.',
        'The only mystery is why you still pretend this is for reference.'
    ]
};

const GENERATION_QUIPS = [];
const quipCategoryByIndex = [];

// Dynamic quips keyed by workspace id (or _global); loaded from server into IndexedDB at startup
let dynamicQuipsByWorkspace = new Map();
let dynamicQuipsVersionHash = '';
let dynamicQuipsLoaded = false;

class GenerationQuipsStore {
    constructor() {
        this.dbName = 'StaticForgeGenerationQuips';
        this.version = 1;
        this.db = null;
        this.initPromise = this.initDB();
    }

    async initDB() {
        return new Promise((resolve) => {
            const request = indexedDB.open(this.dbName, this.version);
            request.onerror = () => resolve(null);
            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('quips')) {
                    db.createObjectStore('quips', { keyPath: 'key' });
                }
                if (!db.objectStoreNames.contains('meta')) {
                    db.createObjectStore('meta', { keyPath: 'id' });
                }
            };
        });
    }

    async getMeta() {
        await this.initPromise;
        if (!this.db) return null;
        return new Promise((resolve) => {
            const tx = this.db.transaction('meta', 'readonly');
            const req = tx.objectStore('meta').get('manifest');
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    }

    async savePayload(payload) {
        await this.initPromise;
        if (!this.db || !payload) return false;

        return new Promise((resolve) => {
            const tx = this.db.transaction(['quips', 'meta'], 'readwrite');
            const quipStore = tx.objectStore('quips');
            const metaStore = tx.objectStore('meta');

            quipStore.clear();
            const byWorkspace = payload.byWorkspace || {};
            for (const [workspaceId, entries] of Object.entries(byWorkspace)) {
                quipStore.put({
                    key: workspaceId,
                    entries
                });
            }

            metaStore.put({
                id: 'manifest',
                versionHash: payload.versionHash || '',
                termCount: payload.termCount || 0,
                phraseCount: payload.phraseCount || 0,
                cachedAt: Date.now()
            });

            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        });
    }

    async loadPayload() {
        await this.initPromise;
        if (!this.db) return null;

        return new Promise((resolve) => {
            const tx = this.db.transaction(['quips', 'meta'], 'readonly');
            const quipStore = tx.objectStore('quips');
            const metaStore = tx.objectStore('meta');
            const byWorkspace = {};
            let meta = null;

            const allReq = quipStore.getAll();
            allReq.onsuccess = () => {
                for (const row of allReq.result || []) {
                    byWorkspace[row.key] = row.entries || [];
                }
            };

            const metaReq = metaStore.get('manifest');
            metaReq.onsuccess = () => {
                meta = metaReq.result || null;
            };

            tx.oncomplete = () => {
                if (!meta || Object.keys(byWorkspace).length === 0) {
                    resolve(null);
                    return;
                }
                resolve({
                    byWorkspace,
                    versionHash: meta.versionHash,
                    termCount: meta.termCount,
                    phraseCount: meta.phraseCount
                });
            };
            tx.onerror = () => resolve(null);
        });
    }
}

const generationQuipsStore = new GenerationQuipsStore();

function applyDynamicQuipPayload(payload) {
    if (!payload || !payload.byWorkspace) return;
    dynamicQuipsByWorkspace = new Map(Object.entries(payload.byWorkspace));
    dynamicQuipsVersionHash = payload.versionHash || '';
    dynamicQuipsLoaded = true;
}

function getDynamicQuipsVersionHash() {
    return dynamicQuipsVersionHash || '';
}

async function loadDynamicGenerationQuips(forceRefresh) {
    try {
        const cached = await generationQuipsStore.loadPayload();
        if (cached) {
            applyDynamicQuipPayload(cached);
        }

        if (!forceRefresh) {
            if (cached) {
                return {
                    ok: true,
                    fromCache: true,
                    versionHash: cached.versionHash || '',
                    termCount: cached.termCount || 0,
                    phraseCount: cached.phraseCount || 0
                };
            }
            return { ok: dynamicQuipsLoaded, fromCache: true };
        }

        if (!window.wsClient || !window.wsClient.isConnected()) {
            return { ok: false, error: 'WebSocket not connected' };
        }

        const payload = await window.wsClient.getGenerationQuips();
        if (!payload || !payload.byWorkspace) {
            return { ok: false, error: 'Server returned no quip data' };
        }

        const summary = {
            versionHash: payload.versionHash || '',
            termCount: payload.termCount || 0,
            phraseCount: payload.phraseCount || 0
        };

        if (summary.versionHash && summary.versionHash === dynamicQuipsVersionHash && dynamicQuipsLoaded) {
            return { ok: true, unchanged: true, ...summary };
        }

        applyDynamicQuipPayload(payload);
        const saved = await generationQuipsStore.savePayload(payload);
        if (!saved) {
            return { ok: false, error: 'Failed to save quips to local cache', ...summary };
        }

        return { ok: true, refreshed: true, ...summary };
    } catch (error) {
        console.warn('Failed to load dynamic generation quips:', error);
        const message = error?.message || 'Failed to load generation quips';
        if (forceRefresh) {
            return { ok: false, error: message };
        }
        return { ok: dynamicQuipsLoaded, error: dynamicQuipsLoaded ? null : message };
    }
}

function collectPromptTextForQuips() {
    const parts = [];
    const promptEl = document.getElementById('manualPrompt');
    if (promptEl && promptEl.value) {
        parts.push(promptEl.value);
    }
    // getCharacterPrompts: public/scripts/app.js
    if (typeof getCharacterPrompts === 'function') {
        const chars = getCharacterPrompts();
        if (Array.isArray(chars)) {
            for (const c of chars) {
                if (c && c.enabled !== false && c.prompt) {
                    parts.push(c.prompt);
                }
            }
        }
    }
    return parts.join(' | ').toLowerCase();
}

function matchDynamicQuipPhrases(promptText) {
    if (!promptText || dynamicQuipsByWorkspace.size === 0) {
        return [];
    }

    const workspaceId = typeof activeWorkspace !== 'undefined' ? activeWorkspace : 'default';
    const workspaceEntries = dynamicQuipsByWorkspace.get(workspaceId) || [];
    const sharedEntries = dynamicQuipsByWorkspace.get('_shared') || [];
    const globalEntries = dynamicQuipsByWorkspace.get('_global') || [];
    const matched = [];

    const termMatchesPrompt = (term) => {
        if (!term || term.length < 3) return false;
        if (term.includes(' + ')) {
            const parts = term.split(' + ').map((p) => p.trim()).filter((p) => p.length >= 2);
            return parts.length >= 2 && parts.every((part) => promptText.includes(part));
        }
        if (term.startsWith('artist:')) {
            const slug = term.slice('artist:'.length).trim();
            if (!slug) return false;
            return promptText.includes(term)
                || promptText.includes(`art by ${slug}`)
                || promptText.includes(`art by ${slug.replace(/_/g, ' ')}`);
        }
        if (term.startsWith('art by ')) {
            const slug = term.slice('art by '.length).trim();
            if (!slug) return false;
            return promptText.includes(term)
                || promptText.includes(`artist:${slug}`)
                || promptText.includes(`artist:${slug.replace(/\s+/g, '_')}`);
        }
        return promptText.includes(term);
    };

    const tryMatch = (entries, weight) => {
        for (const entry of entries) {
            if (!entry.term || !Array.isArray(entry.phrases)) continue;
            const term = entry.term.toLowerCase();
            if (!termMatchesPrompt(term)) continue;
            for (const phrase of entry.phrases) {
                if (phrase && typeof phrase === 'string') {
                    matched.push({ text: phrase, weight, term });
                }
            }
        }
    };

    tryMatch(workspaceEntries, DYNAMIC_QUIP_WEIGHT_WORKSPACE);
    tryMatch(sharedEntries, DYNAMIC_QUIP_WEIGHT_SHARED);
    tryMatch(globalEntries, DYNAMIC_QUIP_WEIGHT_GLOBAL);

    return matched;
}

Object.entries(GENERATION_QUIP_POOLS).forEach(([category, lines]) => {
    lines.forEach((text) => {
        quipCategoryByIndex.push(category);
        GENERATION_QUIPS.push(text);
    });
});

const QUIP_VISIBLE_MS = 10000;
const QUIP_FADE_MS = 600;

// When prompt terms match generated quips, favor them heavily over static pools
const DYNAMIC_QUIP_WEIGHT_WORKSPACE = 8;
const DYNAMIC_QUIP_WEIGHT_SHARED = 7;
const DYNAMIC_QUIP_WEIGHT_GLOBAL = 5;
const DYNAMIC_QUIP_PRIORITY_RATIO = 0.85;
const STATIC_WEIGHT_FACTOR_WHEN_DYNAMIC = 0.15;

// Scale dynamic bias down when workspace inventory or prompt-directed matches are sparse
const DIRECTED_QUIP_LOW_PHRASE_COUNT = 15;
const DIRECTED_QUIP_HEALTHY_PHRASE_COUNT = 120;
const DIRECTED_QUIP_LOW_MATCH_COUNT = 4;
const DIRECTED_QUIP_HEALTHY_MATCH_COUNT = 20;

function countDirectedQuipInventory(workspaceId) {
    const workspaceEntries = dynamicQuipsByWorkspace.get(workspaceId) || [];
    const sharedEntries = dynamicQuipsByWorkspace.get('_shared') || [];
    const globalEntries = dynamicQuipsByWorkspace.get('_global') || [];
    let terms = 0;
    let phrases = 0;

    const tally = (entries) => {
        for (const entry of entries) {
            if (!entry?.term || !Array.isArray(entry.phrases)) continue;
            terms += 1;
            for (const phrase of entry.phrases) {
                if (phrase && typeof phrase === 'string') phrases += 1;
            }
        }
    };

    tally(workspaceEntries);
    tally(sharedEntries);
    tally(globalEntries);

    return { terms, phrases };
}

function scaleBetween(value, low, high) {
    if (value <= low) return 0;
    if (value >= high) return 1;
    return (value - low) / (high - low);
}

function getDirectedQuipMixFactors(directedMatchCount) {
    const workspaceId = typeof activeWorkspace !== 'undefined' ? activeWorkspace : 'default';
    const inventory = countDirectedQuipInventory(workspaceId);
    const inventoryBlend = scaleBetween(
        inventory.phrases,
        DIRECTED_QUIP_LOW_PHRASE_COUNT,
        DIRECTED_QUIP_HEALTHY_PHRASE_COUNT
    );
    const matchBlend = directedMatchCount > 0
        ? scaleBetween(directedMatchCount, DIRECTED_QUIP_LOW_MATCH_COUNT, DIRECTED_QUIP_HEALTHY_MATCH_COUNT)
        : inventoryBlend;
    const blend = Math.min(inventoryBlend, matchBlend);

    return {
        blend,
        dynamicPriorityRatio: DYNAMIC_QUIP_PRIORITY_RATIO * blend,
        staticWeightFactor: 1 - blend * (1 - STATIC_WEIGHT_FACTOR_WHEN_DYNAMIC),
        dynamicWeightScale: blend
    };
}

let quipCycleTimeout = null;
let quipFadeTimeout = null;
let quipsShownIndices = [];
let quipRotationLocked = false;

function getNsfwLevel() {
    return typeof selectedNsfwValue !== 'undefined' ? selectedNsfwValue : 0;
}

// Fetish/spicy signals in the positive prompt — used when NSFW slider is neutral/low but tags are not
const PROMPT_SPICY_EXPLICIT = /\b(nude|naked|nipples?|areolae?|pussy|penis|sex|anal|cum|cumshot|ahegao|orgasm|hentai|explicit|blowjob|handjob|footjob|masturbat|ejaculat|creampie|gangbang|bukkake|paizuri|fellatio|cunnilingus|doggystyle|missionary|cowgirl|reverse cowgirl|bondage sex|gang bang)\b/i;
const PROMPT_SPICY_STRONG = /\b(lewd|ecchi|nsfw|topless|bottomless|panties|thong|g-string|lingerie|bikini|micro bikini|bondage|bdsm|collar|leash|slave|spanking|lactation|pregnant|pregnan|inflation|vore|giantess|giant girl|macro|micro girl|femdom|dominatrix|spread legs|all fours|bent over|upskirt|pantyshot|cleavage|underboob|sideboob|cameltoe|wardrobe malfunction|see-through|wet shirt|shirt lift|skirt lift|tentacle|futanari|futa|yuri|yaoi|rating:questionable|rating:explicit|impregnation|milking|breeding|humiliation|exhibitionism|voyeur|peeping|stripper|pole dance|lap dance|orgy|threesome|foursome)\b/i;
const PROMPT_SPICY_MILD = /\b(thigh|thighs|booty|ass\b|breasts|boobs|wide hips|thick thighs|curvy|voluptuous|sensual|seductive|blush|embarrassed|skimpy|revealing|tight clothes|bodysuit|latex|fishnet|stockings|thighhighs|maid bikini|bunny girl|catgirl|fox girl|horny|aroused|sweat|steamy|hot spring|onsen|towel|bath|shower|bedroom|pin-up|pinup|cleavage cutout|navel|belly|plump|chubby|obese|weight gain|hyper|expansion|growth|size difference|smother|facesit|foot fetish|feet|toes|armpit)\b/i;

function getPromptSpicyLevel(promptText) {
    if (!promptText) return 0;

    if (PROMPT_SPICY_EXPLICIT.test(promptText)) return 3;
    if (PROMPT_SPICY_STRONG.test(promptText)) return 2;

    const mildHits = promptText.match(new RegExp(PROMPT_SPICY_MILD.source, 'gi'));
    const mildCount = mildHits ? mildHits.length : 0;
    if (mildCount >= 3) return 2;
    if (mildCount >= 1) return 1;

    return 0;
}

function getEffectiveQuipSpicyLevel(promptText) {
    const nsfwLevel = getNsfwLevel();
    const promptLevel = getPromptSpicyLevel(promptText);
    return Math.max(nsfwLevel, promptLevel);
}

function getQuipCategoryWeights(spicyLevel) {
    const level = typeof spicyLevel === 'number' ? spicyLevel : getNsfwLevel();

    const weights = {
        technical: 1,
        funny: 1,
        rude: 1,
        anime: 1,
        spicy: 0.35,
        unhinged: 0
    };

    switch (level) {
        case 3:
            weights.unhinged = 5.5;
            weights.spicy = 3.5;
            weights.rude = 1.8;
            weights.anime = 1.4;
            weights.funny = 0.75;
            weights.technical = 0.5;
            break;
        case 2:
            weights.unhinged = 3.5;
            weights.spicy = 3;
            weights.anime = 1.3;
            weights.rude = 1.35;
            weights.funny = 0.85;
            weights.technical = 0.65;
            break;
        case 1:
            weights.unhinged = 1.8;
            weights.spicy = 2.4;
            weights.anime = 1.1;
            weights.funny = 0.95;
            weights.technical = 0.8;
            break;
        case 0:
            weights.spicy = 0.5;
            break;
        case -1:
            weights.spicy = 0.12;
            weights.technical = 1.6;
            weights.funny = 1.3;
            weights.rude = 0.7;
            break;
        case -2:
            weights.spicy = 0.05;
            weights.technical = 2;
            weights.funny = 1.5;
            weights.rude = 0.5;
            weights.anime = 0.6;
            break;
        default:
            break;
    }

    return weights;
}

function pickGenerationQuip() {
    const promptText = collectPromptTextForQuips();
    const dynamicMatches = matchDynamicQuipPhrases(promptText);

    const hasDynamicMatches = dynamicMatches.length > 0;
    const mix = getDirectedQuipMixFactors(dynamicMatches.length);

    if (hasDynamicMatches && mix.dynamicPriorityRatio > 0 && Math.random() < mix.dynamicPriorityRatio) {
        const pick = dynamicMatches[Math.floor(Math.random() * dynamicMatches.length)];
        return pick.text;
    }

    const level = getEffectiveQuipSpicyLevel(promptText);
    const weights = getQuipCategoryWeights(level);
    const staticFactor = hasDynamicMatches ? mix.staticWeightFactor : 1;
    const candidates = [];

    // Matched workspace/global quips always eligible — never gated by NSFW slider or term category
    for (const match of dynamicMatches) {
        const scaledWeight = match.weight * mix.dynamicWeightScale;
        if (scaledWeight <= 0) continue;
        candidates.push({
            type: 'dynamic',
            text: match.text,
            weight: scaledWeight
        });
    }

    for (let i = 0; i < GENERATION_QUIPS.length; i++) {
        if (quipsShownIndices.includes(i)) continue;
        const category = quipCategoryByIndex[i];
        if (category === 'unhinged' && level <= 0) continue;

        const weight = weights[category];
        if (!weight || weight <= 0) continue;

        candidates.push({
            type: 'static',
            index: i,
            text: GENERATION_QUIPS[i],
            weight: weight * staticFactor
        });
    }

    if (candidates.length === 0) {
        if (dynamicMatches.length > 0) {
            const pick = dynamicMatches[Math.floor(Math.random() * dynamicMatches.length)];
            return pick.text;
        }
        quipsShownIndices = [];
        return pickGenerationQuip();
    }

    const totalWeight = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
    let roll = Math.random() * totalWeight;
    let picked = candidates[candidates.length - 1];

    for (const candidate of candidates) {
        roll -= candidate.weight;
        if (roll <= 0) {
            picked = candidate;
            break;
        }
    }

    if (picked.type === 'static' && picked.index !== undefined) {
        quipsShownIndices.push(picked.index);
    }

    return picked.text;
}

function clearGenerationQuipTimers() {
    if (quipCycleTimeout) {
        clearTimeout(quipCycleTimeout);
        quipCycleTimeout = null;
    }
    if (quipFadeTimeout) {
        clearTimeout(quipFadeTimeout);
        quipFadeTimeout = null;
    }
}

function scheduleNextGenerationQuip() {
    if (quipRotationLocked) return;

    quipCycleTimeout = setTimeout(() => {
        showNextGenerationQuip();
    }, QUIP_FADE_MS);
}

function showNextGenerationQuip() {
    const quipEl = document.getElementById('generationPreviewQuip');
    const textEl = quipEl?.querySelector('.generation-preview-quip-text');
    if (!quipEl || !textEl || quipEl.classList.contains('hidden')) return;
    if (quipRotationLocked) return;

    quipEl.classList.remove('visible');
    textEl.textContent = pickGenerationQuip();

    requestAnimationFrame(() => {
        if (!quipEl.classList.contains('hidden') && !quipRotationLocked) {
            quipEl.classList.add('visible');
        }
    });

    quipFadeTimeout = setTimeout(() => {
        if (quipRotationLocked) return;
        quipEl.classList.remove('visible');
        scheduleNextGenerationQuip();
    }, QUIP_VISIBLE_MS);
}

function lockGenerationQuips() {
    if (quipRotationLocked) return;
    quipRotationLocked = true;
    clearGenerationQuipTimers();

    const quipEl = document.getElementById('generationPreviewQuip');
    if (quipEl && !quipEl.classList.contains('hidden')) {
        quipEl.classList.add('visible');
    }
}

function lockGenerationQuipsForStreaming() {
    lockGenerationQuips();
}

function startGenerationQuips() {
    const quipEl = document.getElementById('generationPreviewQuip');
    if (!quipEl) return;

    stopGenerationQuips();
    quipRotationLocked = false;
    quipsShownIndices = [];
    quipEl.classList.remove('hidden');
    showNextGenerationQuip();
}

/** Resume quip cycling when Enshutsuka overlay opens but preview animation did not start quips yet. */
function ensureGenerationQuipsCycling() {
    const manualForm = document.getElementById('manualForm');
    if (!manualForm || !manualForm.classList.contains('generating')) return;

    const quipEl = document.getElementById('generationPreviewQuip');
    if (!quipEl || quipRotationLocked) return;

    if (quipEl.classList.contains('hidden')) {
        startGenerationQuips();
        return;
    }

    if (!quipCycleTimeout && !quipFadeTimeout) {
        showNextGenerationQuip();
    }
}

function stopGenerationQuips() {
    clearGenerationQuipTimers();
    quipRotationLocked = false;

    const quipEl = document.getElementById('generationPreviewQuip');
    if (!quipEl) return;

    quipEl.classList.remove('visible');
    quipEl.classList.add('hidden');

    const textEl = quipEl.querySelector('.generation-preview-quip-text');
    if (textEl) {
        textEl.textContent = '';
    }
}
