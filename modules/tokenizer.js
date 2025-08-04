// tokenizers.js
// CommonJS version with automatic downloading and instantiation of T5 and NerdStashV2 tokenizers
const pako = require('pako');
const { TextDecoder } = require('util');

const headers = {
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0',
  'Referer': 'https://novelai.net/',
  'Origin': 'https://novelai.net',
  'Dnt': '1',
  'Sec-Ch-Ua': '"Microsoft Edge";v="138", "Chromium";v="138", "Not=A?Brand";v="99"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"macOS"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Gpc': '1',
  'Pragma': 'no-cache',
  'Cache-Control': 'no-cache',
}

// ---------- Normalizer & PreTokenizer & Decoder for T5 ----------
class NormalizerFactory {
  static fromConfig(config) {
    switch (config.type) {
      case 'Metaspace':
        return new MetaspaceNormalizer(
          config.add_prefix_space,
          config.replacement,
          config.str_rep || config.replacement
        );
      case 'Precompiled':
        return new PrecompiledNormalizer(config.precompiled_charsmap);
      case 'Sequence':
        return new SequenceNormalizer(
          config.pretokenizers.map(cfg => NormalizerFactory.fromConfig(cfg))
        );
      case 'WhitespaceSplit':
        return new WhitespaceSplitNormalizer();
      default:
        throw new Error(`Unknown processor type: ${config.type}`);
    }
  }
}
class MetaspaceNormalizer {
  constructor(addPrefix, replacement, strRep) {
    this.addPrefix = addPrefix;
    this.replacement = replacement;
    this.strRep = strRep;
  }
  preTokenize(inputs) {
    return inputs.map(s => {
      let t = s.replace(/ /g, this.replacement);
      if (this.addPrefix && !t.startsWith(this.replacement)) t = this.replacement + t;
      return t;
    });
  }
  decodeChain(tokens) {
    return tokens.map((tk, i) => {
      let t = tk.replace(new RegExp(this.replacement, 'g'), ' ');
      if (this.addPrefix && i === 0 && t.startsWith(' ')) t = t.slice(1);
      return t;
    });
  }
}
class PrecompiledNormalizer {
  constructor(charMap) { this.charMap = charMap; }
  normalize(s) { return s.replace(/./g, c => this.charMap[c] || c); }
}
class SequenceNormalizer {
  constructor(tokenizers) { this.tokenizers = tokenizers; }
  preTokenize(inputs) {
    let seq = inputs;
    this.tokenizers.forEach(tok => seq = tok.preTokenize(seq));
    return seq;
  }
  normalize(s) { return s; }
  decodeChain(toks) { return toks; }
}
class WhitespaceSplitNormalizer {
  preTokenize(inputs) { return inputs.flatMap(s => s.split(/\s+/)); }
  normalize(s) { return s; }
  decodeChain(toks) { return toks; }
}

// ---------- Trie for T5 vocabulary ----------
class TrieNode { constructor() { this.children = new Map(); this.isLeaf = false; }}
class Trie {
  constructor() { this.root = new TrieNode(); }
  push(token) {
    let node = this.root;
    for (let ch of token) {
      if (!node.children.has(ch)) node.children.set(ch, new TrieNode());
      node = node.children.get(ch);
    }
    node.isLeaf = true;
  }
  *commonPrefixSearch(text) {
    let node = this.root, prefix = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (!node.children.has(ch)) break;
      node = node.children.get(ch);
      prefix += ch;
      if (node.isLeaf) yield prefix;
    }
  }
}

// ---------- Viterbi Lattice for T5 ----------
class LatticeNode {
  constructor(tokenId, pos, length, score) {
    this.tokenId = tokenId;
    this.pos = pos;
    this.length = length;
    this.score = score;
    this.prev = null;
    this.backtraceScore = 0;
  }
  clone() {
    const c = new LatticeNode(this.tokenId, this.pos, this.length, this.score);
    c.prev = this.prev;
    c.backtraceScore = this.backtraceScore;
    return c;
  }
}
class Lattice {
  constructor(sentence, bosId, eosId) {
    this.sentence = sentence;
    this.len = sentence.length;
    this.bosTokenId = bosId;
    this.eosTokenId = eosId;
    this.beginNodes = Array.from({ length: this.len + 1 }, () => []);
    this.endNodes   = Array.from({ length: this.len + 1 }, () => []);
    // BOS/EOS
    const bos = new LatticeNode(bosId, 0, 0, 0);
    const eos = new LatticeNode(eosId, this.len, 0, 0);
    this.beginNodes[0].push(bos);
    this.endNodes[this.len].push(eos);
    this.nodes = [bos, eos];
  }
  insert(pos, length, score, tokenId) {
    const node = new LatticeNode(tokenId, pos, length, score);
    this.nodes.push(node);
    this.beginNodes[pos].push(node);
    this.endNodes[pos+length].push(node);
  }
  viterbi() {
    for (let t = 1; t <= this.len; t++) {
      for (const node of this.beginNodes[t]) {
        let best = null, bestScore = -Infinity;
        for (const prev of this.endNodes[t - node.length]) {
          const score = prev.backtraceScore + node.score;
          if (score > bestScore) (best = prev, bestScore = score);
        }
        if (!best) continue;
        node.prev = best.clone();
        node.backtraceScore = bestScore;
      }
    }
    // backtrack from EOS
    let path = [];
    let node = this.nodes[1].prev;
    while (node && node.prev) {
      path.push(node);
      node = node.prev;
    }
    return path.reverse();
  }
  tokenIds() { return this.viterbi().map(n => n.tokenId); }
}

