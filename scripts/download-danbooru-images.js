/**
 * Download Danbooru and e621 Images from wiki_post_thumb_refs.json
 * 
 * This script:
 * 1. Reads wiki_post_thumb_refs.json
 * 2. Filters for source=1 (Danbooru) and source=2 (e621) references
 * 3. Fetches post data from Danbooru or e621 API
 * 4. Downloads images to .cache/wiki_files/{type}{id}.jpg (resized to max 1024x1024, converted to JPEG)
 * 5. For webm videos, extracts a frame and converts to JPG
 * 
 * Features:
 * - Rate limiting (250ms between requests)
 * - Image processing with sharp (resize to max 1024x1024, convert to JPEG)
 * - Webm video support (extracts frame using ffmpeg, converts to JPG)
 * - Skips already downloaded files
 * - Progress logging
 * - Error handling and retry logic
 * - Supports both Danbooru and e621 APIs
 * 
 * Requirements:
 * - ffmpeg must be installed for webm conversion (check with: ffmpeg -version)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const sharp = require('sharp');
const { exec } = require('child_process');
const { promisify } = require('util');
const config = require('../config');

const execAsync = promisify(exec);

// Configuration
const REFS_FILE_PATH = path.join(__dirname, '..', 'data', 'wiki_post_thumb_refs.json');
const OUTPUT_DIR = path.join(__dirname, '..', '.cache', 'wiki_files');
const DANBOORU_API_BASE = 'https://danbooru.donmai.us';
const E621_API_BASE = 'https://e621.net';
const SOURCE_DANBOORU = 1;
const SOURCE_E621 = 2;

// Rate limiting: wait 1 second between requests
const RATE_LIMIT_DELAY = 250;
// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;
// Consecutive failure limit
const MAX_CONSECUTIVE_FAILURES = 10;

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch JSON data from URL using native https/http
 */
function fetchJson(url, retries = 0, userAgent = null) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const client = urlObj.protocol === 'https:' ? https : http;
        
        // e621 requires a specific User-Agent format
        const defaultUserAgent = userAgent || config.userAgent || 'StaticForge/1.0 (https://staticforge.app)';
        
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'User-Agent': defaultUserAgent,
                'Accept': 'application/json'
            },
            timeout: 30000
        };

        const req = client.get(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    if (res.statusCode === 404) {
                        resolve(null); // Post doesn't exist
                        return;
                    }
                    if (res.statusCode === 429 && retries < MAX_RETRIES) {
                        // Rate limited, retry
                        setTimeout(() => {
                            fetchJson(url, retries + 1).then(resolve).catch(reject);
                        }, RETRY_DELAY * (retries + 1));
                        return;
                    }
                    if (res.statusCode !== 200) {
                        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                        return;
                    }
                    resolve(JSON.parse(data));
                } catch (error) {
                    reject(new Error(`Failed to parse JSON: ${error.message}`));
                }
            });
        });

        req.on('error', (error) => {
            if (retries < MAX_RETRIES) {
                setTimeout(() => {
                    fetchJson(url, retries + 1).then(resolve).catch(reject);
                }, RETRY_DELAY * (retries + 1));
            } else {
                reject(error);
            }
        });

        req.on('timeout', () => {
            req.destroy();
            if (retries < MAX_RETRIES) {
                setTimeout(() => {
                    fetchJson(url, retries + 1).then(resolve).catch(reject);
                }, RETRY_DELAY * (retries + 1));
            } else {
                reject(new Error('Request timeout'));
            }
        });
    });
}

/**
 * Fetch post data from Danbooru API
 */
async function fetchPostData(postId, retries = 0) {
    const url = `${DANBOORU_API_BASE}/posts/${postId}.json`;
    return fetchJson(url, retries);
}

/**
 * Fetch post data from e621 API
 */
async function fetchPostDataE621(postId, retries = 0) {
    const url = `${E621_API_BASE}/posts/${postId}.json`;
    // e621 requires a User-Agent with contact info
    return fetchJson(url, retries);
}

