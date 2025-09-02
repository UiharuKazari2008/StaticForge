const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const sharp = require('sharp');
const { NovelAI, Model, Action, Sampler, Noise, Resolution, calculateCost } = require('nekoai-js');
const config = require('./config.json');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const multer = require('multer');
const crypto = require('crypto');
const compression = require('compression');
const helmet = require('helmet');

// Import modules
const { authMiddleware } = require('./modules/auth');
const { loadPromptConfig, setContext } = require('./modules/textReplacements');
const { tagSuggestionsCache } = require('./modules/cache');
const { queueMiddleware, getStatus: getQueueStatus, broadcastQueueStatusImmediate, getDetailedStatus } = require('./modules/queue');
const { WebSocketServer, setGlobalWsServer, getGlobalWsServer } = require('./modules/websocket');
const { WebSocketMessageHandlers } = require('./modules/websocketHandlers');
const { updateMetadata, getBaseName } = require('./modules/pngMetadata');
const { processDynamicImage } = require('./modules/imageTools');
const { initializeWorkspaces, getWorkspaces, getActiveWorkspace, addToWorkspaceArray } = require('./modules/workspace');
const { addReceiptMetadata, addUnattributedReceipt, broadcastReceiptNotification, getImageMetadata } = require('./modules/metadataDatabase');
const imageCounter = require('./modules/imageCounter');
const { generatePreview, generateBlurredPreview, generateMobilePreviews } = require('./modules/previewUtils');
// Example usage in WebSocket handler or main server
const { setContext: setImageGenContext, handleGeneration, buildOptions, handleRerollGeneration } = require('./modules/imageGeneration');
const { setContext: setUpscaleContext } = require('./modules/imageUpscaling');

// Initialize NovelAI client
const client = new NovelAI({ 
    token: config.apiKey,
    timeout: 100000,
    verbose: false
 });


// Account data management
let accountData = { ok: false };
let accountBalance = { fixedTrainingStepsLeft: 0, purchasedTrainingSteps: 0, totalCredits: 0 };
let lastBalanceCheck = 0;
let lastAccountDataCheck = 0;
const BALANCE_REFRESH_INTERVAL = 15 * 60 * 1000; // 15 minutes
const ACCOUNT_DATA_REFRESH_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours

// Cache data management
let globalCacheData = [];
const CACHE_REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutes
let lastCacheCheck = 0;

// Initialize account data on startup
async function initializeAccountData(force = false) {
    try {
        const now = Date.now();
        if (now - lastAccountDataCheck >= ACCOUNT_DATA_REFRESH_INTERVAL || force) {
            console.log('🔄 Initializing account data...');
            const userData = await getUserData();
            if (userData.ok) {
                accountData = userData;
                
                // Extract balance information from user data
                const fixedTrainingStepsLeft = userData?.subscription?.trainingStepsLeft?.fixedTrainingStepsLeft || 0;
                const purchasedTrainingSteps = userData?.subscription?.trainingStepsLeft?.purchasedTrainingSteps || 0;
                const totalCredits = fixedTrainingStepsLeft + purchasedTrainingSteps;
                
                accountBalance = {
                    fixedTrainingStepsLeft,
                    purchasedTrainingSteps,
                    totalCredits
                };
            }

            lastAccountDataCheck = Date.now();
            
            if (accountBalance.totalCredits !== 0) {
                console.log('✅ Account data loaded successfully');
                console.log(`💰 Balance: ${accountBalance.totalCredits} credits (${accountBalance.fixedTrainingStepsLeft} fixed, ${accountBalance.purchasedTrainingSteps} paid)`);
            } else {
                console.error('❌ Failed to load account data');
            }
        }
    } catch (error) {
        console.error('❌ Error initializing account data:', error.message);
    }
}

// Initialize cache data on startup
async function initializeCacheData(force = false) {
    try {
        const now = Date.now();
        if (now - lastCacheCheck >= CACHE_REFRESH_INTERVAL || force) {
            console.log('🔄 Initializing cache data...');
            
            const publicDir = path.join(__dirname, 'public');
            const cacheData = await generateCacheData(publicDir);
            
            globalCacheData = cacheData;
            lastCacheCheck = Date.now();
            
            console.log(`✅ Cache data generated: ${cacheData.length} assets`);
        }
    } catch (error) {
        console.error('❌ Error initializing cache data:', error.message);
    }
}

// Generate cache data for public directory
async function generateCacheData(directory) {
    const assets = [];
    
    try {
        const files = await scanDirectory(directory);
        
        for (const file of files) {
            try {
                const filePath = path.join(directory, file);
                const stats = fs.statSync(filePath);
                
                // Skip directories and non-asset files
                if (stats.isDirectory() || 
                    file.startsWith('.') || 
                    file.includes('node_modules') ||
                    file.includes('.git')) {
                    continue;
                }
                
                // Calculate MD5 hash
                const fileBuffer = fs.readFileSync(filePath);
                const hash = crypto.createHash('md5').update(fileBuffer).digest('hex');
                
                // Convert to web path (remove /public prefix for clean URLs)
                const relativePath = path.relative(__dirname, filePath).replace(/\\/g, '/');
                const webPath = relativePath.startsWith('public/') 
                    ? '/' + relativePath.substring(7) // Remove 'public/' prefix
                    : '/' + relativePath;
                
                assets.push({
                    path: webPath,
                    md5: hash,
                    size: stats.size,
                    modified: stats.mtime.getTime()
                });
            } catch (error) {
                console.warn(`⚠️ Error processing file ${file}:`, error.message);
            }
        }
        
        // Sort by path for consistent ordering
        assets.sort((a, b) => a.path.localeCompare(b.path));
        
        return assets;
    } catch (error) {
        console.error('❌ Error scanning directory:', error.message);
        return [];
    }
}

// Recursively scan directory for files
async function scanDirectory(dir) {
    const files = [];
    
    try {
        const items = fs.readdirSync(dir);
        
        for (const item of items) {
            const itemPath = path.join(dir, item);
            const stats = fs.statSync(itemPath);
            
            if (stats.isDirectory()) {
                // Recursively scan subdirectories
                const subFiles = await scanDirectory(itemPath);
                files.push(...subFiles.map(subFile => path.join(item, subFile)));
            } else {
                files.push(item);
            }
        }
    } catch (error) {
        console.error(`❌ Error reading directory ${dir}:`, error.message);
    }
    
    return files;
}