// ---------- T5Tokenizer ----------
class T5Tokenizer {
  static fromConfig(cfg) {
    const normalizer = NormalizerFactory.fromConfig(cfg.normalizer);
    const preTokenizer = NormalizerFactory.fromConfig(cfg.pre_tokenizer);
    const decoder = NormalizerFactory.fromConfig(cfg.decoder);
    return new T5Tokenizer(
      cfg.model.vocab,
      cfg.model.unk_id,
      cfg.added_tokens,
      normalizer,
      preTokenizer,
      decoder
    );
  }
  constructor(vocab, unkTokenId, specialTokens, normalizer, preTokenizer, decoder) {
    this.vocab = vocab;
    this.unkTokenId = unkTokenId;
    this.specialTokenMap = new Map(specialTokens.map(t => [t.id, t]));
    this.normalizer = normalizer;
    this.preTokenizer = preTokenizer;
    this.decoder = decoder;
    this.tokenToId = new Map(vocab.map((it,i) => [normalizer.normalize(it[0]), i]));
    this.bosTokenId = this.tokenToId.get(normalizer.normalize(' '));
    this.eosTokenId = this.tokenToId.get('</s>');
    this.trie = new Trie();
    vocab.forEach(it => this.trie.push(normalizer.normalize(it[0])));
    let minScore = Infinity; vocab.forEach(([_,s])=>minScore=Math.min(minScore,s));
    this.unkScore = minScore - 10;
    this.vocab[this.unkTokenId][1] = this.unkScore;
  }
  encode(text) {
    if (!text) return [this.eosTokenId];
    let cleaned = text.replace(/[\[\]{}]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
    cleaned = this.normalizer.normalize(cleaned);
    const pieces = this.preTokenizer.preTokenize([cleaned]);
    const lattice = new Lattice(cleaned, this.bosTokenId, this.eosTokenId);
    for (let pos = 0; pos < cleaned.length; pos++) {
      for (const pref of this.trie.commonPrefixSearch(cleaned.slice(pos))) {
        const id = this.tokenToId.get(pref);
        const score = this.vocab[id][1];
        lattice.insert(pos, pref.length, score, id);
      }
    }
    return [...lattice.tokenIds(), this.eosTokenId];
  }
  decode(ids) {
    const toks = ids.map(id => id===this.unkTokenId
      ? this.vocab[id][0]+' '
      : this.specialTokenMap.has(id)
        ? ''
        : (this.vocab[id] ? this.vocab[id][0] : `[${id}]`)
    );
    return this.decoder.decodeChain(toks).join('');
  }
}

// ---------- BPETokenizer (NerdStashV2) ----------
class BPETokenizer {
  constructor(vocab, merges, specialTokens, config) {
    this.vocab = vocab; this.merges = new Map(merges);
    this.specialTokens = specialTokens; this.config = config;
    this.splitRegex = new RegExp(config.splitRegex, 'gu');
    this.byteToChar = generateByteToChar();
    this.charToByte = invertMap(this.byteToChar);
    this.specialsTree = buildSpecialsTree(specialTokens);
  }
  encode(text) {
    const tokens = [];
    const chunks = this.config.maxEncodeChars && text.length>this.config.maxEncodeChars
      ? splitByLength(text,this.config.maxEncodeChars)
      : [text];
    for (const chunk of chunks) for (const word of this.splitWords(chunk)) {
      if (this.specialTokens[word]!=null) tokens.push(this.specialTokens[word]);
      else tokens.push(...this.toBPE([...word].map(ch=>this.charToByte[ch]??this.byteToChar[ch]).join('')));
    }
    return tokens;
  }
  decode(ids) {
    let text=''; const buf=[];
    for (const id of ids) {
      const tok = Object.keys(this.vocab).find(k=>this.vocab[k]===id);
      if (/^0x/.test(tok)) buf.push(parseInt(tok));
      else { if(buf.length){ text+=new TextDecoder('utf8').decode(new Uint8Array(buf)); buf.length=0;} text+=tok; }
    }
    if(buf.length) text+=new TextDecoder('utf8').decode(new Uint8Array(buf));
    return text;
  }
  // ... include splitWords, toBPE, and helper functions from above
}

// ---------- Downloader & Factory ----------
class NovelAITokenizer {
  constructor(baseURL='https://novelai.net') {
    this.baseURL = baseURL; this.encoders = new Map();
  }
  async init() {
    await Promise.all(['T5','NerdstashV2'].map(k=>this._loadEncoder(k)));
  }
  _defFilename(key) {
    if(key==='T5') return 't5_tokenizer.def';
    if(key==='NerdstashV2') return 'nerdstash_tokenizer_v2.def';
    throw new Error(`Unknown key ${key}`);
  }
  async _loadEncoder(key) {
    const url = `${this.baseURL}/tokenizer/compressed/${this._defFilename(key)}?v=2&static=true`;
    const res = await fetch(url, { headers, method: 'GET' });
    const buf = new Uint8Array(await res.arrayBuffer());
    const json = JSON.parse(new TextDecoder('utf8').decode(pako.inflate(buf)));
    const enc = key==='T5'
      ? T5Tokenizer.fromConfig(json)
      : new BPETokenizer(json.vocab,json.merges,json.specialTokens,json.config||{});
    this.encoders.set(key, enc);
  }
  _get(key) { if(!this.encoders.has(key)) throw new Error('Call init() first'); return this.encoders.get(key); }
  countTokens(key,text){ return this._get(key).encode(text).length; }
  encode(key,text){ return this._get(key).encode(text); }
  decode(key,ids){ return this._get(key).decode(ids); }
  getTokenObjects(key,text){ const enc=this._get(key); return enc.encode(text).map(id=>({id,text:enc.decode([id])})); }
}

// Exports
module.exports = { T5Tokenizer, BPETokenizer, NovelAITokenizer };