/**
 * Check if ffmpeg is available
 */
async function checkFfmpegAvailable() {
    try {
        await execAsync('ffmpeg -version');
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Extract a frame from a webm video file and convert to JPG using ffmpeg
 */
async function convertWebmToJpg(webmPath, outputPath) {
    // Check if ffmpeg is available
    const ffmpegAvailable = await checkFfmpegAvailable();
    if (!ffmpegAvailable) {
        throw new Error('ffmpeg is not installed or not available in PATH. Please install ffmpeg to convert webm files.');
    }
    
    try {
        // Use ffmpeg to extract a frame at 1 second (or first frame if video is shorter)
        // Output as JPG, then we'll resize it with sharp
        const tempJpgPath = outputPath + '.temp.jpg';
        const ffmpegCommand = `ffmpeg -i "${webmPath}" -ss 00:00:01 -vframes 1 -q:v 2 "${tempJpgPath}" -y`;
        
        try {
            await execAsync(ffmpegCommand);
        } catch (error) {
            // If frame extraction at 1 second failed, try extracting the first frame
            const ffmpegCommandFirstFrame = `ffmpeg -i "${webmPath}" -vframes 1 -q:v 2 "${tempJpgPath}" -y`;
            await execAsync(ffmpegCommandFirstFrame);
        }
        
        // Check if the temp file was created
        if (!fs.existsSync(tempJpgPath)) {
            throw new Error('Failed to extract frame from webm');
        }
        
        // Process the extracted frame with sharp: resize to max 1024x1024, convert to JPEG
        const frameBuffer = fs.readFileSync(tempJpgPath);
        const processedBuffer = await sharp(frameBuffer)
            .resize(1024, 1024, {
                fit: 'inside',
                withoutEnlargement: true
            })
            .jpeg({ quality: 85 })
            .toBuffer();
        
        // Write to temporary file first, then rename atomically
        const tempPath = outputPath + '.tmp';
        fs.writeFileSync(tempPath, processedBuffer);
        
        // Clean up temp files
        try {
            fs.unlinkSync(tempJpgPath);
        } catch (cleanupError) {
            // Ignore cleanup errors
        }
        
        fs.renameSync(tempPath, outputPath);
        return true;
    } catch (error) {
        // Clean up temp files on error
        const tempJpgPath = outputPath + '.temp.jpg';
        if (fs.existsSync(tempJpgPath)) {
            try {
                fs.unlinkSync(tempJpgPath);
            } catch (cleanupError) {
                // Ignore cleanup errors
            }
        }
        throw error;
    }
}

/**
 * Download webm video from URL, extract a frame, and convert to JPG
 */
function downloadWebmAndConvert(imageUrl, outputPath, retries = 0) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(imageUrl);
        const client = urlObj.protocol === 'https:' ? https : http;
        
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'User-Agent': config.userAgent || 'StaticForge/1.0 (https://staticforge.app)'
            },
            timeout: 120000 // 120 second timeout for videos
        };

        const req = client.get(options, async (res) => {
            // Handle redirects
            if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
                const redirectUrl = res.headers.location;
                if (redirectUrl) {
                    req.destroy();
                    const absoluteUrl = redirectUrl.startsWith('http') ? redirectUrl : `${urlObj.protocol}//${urlObj.host}${redirectUrl}`;
                    downloadWebmAndConvert(absoluteUrl, outputPath, retries).then(resolve).catch(reject);
                    return;
                }
            }

            if (res.statusCode === 429 && retries < MAX_RETRIES) {
                req.destroy();
                setTimeout(() => {
                    downloadWebmAndConvert(imageUrl, outputPath, retries + 1).then(resolve).catch(reject);
                }, RETRY_DELAY * (retries + 1));
                return;
            }

            if (res.statusCode !== 200) {
                req.destroy();
                if (retries < MAX_RETRIES) {
                    setTimeout(() => {
                        downloadWebmAndConvert(imageUrl, outputPath, retries + 1).then(resolve).catch(reject);
                    }, RETRY_DELAY * (retries + 1));
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                }
                return;
            }

            const chunks = [];
            res.on('data', (chunk) => {
                chunks.push(chunk);
            });

            res.on('end', async () => {
                try {
                    const buffer = Buffer.concat(chunks);
                    
                    // Save webm to temporary file
                    const tempWebmPath = outputPath + '.temp.webm';
                    fs.writeFileSync(tempWebmPath, buffer);
                    
                    // Convert webm to JPG
                    await convertWebmToJpg(tempWebmPath, outputPath);
                    
                    // Clean up temp webm file
                    try {
                        fs.unlinkSync(tempWebmPath);
                    } catch (cleanupError) {
                        // Ignore cleanup errors
                    }
                    
                    resolve(true);
                } catch (error) {
                    // Clean up temp files on error
                    const tempWebmPath = outputPath + '.temp.webm';
                    if (fs.existsSync(tempWebmPath)) {
                        try {
                            fs.unlinkSync(tempWebmPath);
                        } catch (cleanupError) {
                            // Ignore cleanup errors
                        }
                    }
                    reject(error);
                }
            });
        });

        req.on('error', (error) => {
            if (retries < MAX_RETRIES) {
                setTimeout(() => {
                    downloadWebmAndConvert(imageUrl, outputPath, retries + 1).then(resolve).catch(reject);
                }, RETRY_DELAY * (retries + 1));
            } else {
                reject(error);
            }
        });

        req.on('timeout', () => {
            req.destroy();
            if (retries < MAX_RETRIES) {
                setTimeout(() => {
                    downloadWebmAndConvert(imageUrl, outputPath, retries + 1).then(resolve).catch(reject);
                }, RETRY_DELAY * (retries + 1));
            } else {
                reject(new Error('Request timeout'));
            }
        });
    });
}