// Refresh account data periodically
async function refreshBalance(force = false) {
    try {
        const now = Date.now();
        if (now - lastBalanceCheck >= (BALANCE_REFRESH_INTERVAL / 2) || force) {
            // Check if there are active WebSocket clients connected
            const wsServer = getGlobalWsServer();
            if (wsServer && wsServer.getConnectionCount() === 0) {
                console.log('⏭️ Skipping balance update - no active WebSocket clients connected');
                return;
            }
            
            console.log('🔄 Refreshing account balance...');
            const newBalanceData = await getBalance();
            
            if (newBalanceData && newBalanceData.ok) {
                // Check for deposits (balance increase)
                const oldTotalBalance = accountBalance.totalCredits;
                const newTotalBalance = newBalanceData.totalCredits;
                
                if (newTotalBalance > oldTotalBalance) {
                    const depositAmount = newTotalBalance - oldTotalBalance;
                    console.log(`💰 Deposit detected: +${depositAmount} credits`);
                    
                    // Determine which type of credits were deposited
                    const oldFixed = accountBalance.fixedTrainingStepsLeft;
                    const newFixed = newBalanceData.fixedTrainingStepsLeft;
                    const oldPurchased = accountBalance.purchasedTrainingSteps;
                    const newPurchased = newBalanceData.purchasedTrainingSteps;
                    
                    if (newPurchased > oldPurchased) {
                        // Add deposit receipt
                        addUnattributedReceipt({
                            type: 'deposit',
                            cost: newPurchased - oldPurchased,
                            creditType: 'paid',
                            date: now.valueOf()
                        });
                    }
                    if (newFixed > oldFixed) {
                        // Add deposit receipt
                        addUnattributedReceipt({
                            type: 'deposit',
                            cost: newFixed - oldFixed,
                            creditType: 'fixed',
                            date: now.valueOf()
                        });
                    }
                }
                
                // Update account balance with fresh balance data
                accountBalance = {
                    fixedTrainingStepsLeft: newBalanceData.fixedTrainingStepsLeft,
                    purchasedTrainingSteps: newBalanceData.purchasedTrainingSteps,
                    totalCredits: newBalanceData.totalCredits
                };
                
                // Update account data subscription info with fresh balance data
                if (accountData.ok) {
                    accountData.subscription = newBalanceData.subscription;
                }
                
                lastBalanceCheck = now;
                console.log(`✅ Account Balance: ${newTotalBalance} credits (${newBalanceData.fixedTrainingStepsLeft} fixed, ${newBalanceData.purchasedTrainingSteps} paid)`);
            }
        }
    } catch (error) {
        console.error('❌ Error refreshing account data:', error.message);
    }
}

// Calculate credit usage and determine which type was used
async function calculateCreditUsage(_oldBalance) {
    const oldBalance = _oldBalance || { ...accountBalance };
    await refreshBalance(true);
    
    const totalUsage = Math.max(0, oldBalance.totalCredits - accountBalance.totalCredits);
    const freeUsage = Math.max(0, oldBalance.fixedTrainingStepsLeft - accountBalance.fixedTrainingStepsLeft);
    const paidUsage = Math.max(0, oldBalance.purchasedTrainingSteps - accountBalance.purchasedTrainingSteps);
    const usageType = totalUsage > 0 ? (paidUsage > 0 ? 'paid' : 'fixed') : 'free';
    
    return { totalUsage, freeUsage, paidUsage, usageType };
}

// Create Express app
const app = express();
const server = require('http').createServer(app);

// Security and performance middleware
app.use(helmet({
    contentSecurityPolicy: false, // Disable CSP for development
    crossOriginEmbedderPolicy: false
}));

// Enable gzip compression for all responses
app.use(compression({
    level: 6, // Balanced compression level
    threshold: 512, // Only compress responses larger than 512B
    filter: (req, res) => {
        // Don't compress if client doesn't support it
        if (req.headers['x-no-compression']) {
            return false;
        }
        // Use compression for all other requests
        return compression.filter(req, res);
    }
}));

// Body parsing middleware with optimized limits
app.use(express.json({limit: '100mb'}));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(cookieParser());

// Create session store (prefer SQLite, fallback to memory)
let SQLiteStore = null;
try {
    SQLiteStore = require('connect-sqlite3')(session);
} catch (e) {
    console.warn('⚠️ connect-sqlite3 is not installed. Falling back to MemoryStore. Run "npm i connect-sqlite3" to enable SQLite-backed sessions.');
}

let sessionStore;
if (SQLiteStore) {
    try {
        const sessionsDir = path.resolve(__dirname, '.cache', 'sessions');
        if (!fs.existsSync(sessionsDir)) {
            fs.mkdirSync(sessionsDir, { recursive: true });
        }
        sessionStore = new SQLiteStore({
            dir: sessionsDir,
            db: 'sessions.sqlite',
            table: 'sessions',
            concurrentDB: true
        });
        console.log(`✅ Using SQLite session store at ${sessionsDir}/sessions.sqlite`);
    } catch (err) {
        console.error('❌ Failed to initialize SQLite session store, falling back to MemoryStore:', err.message);
        sessionStore = new session.MemoryStore();
    }
} else {
    sessionStore = new session.MemoryStore();
}

// Make session store globally accessible for workspace persistence
global.sessionStore = sessionStore;

// Create session middleware
const sessionMiddleware = session({
    secret: config.sessionSecret || 'staticforge-very-secret-key',
    resave: false,
    saveUninitialized: false,
    store: sessionStore, // Use the shared session store
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    }
});

app.use(sessionMiddleware);

// Create cache directories
const cacheDir = path.resolve(__dirname, '.cache');
const uploadCacheDir = path.join(cacheDir, 'upload');
const previewCacheDir = path.join(cacheDir, 'preview');
const vibeCacheDir = path.join(cacheDir, 'vibe');
const tempDownloadDir = path.join(cacheDir, 'tempDownload');
const imagesDir = path.resolve(__dirname, 'images');
const previewsDir = path.resolve(__dirname, '.previews');

