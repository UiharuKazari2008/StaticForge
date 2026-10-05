// JULES: mem-leak 4
const sharp = require('sharp');
sharp.cache({ memory: 32, files: 0, items: 50 });
sharp.concurrency(1);
module.exports = true;