/**
 * Download image from URL, resize to max 1024x1024, and convert to JPEG
 */
function downloadImage(imageUrl, outputPath, retries = 0) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(imageUrl);
        const client = urlObj.protocol === 'https:' ? https : http;
        
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'User-Agent': config.userAgent || 'StaticForge/1.0 (https://staticforge.app)'
            },
            timeout: 60000 // 60 second timeout for images
        };

        const req = client.get(options, async (res) => {
            // Handle redirects
            if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
                const redirectUrl = res.headers.location;
                if (redirectUrl) {
                    req.destroy();
                    const absoluteUrl = redirectUrl.startsWith('http') ? redirectUrl : `${urlObj.protocol}//${urlObj.host}${redirectUrl}`;
                    downloadImage(absoluteUrl, outputPath, retries).then(resolve).catch(reject);
                    return;
                }
            }

            if (res.statusCode === 429 && retries < MAX_RETRIES) {
                req.destroy();
                setTimeout(() => {
                    downloadImage(imageUrl, outputPath, retries + 1).then(resolve).catch(reject);
                }, RETRY_DELAY * (retries + 1));
                return;
            }

            if (res.statusCode !== 200) {
                req.destroy();
                if (retries < MAX_RETRIES) {
                    setTimeout(() => {
                        downloadImage(imageUrl, outputPath, retries + 1).then(resolve).catch(reject);
                    }, RETRY_DELAY * (retries + 1));
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                }
                return;
            }

            const chunks = [];
            res.on('data', (chunk) => {
                chunks.push(chunk);
            });

            res.on('end', async () => {
                try {
                    const buffer = Buffer.concat(chunks);
                    
                    // Process image with sharp: resize to max 1024x1024 (longest edge), convert to JPEG
                    const processedBuffer = await sharp(buffer)
                        .resize(1024, 1024, {
                            fit: 'inside',
                            withoutEnlargement: true
                        })
                        .jpeg({ quality: 85 })
                        .toBuffer();
                    
                    // Write to temporary file first, then rename atomically
                    const tempPath = outputPath + '.tmp';
                    fs.writeFileSync(tempPath, processedBuffer);
                    fs.renameSync(tempPath, outputPath);
                    resolve(true);
                } catch (error) {
                    // Clean up temp file if rename failed
                    const tempPath = outputPath + '.tmp';
                    if (fs.existsSync(tempPath)) {
                        try {
                            fs.unlinkSync(tempPath);
                        } catch (cleanupError) {
                            // Ignore cleanup errors
                        }
                    }
                    reject(error);
                }
            });
        });

        req.on('error', (error) => {
            if (retries < MAX_RETRIES) {
                setTimeout(() => {
                    downloadImage(imageUrl, outputPath, retries + 1).then(resolve).catch(reject);
                }, RETRY_DELAY * (retries + 1));
            } else {
                reject(error);
            }
        });

        req.on('timeout', () => {
            req.destroy();
            if (retries < MAX_RETRIES) {
                setTimeout(() => {
                    downloadImage(imageUrl, outputPath, retries + 1).then(resolve).catch(reject);
                }, RETRY_DELAY * (retries + 1));
            } else {
                reject(new Error('Request timeout'));
            }
        });
    });
}