// Ensure cache directories exist
[uploadCacheDir, previewCacheDir, vibeCacheDir, tempDownloadDir, imagesDir, previewsDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Initialize workspace system
initializeWorkspaces();

// Generate login page sprite sheet (single sheet with normal + blurred images)
async function generateLoginSpriteSheet() {
    try {
        const spritePath = path.join(previewsDir, 'login_image.jpg');
        const metadataPath = path.join(previewsDir, 'login_sprite_metadata.json');
        
        // Check if sprite sheet exists and is less than 1 hour old
        if (fs.existsSync(spritePath)) {
            const stats = fs.statSync(spritePath);
            const ageInHours = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60);
            if (ageInHours < 1) {
                return;
            }
        }
        
        const pinnedImages = await getPinnedImages();
        const randomImages = await getRandomWorkspaceImages();
        
        console.log(`📊 Image selection: ${pinnedImages.length} pinned + ${randomImages.length} random available`);
        
        // Ensure we have at least some images to work with
        if (pinnedImages.length === 0 && randomImages.length === 0) {
            console.log('⚠️ No images found for sprite sheet, skipping generation');
            return;
        }
        
        // If no pinned images, use more random images to fill the quota
        let selectedImages;
        if (pinnedImages.length === 0) {
            console.log('📌 No pinned images found, using random workspace images only');
            selectedImages = randomImages.slice(0, 20);
        } else if (pinnedImages.length < 20) {
            console.log(`📌 Found ${pinnedImages.length} pinned images, supplementing with random images`);
            const remainingSlots = 20 - pinnedImages.length;
            selectedImages = [...pinnedImages, ...randomImages.slice(0, remainingSlots)];
        } else {
            console.log(`📌 Found ${pinnedImages.length} pinned images, using only pinned images`);
            selectedImages = pinnedImages.slice(0, 20);
        }
        
        if (selectedImages.length === 0) {
            console.log('⚠️ No valid images found for sprite sheet');
            return;
        }
        
        // Create 2x20 sprite sheet: 2 columns (normal + blurred), 20 rows (images)
        const width = 1024;
        const height = 1024;
        
        // Generate single combined sprite sheet with both normal and blurred images
        console.log('🖼️ Step 3: Generating combined sprite sheet...');
        await generateCombinedSpriteSheet(selectedImages, spritePath, width, height);
        
        // Save metadata for frontend use
        console.log('💾 Step 4: Saving metadata...');
        const metadata = {
            imageCount: selectedImages.length,
            spriteWidth: width,
            spriteHeight: (height * selectedImages.length),
            generatedAt: Date.now(),
            images: selectedImages.map(img => img.filename)
        };
        
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
        
        console.log('✅ Login sprite sheet generated successfully');
        
    } catch (error) {
        console.error('❌ Error generating login sprite sheet:', error);
        // Don't throw the error, just log it so the server can continue
    }
}

// Get pinned/favorited images from workspaces
async function getPinnedImages() {
    try {
        const workspaces = getWorkspaces();
        console.log(`🔍 Found ${Object.keys(workspaces).length} workspaces`);
        
        if (!workspaces || typeof workspaces !== 'object') {
            console.warn('⚠️ Workspaces is not a valid object:', typeof workspaces);
            return [];
        }
        
        // Validate workspace structure
        if (Object.keys(workspaces).length === 0) {
            console.warn('⚠️ No workspaces found');
            return [];
        }
        
        const pinnedImages = [];
        
        // workspaces is an object with workspace IDs as keys, so we need to iterate over its values
        Object.entries(workspaces).forEach(([workspaceId, workspace]) => {
            if (!workspace || typeof workspace !== 'object') {
                console.warn(`⚠️ Invalid workspace object for ID: ${workspaceId}`);
                return;
            }
            
            if (workspace.pinned && Array.isArray(workspace.pinned) && workspace.pinned.length > 0) {
                console.log(`📌 Workspace "${workspace.name || 'Unnamed'}" (${workspaceId}) has ${workspace.pinned.length} pinned images`);
                
                // Select only 1 pinned image from this workspace for variety
                const randomPinnedIndex = Math.floor(Math.random() * workspace.pinned.length);
                const pinnedFile = workspace.pinned[randomPinnedIndex];
                
                if (!pinnedFile || typeof pinnedFile !== 'string') {
                    console.warn(`  ⚠️ Invalid pinned file entry:`, pinnedFile);
                    return;
                }
                
                const imagePath = path.join(imagesDir, pinnedFile);
                if (fs.existsSync(imagePath) && pinnedFile.match(/\.(png|jpg|jpeg)$/i)) {
                    pinnedImages.push({
                        filename: pinnedFile,
                        path: imagePath,
                        workspace: workspace.name || workspaceId
                    });
                    console.log(`  ✅ Added 1 pinned image from "${workspace.name || 'Unnamed'}": ${pinnedFile}`);
                } else {
                    console.log(`  ⚠️ Skipped pinned image (not found or invalid): ${pinnedFile}`);
                }
            } else {
                console.log(`⚠️ Workspace ${workspaceId} has no pinned images or invalid pinned property`);
            }
        });
        
        console.log(`📌 Total pinned images found: ${pinnedImages.length}`);
        return pinnedImages;
    } catch (error) {
        console.error('❌ Error getting pinned images:', error);
        return [];
    }
}

// Get random workspace images
async function getRandomWorkspaceImages() {
    try {
        // Check if images directory exists
        if (!fs.existsSync(imagesDir)) {
            console.warn('⚠️ Images directory does not exist:', imagesDir);
            return [];
        }
        
        const imageFiles = fs.readdirSync(imagesDir)
            .filter(file => file.match(/\.(png|jpg|jpeg)$/i))
            .map(file => ({
                filename: file,
                path: path.join(imagesDir, file)
            }));
        
        if (imageFiles.length === 0) {
            console.warn('⚠️ No image files found in images directory');
            return [];
        }
        
        // Shuffle and return random images
        return imageFiles.sort(() => 0.5 - Math.random());
    } catch (error) {
        console.error('❌ Error getting random workspace images:', error);
        return [];
    }
}

// Generate combined sprite sheet with both normal and blurred images
async function generateCombinedSpriteSheet(images, outputPath, width, height) {
    try {
        if (!images || images.length === 0) {
            throw new Error('No images provided for sprite sheet generation');
        }
        
        console.log(`🖼️ Generating combined sprite sheet with ${images.length} images...`);
        
        // Create a canvas-like structure using sharp
        const spriteCanvas = sharp({
            create: {
                width: width,
                height: height * images.length,
                channels: 3,
                background: { r: 0, g: 0, b: 0 }
            }
        });
        
        const composites = [];
        let processedCount = 0;
        
        for (let i = 0; i < images.length; i++) {
            const image = images[i];
            const y = i * height; // Y position for each row
            
            try {
                if (!image.path || !fs.existsSync(image.path)) {
                    console.warn(`⚠️ Skipping invalid image: ${image.filename || 'unknown'}`);
                    continue;
                }
                
                // Process normal image (left column) - crop to point of interest
                const normalImage = sharp(image.path)
                    .resize(width, height, { 
                        fit: 'cover',
                        position: 'attention' // This focuses on the most interesting part of the image
                    });
                
                const normalBuffer = await normalImage.toBuffer();
                
                composites.push({
                    input: normalBuffer,
                    left: 0, // Left column for normal images
                    top: y
                });
                
                processedCount++;
                
            } catch (error) {
                console.error(`❌ Error processing image ${image.filename}:`, error.message);
                // Continue with other images instead of failing completely
            }
        }
        
        if (composites.length === 0) {
            throw new Error('No images could be processed for sprite sheet');
        }
        
        console.log(`✅ Processed ${processedCount}/${images.length} images for combined sprite sheet`);
        
        // Composite all images onto the sprite sheet
        await spriteCanvas
            .composite(composites)
            .jpeg({ quality: 40 })
            .toFile(outputPath);
            
        console.log(`💾 Saved combined sprite sheet to ${outputPath}`);
            
    } catch (error) {
        console.error(`❌ Error generating combined sprite sheet:`, error);
        throw error;
    }
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, imagesDir);
    },
    filename: function (req, file, cb) {
        // Generate a unique filename with timestamp
        const timestamp = Date.now();
        const randomSeed = Math.floor(Math.random() * 1000000000);
        const extension = path.extname(file.originalname);
        const filename = `${timestamp}_uploaded_${randomSeed}${extension}`;
        cb(null, filename);
    }
});
const upload = multer({ 
    storage: storage,
    fileFilter: function (req, file, cb) {
        // Only allow image files
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'), false);
        }
    },
    limits: {
        fileSize: 100 * 1024 * 1024 // 10MB limit
    }
});

// On startup: generate missing previews and clean up orphans
async function syncPreviews() {
    const files = fs.readdirSync(imagesDir).filter(f => f.match(/\.(png|jpg|jpeg)$/i));
    const previews = fs.readdirSync(previewsDir).filter(f => f.endsWith('.jpg'));
    const baseMap = {};
    // Pair originals and upscales
    for (const file of files) {
        const base = getBaseName(file);
        if (!baseMap[base]) baseMap[base] = { original: null, upscaled: null };
        if (file.includes('_upscaled')) baseMap[base].upscaled = file;
        else baseMap[base].original = file;
    }
    // Generate missing previews
    for (const base in baseMap) {
        const previewFile = `${base}.jpg`
        const imgFile = baseMap[base].original || baseMap[base].upscaled;
        const previewPath = path.join(previewsDir, previewFile);
        const retinaPreviewPath = path.join(previewsDir, `${base}@2x.jpg`);
        const blurPreviewFile = `${base}_blur.jpg`;
        const blurPreviewPath = path.join(previewsDir, blurPreviewFile);
        if (imgFile) {
            const imgPath = path.join(imagesDir, imgFile);
            if (!fs.existsSync(previewPath) || !fs.existsSync(retinaPreviewPath)) {
                // Generate both main and @2x previews for mobile devices
                await generateMobilePreviews(imgPath, base);
            }
            if (!fs.existsSync(blurPreviewPath)) {
                await generateBlurredPreview(imgPath, blurPreviewPath);
            }
        }
    }
    // Remove orphan previews (both regular, @2x, and blur)
    for (const preview of previews) {
        // Handle regular previews (.jpg), @2x previews (@2x.jpg), and blur previews (_blur.jpg)
        let base;
        if (preview.endsWith('_blur.jpg')) {
            // For blur previews, extract the base name by removing '_blur.jpg'
            base = preview.replace(/_blur\.jpg$/, '');
        } else if (preview.endsWith('@2x.jpg')) {
            // For @2x previews, extract the base name by removing '@2x.jpg'
            base = preview.replace(/@2x\.jpg$/, '');
        } else if (preview.endsWith('.jpg')) {
            // For regular previews, extract the base name by removing '.jpg'
            base = preview.replace(/\.jpg$/, '');
        } else {
            // Skip non-jpg files
            continue;
        }
        
        // Check if the base image still exists
        if (!baseMap[base]) {
            const previewPath = path.join(previewsDir, preview);
            fs.unlinkSync(previewPath);
            console.log(`🧹 Removed orphan preview: ${preview}`);
        }
    }
}