/**
 * Main function
 */
async function main() {
    console.log('📥 Starting image download script (Danbooru + e621)...\n');

    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        console.log(`✅ Created output directory: ${OUTPUT_DIR}\n`);
    }

    // Clean up any leftover temporary files from previous interrupted runs
    try {
        const files = fs.readdirSync(OUTPUT_DIR);
        let cleanedTempFiles = 0;
        for (const file of files) {
            if (file.endsWith('.tmp') || file.endsWith('.temp.webm') || file.endsWith('.temp.jpg')) {
                const tempPath = path.join(OUTPUT_DIR, file);
                try {
                    fs.unlinkSync(tempPath);
                    cleanedTempFiles++;
                } catch (error) {
                    // Ignore cleanup errors
                }
            }
        }
        if (cleanedTempFiles > 0) {
            console.log(`🧹 Cleaned up ${cleanedTempFiles} leftover temporary files\n`);
        }
    } catch (error) {
        // Ignore cleanup errors
    }

    // Read references file
    console.log(`📖 Reading references file: ${REFS_FILE_PATH}`);
    const refsData = JSON.parse(fs.readFileSync(REFS_FILE_PATH, 'utf8'));
    
    // Filter for Danbooru (source=1) and e621 (source=2) references
    const allRefs = refsData.references.filter(ref => ref.source === SOURCE_DANBOORU || ref.source === SOURCE_E621);
    const danbooruRefs = allRefs.filter(ref => ref.source === SOURCE_DANBOORU);
    const e621Refs = allRefs.filter(ref => ref.source === SOURCE_E621);
    console.log(`📊 Found ${allRefs.length} total references (Danbooru: ${danbooruRefs.length}, e621: ${e621Refs.length})`);

    // Pre-check how many files already exist
    let alreadyDownloaded = 0;
    for (const ref of allRefs) {
        const refType = ref.type || 'unknown';
        const outputPath = path.join(OUTPUT_DIR, `${refType}${ref.id}.jpg`);
        if (fs.existsSync(outputPath)) {
            alreadyDownloaded++;
        }
    }
    
    if (alreadyDownloaded > 0) {
        console.log(`⏭️  ${alreadyDownloaded} files already downloaded (will be skipped)\n`);
    } else {
        console.log('');
    }

    let downloaded = 0;
    let skipped = 0;
    let errors = 0;
    let consecutiveFailures = 0;
    const errorLog = [];

    // Process each reference
    for (let i = 0; i < allRefs.length; i++) {
        const ref = allRefs[i];
        const postId = ref.id;
        const refType = ref.type || 'unknown';
        const source = ref.source;
        const isE621 = source === SOURCE_E621;
        
        // Check if file already exists (filename format: {type}{id}.jpg)
        const outputPath = path.join(OUTPUT_DIR, `${refType}${postId}.jpg`);
        
        if (fs.existsSync(outputPath)) {
            skipped++;
            consecutiveFailures = 0; // Reset on successful skip
            // Only log progress every 1000 skips to avoid spam
            if (skipped % 1000 === 0) {
                console.log(`⏭️  Skipped ${skipped} already downloaded files...`);
            }
            if ((i + 1) % 100 === 0) {
                console.log(`⏳ Progress: ${i + 1}/${allRefs.length} (Downloaded: ${downloaded}, Skipped: ${skipped}, Errors: ${errors})`);
            }
            continue;
        }

        try {
            // Fetch post data from appropriate API
            let postData;
            if (isE621) {
                postData = await fetchPostDataE621(postId);
            } else {
                postData = await fetchPostData(postId);
            }
            
            if (!postData) {
                console.log(`⚠️  Post ${postId} not found (404) [${isE621 ? 'e621' : 'Danbooru'}]`);
                errors++;
                consecutiveFailures++;
                errorLog.push({ id: postId, type: refType, source: isE621 ? 'e621' : 'danbooru', error: 'Post not found' });
                
                if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                    console.error(`\n❌ ${MAX_CONSECUTIVE_FAILURES} consecutive failures reached. Exiting script.`);
                    break;
                }
                
                await sleep(RATE_LIMIT_DELAY);
                continue;
            }

            // Get image URL - e621 and Danbooru have different response structures
            const supportedImageFormats = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'tiff', 'tif', 'svg'];
            const supportedVideoFormats = ['webm', 'mp4', 'mov', 'avi'];
            let imageUrl;
            let fileExt;
            let isVideo = false;

            if (isE621) {
                // e621 API structure: post.file.url, post.file.ext, post.preview.url
                // Response can be wrapped in { post: {...} } or be the post object directly
                const e621Post = postData.post || postData;
                
                // Handle cases where file or preview might be null
                const file = e621Post.file || {};
                const preview = e621Post.preview || {};
                const sample = e621Post.sample || {}; // e621 also has sample URLs
                
                fileExt = file.ext;
                
                // Check if it's a video format (webm, etc.)
                if (fileExt && supportedVideoFormats.includes(fileExt.toLowerCase())) {
                    isVideo = true;
                    // For videos, use the actual file URL (we'll extract a frame from it)
                    imageUrl = file.url;
                    if (!imageUrl) {
                        // Fallback to preview if file URL is not available
                        imageUrl = preview.url || sample.url;
                        isVideo = false; // Use preview instead
                    }
                } else if (fileExt && supportedImageFormats.includes(fileExt.toLowerCase())) {
                    // If the file is an image format that Sharp can handle, prefer file.url
                    imageUrl = file.url || sample.url || preview.url;
                } else {
                    // For other unsupported formats, use preview or sample image
                    imageUrl = preview.url || sample.url || file.url;
                    if (fileExt) {
                        console.log(`📹 Using preview for ${fileExt.toUpperCase()} file (post ${postId} on e621)`);
                    }
                }
            } else {
                // Danbooru API structure: file_url, large_file_url, preview_file_url, file_ext
                fileExt = postData.file_ext;
                
                // Check if it's a video format (webm, etc.)
                if (fileExt && supportedVideoFormats.includes(fileExt.toLowerCase())) {
                    isVideo = true;
                    // For videos, use the actual file URL (we'll extract a frame from it)
                    imageUrl = postData.file_url || postData.large_file_url;
                    if (!imageUrl) {
                        // Fallback to preview if file URL is not available
                        imageUrl = postData.preview_file_url;
                        isVideo = false; // Use preview instead
                    }
                } else if (fileExt && supportedImageFormats.includes(fileExt.toLowerCase())) {
                    // If the file is an image format that Sharp can handle, use file_url or large_file_url
                    imageUrl = postData.file_url || postData.large_file_url || postData.preview_file_url;
                } else {
                    // For other unsupported formats, use preview image
                    imageUrl = postData.preview_file_url || postData.large_file_url || postData.file_url;
                    if (fileExt) {
                        console.log(`📹 Using preview for ${fileExt.toUpperCase()} file (post ${postId} on Danbooru)`);
                    }
                }
            }
            
            if (!imageUrl) {
                console.log(`⚠️  Post ${postId} has no image URL [${isE621 ? 'e621' : 'Danbooru'}]`);
                errors++;
                consecutiveFailures++;
                errorLog.push({ id: postId, type: refType, source: isE621 ? 'e621' : 'danbooru', error: 'No image URL' });
                
                if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                    console.error(`\n❌ ${MAX_CONSECUTIVE_FAILURES} consecutive failures reached. Exiting script.`);
                    break;
                }
                
                await sleep(RATE_LIMIT_DELAY);
                continue;
            }

            // Ensure URL is absolute
            if (imageUrl.startsWith('//')) {
                imageUrl = 'https:' + imageUrl;
            } else if (imageUrl.startsWith('/')) {
                // Relative URL - prepend appropriate base URL
                const apiBase = isE621 ? E621_API_BASE : DANBOORU_API_BASE;
                imageUrl = apiBase + imageUrl;
            }

            // Download and process image/video (resize to max 1024x1024, convert to JPEG) with retry logic
            let downloadSuccess = false;
            let downloadError = null;

            for (let attempt = 0; attempt < 3 && !downloadSuccess; attempt++) {
                try {
                    if (isVideo && fileExt && fileExt.toLowerCase() === 'webm') {
                        // For webm files, download and extract a frame
                        await downloadWebmAndConvert(imageUrl, outputPath);
                        console.log(`🎬 Converted webm to JPG for post ${postId} [${isE621 ? 'e621' : 'Danbooru'}]`);
                    } else {
                        // For regular images, use the standard download function
                        await downloadImage(imageUrl, outputPath);
                    }
                    downloadSuccess = true;
                } catch (error) {
                    downloadError = error;
                    if (attempt < 2) { // Don't log on the last attempt since we'll handle it in the main catch
                        console.log(`⚠️  Download attempt ${attempt + 1} failed for post ${postId}: ${error.message}`);
                        // Rate limiting between retry attempts
                        await sleep(RATE_LIMIT_DELAY);
                    }
                }
            }

            if (!downloadSuccess) {
                throw downloadError; // Re-throw the last error to be caught by the main catch block
            }

            downloaded++;
            consecutiveFailures = 0; // Reset on successful download

            // Progress update every 10 downloads
            if (downloaded % 10 === 0 || (i + 1) % 100 === 0) {
                console.log(`✅ Progress: ${i + 1}/${allRefs.length} (Downloaded: ${downloaded}, Skipped: ${skipped}, Errors: ${errors})`);
            }

            // Rate limiting
            await sleep(RATE_LIMIT_DELAY);

        } catch (error) {
            console.error(`❌ Error processing post ${postId} [${isE621 ? 'e621' : 'Danbooru'}]: ${error.message}`);
            errors++;
            consecutiveFailures++;
            errorLog.push({ id: postId, type: refType, source: isE621 ? 'e621' : 'danbooru', error: error.message });
            
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                console.error(`\n❌ ${MAX_CONSECUTIVE_FAILURES} consecutive failures reached. Exiting script.`);
                break;
            }
            
            await sleep(RATE_LIMIT_DELAY);
        }
    }

    // Summary
    console.log('\n📊 Download Summary:');
    console.log(`   Total references: ${allRefs.length} (Danbooru: ${danbooruRefs.length}, e621: ${e621Refs.length})`);
    console.log(`   ✅ Downloaded: ${downloaded}`);
    console.log(`   ⏭️  Skipped (already exists): ${skipped}`);
    console.log(`   ❌ Errors: ${errors}`);

    if (errorLog.length > 0) {
        const errorLogPath = path.join(__dirname, '..', '.cache', 'download-errors.json');
        fs.writeFileSync(errorLogPath, JSON.stringify(errorLog, null, 2));
        console.log(`\n📝 Error log saved to: ${errorLogPath}`);
    }

    console.log('\n✨ Done!');
}

// Run the script
main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});