async function getBalance() {
    try {
        const options = {
            hostname: 'api.novelai.net',
            port: 443,
            path: '/user/subscription',
            method: 'GET',
            headers: {
                "accept": "*/*",
                "accept-language": "en-US,en;q=0.9,en-GB;q=0.8",
                "authorization": `Bearer ${config.apiKey}`,
                "content-type": "application/json",
                "priority": "u=1, i",
                "sec-ch-ua": "\"Not)A;Brand\";v=\"8\", \"Chromium\";v=\"138\", \"Microsoft Edge\";v=\"138\"",
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": "\"macOS\"",
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-site",
                "x-correlation-id": crypto.randomBytes(3).toString('hex').toUpperCase(),
                "x-initiated-at": new Date().toISOString(),
                "referer": "https://novelai.net/",
                "origin": "https://novelai.net",
                "sec-gpc": "1",
                "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0"
              }
        };
        
        const balanceData = await new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = [];
                res.on('data', chunk => data.push(chunk));
                res.on('end', () => {
                    const buffer = Buffer.concat(data);
                    if (res.statusCode === 200) {
                        try {
                            const response = JSON.parse(buffer.toString());
                            resolve(response);
                        } catch (e) {
                            reject(new Error('Invalid JSON response from NovelAI API'));
                        }
                    } else {
                        try {
                            const errorResponse = JSON.parse(buffer.toString());
                            reject(new Error(`Balance API error: ${errorResponse.error || 'Unknown error'}`));
                        } catch (e) {
                            reject(new Error(`Balance API error: HTTP ${res.statusCode}`));
                        }
                    }
                });
            });
            
            req.on('error', error => {
                console.error('❌ Balance API request error:', error.message);
                reject(error);
            });
            
            req.end();
        });
        
        // Extract training steps information
        const fixedTrainingStepsLeft = balanceData?.trainingStepsLeft?.fixedTrainingStepsLeft || 0;
        const purchasedTrainingSteps = balanceData?.trainingStepsLeft?.purchasedTrainingSteps || 0;
        const totalCredits = fixedTrainingStepsLeft + purchasedTrainingSteps;
        
        return {
            ok: true,
            fixedTrainingStepsLeft,
            purchasedTrainingSteps,
            totalCredits,
            subscription: balanceData
        }
        
    } catch (error) {
        console.error('Balance check error:', error);
        return {
            ok: false,
            fixedTrainingStepsLeft: 0,
            purchasedTrainingSteps: 0,
            totalCredits: 0,
            subscription: null
        }
    }
}

async function getUserData() {
    try {
        const options = {
            hostname: 'api.novelai.net',
            port: 443,
            path: '/user/data',
            method: 'GET',
            headers: {
                "accept": "*/*",
                "accept-language": "en-US,en;q=0.9,en-GB;q=0.8",
                "authorization": `Bearer ${config.apiKey}`,
                "content-type": "application/json",
                "priority": "u=1, i",
                "sec-ch-ua": "\"Not)A;Brand\";v=\"8\", \"Chromium\";v=\"138\", \"Microsoft Edge\";v=\"138\"",
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": "\"macOS\"",
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-site",
                "x-correlation-id": crypto.randomBytes(3).toString('hex').toUpperCase(),
                "x-initiated-at": new Date().toISOString(),
                "Referer": "https://novelai.net/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:138.0) Gecko/20100101 Firefox/138.0"
              }
        };
        const userData = await new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = [];
                res.on('data', chunk => data.push(chunk));
                res.on('end', () => {
                    const buffer = Buffer.concat(data);
                    if (res.statusCode === 200) {
                        try {
                            const response = JSON.parse(buffer.toString());
                            resolve({
                                ok: true,
                                ...response,
                            });
                        } catch (e) {
                            reject(new Error('Invalid JSON response from NovelAI API'));
                        }
                    } else {
                        try {
                            const errorResponse = JSON.parse(buffer.toString());
                            console.error('❌ User data API error:', errorResponse);
                            resolve({
                                ok: false,
                                statusCode: res.statusCode,
                                error: errorResponse.message || 'Unknown error'
                            })
                        } catch (e) {
                            reject(new Error(`User data API error: HTTP ${res.statusCode}`));
                        }
                    }
                });
            });
            req.on('error', error => {
                console.error('❌ User data API request error:', error.message);
                reject(error);
            });
            req.end();
        });
        return {
            ok: true,
            ...userData
        };
    } catch (error) {
        console.error('User data error:', error);
        return {
            ok: false
        }
    }
}

// Serve static files from public directory with optimized caching and compression
app.use(express.static('public', {
    maxAge: '10s', // Cache static assets for 1 day
    etag: true, // Enable ETags for cache validation
    lastModified: true, // Enable Last-Modified headers
    setHeaders: (res, path) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
}));
app.use('/cache', (req, res, next) => {
    res.setHeader('Cache-Control', 'public, max-age=259200');
    next();
}, express.static(cacheDir));
app.use('/temp', express.static(path.join(cacheDir, 'tempDownload')));
app.use('/previews/:preview', (req, res) => {
    const previewFile = req.params.preview;
    const previewPath = path.join(previewsDir, previewFile);
    if (!fs.existsSync(previewPath)) {
        return res.status(404).json({ success: false, error: 'Preview not found' });
    }
    res.setHeader('Cache-Control', 'public, max-age=259200');
    res.sendFile(previewFile, { root: previewsDir });
});
app.use('/images/:filename', authMiddleware, (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(imagesDir, filename);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, error: 'Image not found' });
    }
    
    // Set appropriate headers
    const ext = path.extname(filename).toLowerCase();
    let contentType = 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') {
        contentType = 'image/jpeg';
    }
    
    res.setHeader('Content-Type', contentType);
    
    // Handle download request
    if (req.query.download === 'true') {
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    }
    
    // Send the file
    res.sendFile(filePath);
});

// Logger // NOTE: Everything above this is not logged!
app.use((req, res, next) => {
    const skippedPaths = [
        '/ping',
        '/images',
        '/spellcheck',
        '/vibe',
        '/vibe/images',
    ];
    if (skippedPaths.some(path => req.path.startsWith(path))) {
        return next();
    }
    
    const startTime = Date.now();
    const timestamp = new Date().toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    
    const realIP = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.ip || req.connection.remoteAddress;
    const queryParams = { ...req.query };
    delete queryParams.auth;
    delete queryParams.loginKey;
    
    // Add response time header
    res.setHeader('X-Response-Time', '0ms');
    
    console.log(`\n📋 [${timestamp}] ${realIP} => ${req.method} ${req.path}`);
    if (Object.keys(queryParams).length > 0) {
        console.log(`   Query: ${JSON.stringify(queryParams)}`);
    }
    if (req.body && Object.keys(req.body).length > 0) {
        console.log(`   Body: ${JSON.stringify(req.body)}`);
    }
    
    let completionLogged = false;
    const originalEnd = res.end;
    res.end = function(...args) {
        if (!completionLogged && !res.headersSent) {
            try {
                const duration = Date.now() - startTime;
                const responseTime = `${duration}ms`;
                res.setHeader('X-Response-Time', responseTime);
                console.log(`⏱️ Completed in ${(duration / 1000).toFixed(2)}s`);
                completionLogged = true;
            } catch (error) {
                // Headers already sent, just log completion
                const duration = Date.now() - startTime;
                console.log(`⏱️ Completed in ${(duration / 1000).toFixed(2)}s (headers already sent)`);
                completionLogged = true;
            }
        }
        originalEnd.apply(this, args);
    };
    
    const originalSend = res.send;
    res.send = function(...args) {
        if (!completionLogged && !res.headersSent) {
            try {
                const duration = Date.now() - startTime;
                const responseTime = `${duration}ms`;
                res.setHeader('X-Response-Time', responseTime);
                console.log(`⏱️ Completed in ${(duration / 1000).toFixed(2)}s`);
                completionLogged = true;
            } catch (error) {
                // Headers already sent, just log completion
                const duration = Date.now() - startTime;
                console.log(`⏱️ Completed in ${(duration / 1000).toFixed(2)}s (headers already sent)`);
                completionLogged = true;
            }
        }
        originalSend.apply(this, args);
    };
    
    next();
});

// Public routes (no authentication required)
app.get('/', (req, res) => {
    // Check if user is authenticated via session
    if (req.session && req.session.authenticated) {
        res.redirect('/app');
    } else {
        generateLoginSpriteSheet();
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// Cache manifest endpoint for service worker
app.options('/', (req, res) => {
    try {
        // Exclude HTML files handled as routes, splash/screenshot files, and unrelated files like *.backup.*, *.md, etc.
        const htmlFilesToExclude = ['/index.html', '/app.html'];
        const splashOrScreenshotPattern = /^\/static_images\/(apple-splash|android-screenshot)-.*\.(png|jpg|jpeg|webp)$/i;
        const unrelatedFilePattern = /\.(backup\..*|md|markdown|txt|log|DS_Store|swp|tmp|bak)$/i;

        const staticFiles = globalCacheData
            .filter(file =>
                !htmlFilesToExclude.includes(file.path) &&
                !splashOrScreenshotPattern.test(file.path) &&
                !unrelatedFilePattern.test(file.path)
            )
            .map(file => ({
                url: file.path,
                hash: file.md5,
                size: file.size,
                modified: file.modified
            }));

        // Add route-based entries for HTML files
        const routeBasedFiles = [
            {
                url: '/',
                hash: globalCacheData.find(f => f.path === '/index.html')?.md5 || 'no-hash',
                size: globalCacheData.find(f => f.path === '/index.html')?.size || 0,
                modified: globalCacheData.find(f => f.path === '/index.html')?.modified || Date.now(),
                type: 'route'
            },
            {
                url: '/app',
                hash: globalCacheData.find(f => f.path === '/app.html')?.md5 || 'no-hash',
                size: globalCacheData.find(f => f.path === '/app.html')?.size || 0,
                modified: globalCacheData.find(f => f.path === '/app.html')?.modified || Date.now(),
                type: 'route'
            },
            {
                url: '/launch',
                hash: globalCacheData.find(f => f.path === '/launch.html')?.md5 || 'no-hash',
                size: globalCacheData.find(f => f.path === '/launch.html')?.size || 0,
                modified: globalCacheData.find(f => f.path === '/launch.html')?.modified || Date.now(),
                type: 'route'
            }
        ];

        // Combine filtered static files with route-based files
        const allFiles = [...staticFiles, ...routeBasedFiles];

        res.json(allFiles);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Unified message endpoint
app.post('/', express.json(), (req, res) => {
    const { action, data } = req.body;
    
    if (!action) {
        return res.status(400).json({ error: 'Action is required' });
    }
    
    switch (action) {
        case 'login':
            const { pin } = data || {};
            if (!pin) {
                return res.status(400).json({ error: 'PIN code is required' });
            }
            if (pin === config.loginPin) {
                req.session.authenticated = true;
                req.session.userType = 'admin';
                res.json({ success: true, message: 'Login successful', userType: 'admin' });
            } else if (pin === config.readOnlyPin) {
                req.session.authenticated = true;
                req.session.userType = 'readonly';
                res.json({ success: true, message: 'Login successful', userType: 'readonly' });
            } else {
                res.status(401).json({ success: false, error: 'Invalid PIN code' });
            }
            break;
            
        case 'logout':
            req.session.destroy(() => {
                res.clearCookie('connect.sid');
                res.json({ success: true, message: 'Logged out successfully' });
            });
            break;
            
        default:
            res.status(400).json({ success: false, error: 'Invalid action' });
    }
});

// Launch route (PWA entry point)
app.get('/launch', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'launch.html'));
});

// App route (requires authentication)
app.get('/app', (req, res) => {
    if (req.session && req.session.authenticated) {
        res.sendFile(path.join(__dirname, 'public', 'app.html'));
    } else {
        res.redirect('/');
    }
});

app.options('/app', authMiddleware, (req, res) => {
    const serverVersion = '1.0.0'; // Update this when making breaking changes
    const message = 'A new version is available. Some features may not work correctly.';
    
    res.json({ 
        success: true, 
        message: 'Session Valid', 
        timestamp: Date.now().valueOf(),
        serverVersion: serverVersion,
        versionMessage: message
    });
});

// Reload cache data endpoint (for development/deployment)
app.get('/admin/reload-cache', authMiddleware, async (req, res) => {
    try {
        // Check if user is admin (not readonly)
        if (req.session.userType !== 'admin') {
            return res.status(403).json({ 
                success: false, error: 'Admin access required to reload cache data' 
            });
        }

        console.log('🔄 Admin requested cache data reload...');
        
        // Force reload of cache data
        await initializeCacheData(true);
        
        // Get updated cache data
        const publicDir = path.join(__dirname, 'public');
        const updatedCacheData = await generateCacheData(publicDir);
        
        // Update global cache data
        globalCacheData = updatedCacheData;
        
        console.log(`✅ Cache data reloaded successfully: ${updatedCacheData.length} assets`);
        
        res.json({
            success: true,
            message: `Cache data reloaded successfully`,
            assetsCount: updatedCacheData.length,
            timestamp: Date.now().valueOf(),
            cacheData: updatedCacheData
        });
        
    } catch (error) {
        console.error('❌ Error reloading cache data:', error);
        res.status(500).json({ 
            error: 'Failed to reload cache data',
            details: error.message 
        });
    }
});

// Restart server endpoint (for development/deployment)
app.post('/admin/restart-server', authMiddleware, async (req, res) => {
    try {
        // Check if user is admin (not readonly)
        if (req.session.userType !== 'admin') {
            return res.status(403).json({ 
                success: false, error: 'Admin access required to restart server' 
            });
        }

        console.log('🔄 Admin requested server restart...');
        
        // Send response immediately before restarting
        res.json({
            success: true,
            message: 'Server restart initiated',
            timestamp: Date.now().valueOf()
        });
        
        // Small delay to ensure response is sent
        setTimeout(() => {
            console.log('🔄 Restarting server via PM2...');
            // Use PM2 to restart the server (ID 12 as mentioned in user rules)
            const { exec } = require('child_process');
            exec('timeout 5 pm2 restart 12', (error, stdout, stderr) => {
                if (error) {
                    console.error('❌ Error restarting server:', error);
                } else {
                    console.log('✅ Server restart command executed:', stdout);
                }
            });
        }, 100);
        
    } catch (error) {
        console.error('❌ Error initiating server restart:', error);
        // Response already sent, just log the error
    }
});

// Internal URL handler for service worker cached data
app.get('/internal/*', (req, res) => {
    try {
        res.set('Content-Type', 'application/json');
        res.json({
            success: true,
            message: 'File is missing from client cache',
            path: req.path,
            timestamp: Date.now()
        });
        
    } catch (error) {
        console.error('❌ Error handling internal URL:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

app.get('/preset/:uuid', authMiddleware, queueMiddleware, async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        if (req.userType !== 'admin') {
            return res.status(403).json({ success: false, error: 'Non-Administrator Login: This operation is not allowed for non-administrator users' });
        }
        const currentPromptConfig = loadPromptConfig();
        // Find preset by UUID instead of name
        const p = Object.entries(currentPromptConfig.presets).find(([key, preset]) => preset.uuid === req.params.uuid).map(p => ({...p[1], name: p[0]}));
        if (!p) {
            return res.status(404).json({ success: false, error: 'Preset not found' });
        }
        
        console.log('🔍 Building options for preset:', p);
        const opts = await buildOptions(p, null, req.query);
        // Use target_workspace from preset if no workspace specified (for REST API calls)
        const workspaceId = req?.query?.workspace || p?.target_workspace || 'default';
        let result = await handleGeneration(opts, true, p.name || 'unknown', workspaceId);
        
        // Check if optimization is requested
        const optimize = req.query.optimize === 'true';
        let finalBuffer = result.buffer;
        let contentType = 'image/png';
        if (optimize) {
            try {
                finalBuffer = await sharp(result.buffer)
                    .jpeg({ quality: 75 })
                    .toBuffer();
                contentType = 'image/jpeg';
            } catch (error) {
                console.error('❌ Image optimization failed:', error.message);
                // Fall back to original PNG if optimization fails
            }
        }
        res.setHeader('Content-Type', contentType);
        res.setHeader('Access-Control-Expose-Headers', 'X-Generated-Filename');
        if (result && result.filename) {
            res.setHeader('X-Generated-Filename', result.filename);
        }
        res.setHeader('X-Preset-UUID', p.uuid);
        res.setHeader('X-Preset-Name', p.name);
        if (req.query.download === 'true') {
            const extension = optimize ? 'jpg' : 'png';
            const optimizedFilename = result.filename.replace('.png', `.${extension}`);
            res.setHeader('Content-Disposition', `attachment; filename="${optimizedFilename}"`);
        }
        res.send(finalBuffer);
    } catch(e) {
        console.error('❌ Error occurred:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Image reroll endpoint
app.post('/reroll/:filename', authMiddleware, queueMiddleware, async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        
        if (req.userType !== 'admin') {
            return res.status(403).json({ success: false, error: 'Non-Administrator Login: This operation is not allowed for non-administrator users' });
        }

        const filename = req.params.filename;
        const workspace = req.query.workspace || req.body.workspace || 'default';
        
        console.log(`🎲 Processing reroll request for filename: ${filename} in workspace: ${workspace}`);
        
        // Get image metadata
        const metadata = await getImageMetadata(filename, imagesDir);
        if (!metadata) {
            return res.status(404).json({ success: false, error: `No metadata found for image: ${filename}` });
        }

        // Call the reroll generation function
        const result = await handleRerollGeneration(
            metadata, 
            req.userType, 
            req.session.id, 
            workspace
        );
        
        // Check if optimization is requested
        const optimize = req.query.optimize === 'true';
        let finalBuffer = result.buffer;
        let contentType = 'image/png';
        
        if (optimize) {
            try {
                finalBuffer = await sharp(result.buffer)
                    .jpeg({ quality: 75 })
                    .toBuffer();
                contentType = 'image/jpeg';
            } catch (error) {
                console.error('❌ Image optimization failed:', error.message);
                // Fall back to original PNG if optimization fails
            }
        }
        
        res.setHeader('Content-Type', contentType);
        res.setHeader('Access-Control-Expose-Headers', 'X-Generated-Filename, X-Seed, X-Original-Filename');
        
        if (result && result.filename) {
            res.setHeader('X-Generated-Filename', result.filename);
        }
        
        if (result && result.seed !== undefined) {
            res.setHeader('X-Seed', result.seed.toString());
        }
        
        res.setHeader('X-Original-Filename', filename);
        
        if (req.query.download === 'true') {
            const extension = optimize ? 'jpg' : 'png';
            const optimizedFilename = result.filename.replace('.png', `.${extension}`);
            res.setHeader('Content-Disposition', `attachment; filename="${optimizedFilename}"`);
        }
        
        res.send(finalBuffer);
        
    } catch(e) {
        console.error('❌ Reroll error occurred:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Initialize cache at startup
async function initializeCache() {
    console.log('🔄 Syncing previews...');
    await syncPreviews();

    // Initialize account data
    await initializeAccountData();
    
    // Initialize cache data
    await initializeCacheData(true);
    
    // Set up periodic refreshes
    setInterval(() => initializeAccountData(), ACCOUNT_DATA_REFRESH_INTERVAL); // Check every 4 hours
    setInterval(() => refreshBalance(), BALANCE_REFRESH_INTERVAL); // Check every 15 minutes
    setInterval(() => initializeCacheData(), CACHE_REFRESH_INTERVAL); // Check every 5 minutes
}

// Test bias adjustment endpoint
app.post('/test-bias-adjustment', async (req, res) => {
    try {
        const { image_source, target_width, target_height, bias } = req.body;
        
        if (!image_source || !target_width || !target_height || !bias) {
            return res.status(400).json({ success: false, error: 'Missing required parameters' });
        }
        
        // Load image from disk based on source
        let imagePath;
        if (image_source.startsWith('file:')) {
            imagePath = path.join(imagesDir, image_source.replace('file:', ''));
        } else if (image_source.startsWith('cache:')) {
            imagePath = path.join(uploadCacheDir, image_source.replace('cache:', ''));
        } else {
            return res.status(400).json({ success: false, error: 'Invalid image source format' });
        }
        
        // Check if file exists
        if (!fs.existsSync(imagePath)) {
            return res.status(404).json({ success: false, error: 'Image file not found' });
        }
        
        // Read image file
        const imageBuffer = fs.readFileSync(imagePath);
        
        // Process image with dynamic bias
        const processedBuffer = await processDynamicImage(
            imageBuffer, 
            { width: target_width, height: target_height }, 
            bias
        );
        
        // Return the processed image
        res.set('Content-Type', 'image/png');
        res.send(processedBuffer);
        
    } catch (error) {
        console.error('Bias adjustment test error:', error);
        res.status(500).json({ success: false, error: 'Failed to process bias adjustment' });
    }
});

// Cache save scheduling function
function scheduleCacheSave() {
    if (tagSuggestionsCache.isDirty) {
        tagSuggestionsCache.markDirty();
    }
}

// Initialize WebSocket message handlers
const wsMessageHandlers = new WebSocketMessageHandlers({
    Model: Model,
    config: config,
    scheduleCacheSave,
    calculateCreditUsage,
    tagSuggestionsCache,
    accountData: () => accountData,
    accountBalance: () => accountBalance,
    getGlobalCacheData: () => globalCacheData,
    reloadCacheData: () => initializeCacheData(true)
});

// Initialize WebSocket server with session store and message handler
const wsServer = new WebSocketServer(server, sessionStore, async (ws, message, clientInfo, wsServer) => {
    await wsMessageHandlers.handleMessage(ws, message, clientInfo, wsServer);
});

setGlobalWsServer(wsServer);

// Set context with all required functions
setImageGenContext({
    client,
    calculateCreditUsage: calculateCreditUsage,
    addToWorkspaceArray: addToWorkspaceArray,
    addReceiptMetadata: addReceiptMetadata,
    broadcastReceiptNotification: broadcastReceiptNotification,
    getActiveWorkspace: getActiveWorkspace
});

setUpscaleContext({
    config,
    addToWorkspaceArray: addToWorkspaceArray,
    getActiveWorkspace: getActiveWorkspace
});

// Export global cache data for websocket handlers
module.exports.globalCacheData = globalCacheData;

// Start ping interval with server data callback
wsServer.startPingInterval(() => {
    return {
        balance: accountBalance,
        queue_status: getQueueStatus(),
        image_count: imageCounter.getCount(),
        server_time: Date.now().valueOf()
    };
});

// Start queue status broadcasting
wsServer.startQueueStatusInterval();

// Clear temp downloads on server boot
function clearTempDownloads() {
    try {
        if (fs.existsSync(tempDownloadDir)) {
            const files = fs.readdirSync(tempDownloadDir);
            let deletedCount = 0;
            
            for (const file of files) {
                try {
                    const filePath = path.join(tempDownloadDir, file);
                    fs.unlinkSync(filePath);
                    deletedCount++;
                } catch (error) {
                    console.warn(`⚠️ Failed to delete temp file ${file}:`, error.message);
                }
            }
            
            if (deletedCount > 0) {
                console.log(`🧹 Cleared ${deletedCount} temp download files on server boot`);
            }
        }
    } catch (error) {
        console.warn('⚠️ Failed to clear temp downloads:', error.message);
    }
}

// Performance monitoring endpoint
app.get('/admin/performance', authMiddleware, (req, res) => {
    try {
        if (req.userType !== 'admin') {
            return res.status(403).json({ success: false, error: 'Non-Administrator Login: This operation is not allowed for non-administrator users' });
        }
        
        const memUsage = process.memoryUsage();
        const uptime = process.uptime();
        
        res.json({
            success: true,
            performance: {
                memory: {
                    rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
                    heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
                    heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
                    external: `${Math.round(memUsage.external / 1024 / 1024)}MB`
                },
                uptime: `${Math.round(uptime)}s`,
                nodeVersion: process.version,
                platform: process.platform,
                arch: process.arch,
                pid: process.pid
            },
            timestamp: Date.now().valueOf()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start server
(async () => {
    console.log('🚀 Initializing cache... (Server unavailable until cache is initialized)');
    await initializeCache();
    
    // Clear temp downloads on startup
    clearTempDownloads();
    
    // Generate login sprite sheet on startup
    try {
        console.log('🎨 Generating login sprite sheet on startup...');
        await generateLoginSpriteSheet();
    } catch (error) {
        console.error('❌ Failed to generate login sprite sheet on startup:', error.message);
        console.log('⚠️ Server will continue without sprite sheet, it will be generated on first login access');
    }
    
    server.listen(config.port, () => {
        console.log(`🚀 Server running on port ${config.port}`);
        console.log(`📊 Performance monitoring: GET /admin/performance`);
        console.log(`🔒 Gzip compression enabled`);
        console.log(`🛡️ Security headers enabled`);
    });
})();

// Graceful shutdown handling
function gracefulShutdown() {
    console.log('🛑 Graceful shutdown initiated...');
    
    // Stop WebSocket ping interval
    if (wsServer) {
        wsServer.stopPingInterval();
        wsServer.stopQueueStatusInterval();
    }
    
    // Save tag cache immediately if dirty
    if (tagSuggestionsCache.isDirty) {
        console.log('💾 Saving tag cache before shutdown...');
        tagSuggestionsCache.saveCache();
    }
    
    process.exit(0);
}

// Register shutdown handlers
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);