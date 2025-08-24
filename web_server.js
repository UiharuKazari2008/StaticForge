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

// Import modules
const { authMiddleware } = require('./modules/auth');
const { loadPromptConfig, applyTextReplacements, getUsedReplacements } = require('./modules/textReplacements');
const { getPresetCacheKey, getCachedPreset, setCachedPreset, getCacheStatus } = require('./modules/cache');
const { queueMiddleware, getStatus: getQueueStatus } = require('./modules/queue');
const { WebSocketServer, setGlobalWsServer, getGlobalWsServer } = require('./modules/websocket');
const { WebSocketMessageHandlers } = require('./modules/websocketHandlers');
const { 
    readMetadata,
    updateMetadata, 
    stripPngTextChunks, 
    extractRelevantFields, 
    getModelDisplayName,
    getBaseName
} = require('./modules/pngMetadata');
const { 
    getImageDimensions, 
    getDimensionsFromResolution, 
    matchOriginalResolution, 
    processDynamicImage, 
    resizeMaskWithCanvas, 
    isImageLarge
} = require('./modules/imageTools');
const { 
    initializeWorkspaces,
    getWorkspaces,
    getWorkspace,
    createWorkspace,
    renameWorkspace,
    updateWorkspaceColor,
    updateWorkspaceBackgroundColor,
    deleteWorkspace,
    dumpWorkspace,
    moveFilesToWorkspace,
    movePinnedToWorkspace,
    getActiveWorkspace,
    setActiveWorkspace,
    getActiveWorkspaceFiles,
    addToWorkspaceArray,
    removeFromWorkspaceArray,
    moveToWorkspaceArray,
    getActiveWorkspaceCacheFiles,
    removeFilesFromWorkspaces,
    getActiveWorkspaceScraps,
    getActiveWorkspacePinned,
    syncWorkspaceFiles,
    getWorkspacesData,
    getActiveWorkspaceData,
    // Group management functions
    createGroup,
    getGroup,
    getWorkspaceGroups,
    addImagesToGroup,
    removeImagesFromGroup,
    renameGroup,
    deleteGroup,
    getGroupsForImage,
    getActiveWorkspaceGroups
} = require('./modules/workspace');
const { 
    loadMetadataCache,
    saveMetadataCache,
    getImageMetadata,
    scanAndUpdateMetadata,
    addReceipt,
    removeImageMetadata,
    getCachedMetadata,
    getAllMetadata,
    getMultipleMetadata,
    addReceiptMetadata,
    addUnattributedReceipt,
    broadcastReceiptNotification
} = require('./modules/metadataCache.js');
const imageCounter = require('./modules/imageCounter');
const { generatePreview, generateBlurredPreview } = require('./modules/previewUtils');
// Example usage in WebSocket handler or main server
const { setContext: setImageGenContext, handleGeneration, buildOptions } = require('./modules/imageGeneration');
const { setContext: setUpscaleContext, upscaleImage } = require('./modules/imageUpscaling');

// Initialize NovelAI client
const client = new NovelAI({ 
    token: config.apiKey,
    timeout: 100000,
    verbose: false
 });


// Account data management
let accountData = { ok: false };
let accountBalance = { fixedTrainingStepsLeft: -1, purchasedTrainingSteps: -1, totalCredits: -1 };
let lastBalanceCheck = 0;
let lastAccountDataCheck = 0;
const BALANCE_REFRESH_INTERVAL = 15 * 60 * 1000; // 15 minutes
const ACCOUNT_DATA_REFRESH_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours

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
                const fixedTrainingStepsLeft = userData?.subscription?.trainingStepsLeft?.fixedTrainingStepsLeft || -1;
                const purchasedTrainingSteps = userData?.subscription?.trainingStepsLeft?.purchasedTrainingSteps || -1;
                const totalCredits = fixedTrainingStepsLeft !== -1 && purchasedTrainingSteps !== -1 ? fixedTrainingStepsLeft + purchasedTrainingSteps : -1;
                
                accountBalance = {
                    fixedTrainingStepsLeft,
                    purchasedTrainingSteps,
                    totalCredits
                };
            }

            lastAccountDataCheck = Date.now();
            
            if (accountBalance.totalCredits !== -1) {
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
    if (oldBalance.totalCredits === -1 || accountBalance.totalCredits === -1) return { totalUsage: 0, freeUsage: 0, paidUsage: 0 };
    
    const totalUsage = Math.max(0, oldBalance.totalCredits - accountBalance.totalCredits);
    const freeUsage = Math.max(0, oldBalance.fixedTrainingStepsLeft - accountBalance.fixedTrainingStepsLeft);
    const paidUsage = Math.max(0, oldBalance.purchasedTrainingSteps - accountBalance.purchasedTrainingSteps);
    const usageType = totalUsage > 0 ? (paidUsage > 0 ? 'paid' : 'fixed') : 'free';
    
    return { totalUsage, freeUsage, paidUsage, usageType };
}

// Create Express app
const app = express();
const server = require('http').createServer(app);
app.use(express.json({limit: '100mb'}));
app.use(cookieParser());

// Create session store
const sessionStore = new session.MemoryStore();

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
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
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

const cacheFile = path.join(cacheDir, 'tag_cache.json');

// Initialize workspace system
initializeWorkspaces();

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

// App route (requires authentication)
app.get('/app', (req, res) => {
    if (req.session && req.session.authenticated) {
        res.sendFile(path.join(__dirname, 'public', 'app.html'));
    } else {
        res.redirect('/');
    }
});

app.options('/ping', authMiddleware, (req, res) => {
    res.json({ ok: true, date: Date.now().valueOf() });
});

// Login endpoint
app.post('/login', express.json(), (req, res) => {
    const { pin } = req.body;
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
        res.status(401).json({ error: 'Invalid PIN code' });
    }
});

// Logout endpoint
app.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.json({ success: true, message: 'Logged out successfully' });
    });
});

// Serve static files from public directory
app.use(express.static('public'));
app.use('/cache', express.static(cacheDir));
app.use('/temp', express.static(path.join(cacheDir, 'tempDownload')));

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
        
        // Create single sprite sheet: width = image count * 1024px, height = 2 * 1024px (normal + blurred)
        const spriteWidth = 1024 * selectedImages.length;
        const spriteHeight = 2048; // 2 rows: normal images (top) + blurred images (bottom)
        
        // Generate single combined sprite sheet with both normal and blurred images
        console.log('🖼️ Step 3: Generating combined sprite sheet...');
        await generateCombinedSpriteSheet(selectedImages, spritePath, spriteWidth, spriteHeight);
        
        // Save metadata for frontend use
        console.log('💾 Step 4: Saving metadata...');
        const metadata = {
            imageCount: selectedImages.length,
            spriteWidth: spriteWidth,
            spriteHeight: spriteHeight,
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
        
        // Log workspace structure for debugging
        console.log('📋 Workspace keys:', Object.keys(workspaces));
        
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
            
            console.log(`🔍 Checking workspace: ${workspaceId}`, {
                name: workspace.name || 'Unnamed',
                hasPinned: !!workspace.pinned,
                pinnedType: typeof workspace.pinned,
                pinnedLength: Array.isArray(workspace.pinned) ? workspace.pinned.length : 'N/A'
            });
            
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
        
        console.log(`🖼️ Found ${imageFiles.length} total images in workspace`);
        
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
                height: height,
                channels: 3,
                background: { r: 0, g: 0, b: 0 }
            }
        });
        
        const composites = [];
        let processedCount = 0;
        
        for (let i = 0; i < images.length; i++) {
            const image = images[i];
            const x = i * 1024;
            
            try {
                if (!image.path || !fs.existsSync(image.path)) {
                    console.warn(`⚠️ Skipping invalid image: ${image.filename || 'unknown'}`);
                    continue;
                }
                
                // Process normal image (top row) - crop to point of interest
                const normalImage = sharp(image.path)
                    .resize(1024, 1024, { 
                        fit: 'cover',
                        position: 'attention' // This focuses on the most interesting part of the image
                    });
                
                const normalBuffer = await normalImage.jpeg({ quality: 90 }).toBuffer();
                
                composites.push({
                    input: normalBuffer,
                    left: x,
                    top: 0 // Top row for normal images
                });
                
                // Process blurred image (bottom row) - crop to point of interest
                const blurredImage = sharp(image.path)
                    .resize(1024, 1024, { 
                        fit: 'cover',
                        position: 'attention' // This focuses on the most interesting part of the image
                    })
                    .blur(15);
                
                const blurredBuffer = await blurredImage.jpeg({ quality: 90 }).toBuffer();
                
                composites.push({
                    input: blurredBuffer,
                    left: x,
                    top: 1024 // Bottom row for blurred images
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
            .jpeg({ quality: 90 })
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
const cacheUpload = multer({
    storage: multer.memoryStorage()
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
        const blurPreviewFile = `${base}_blur.jpg`;
        const blurPreviewPath = path.join(previewsDir, blurPreviewFile);
        if (imgFile) {
            const imgPath = path.join(imagesDir, imgFile);
            if (!fs.existsSync(previewPath)) {
                await generatePreview(imgPath, previewPath);
            }
            if (!fs.existsSync(blurPreviewPath)) {
                await generateBlurredPreview(imgPath, blurPreviewPath);
            }
        }
    }
    // Remove orphan previews (both regular and blur)
    for (const preview of previews) {
        // Handle both regular previews (.jpg) and blur previews (_blur.jpg)
        let base;
        if (preview.endsWith('_blur.jpg')) {
            // For blur previews, extract the base name by removing '_blur.jpg'
            base = preview.replace(/_blur\.jpg$/, '');
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

// GET /previews/:preview (serve preview images)
app.get('/previews/:preview', (req, res) => {
    const previewFile = req.params.preview;
    const previewPath = path.join(previewsDir, previewFile);
    if (!fs.existsSync(previewPath)) {
        return res.status(404).json({ error: 'Preview not found' });
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.sendFile(previewFile, { root: previewsDir });
});

// GET /images/:filename (serve individual image files)
app.get('/images/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(imagesDir, filename);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Image not found' });
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

// Common request logging middleware
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
        if (!completionLogged) {
            const duration = Date.now() - startTime;
            console.log(`⏱️ Completed in ${(duration / 1000).toFixed(2)}s`);
            completionLogged = true;
        }
        originalEnd.apply(this, args);
    };
    
    const originalSend = res.send;
    res.send = function(...args) {
        if (!completionLogged) {
            const duration = Date.now() - startTime;
            console.log(`⏱️ Completed in ${(duration / 1000).toFixed(2)}s`);
            completionLogged = true;
        }
        originalSend.apply(this, args);
    };
    
    next();
});

app.get('/preset/:name', authMiddleware, async (req, res) => {
    try {
        const currentPromptConfig = loadPromptConfig();
        const p = currentPromptConfig.presets[req.params.name];
        if (!p) {
            return res.status(404).json({ error: 'Preset not found' });
        }
        
        // Check if force generation is requested
        const forceGenerate = req.query.forceGenerate === 'true';
        
        if (!forceGenerate) {
            // Try to get cached image
            const cacheKey = getPresetCacheKey(req.params.name, req.query);
            const cached = getCachedPreset(cacheKey);
            
            if (cached) {
                console.log('📤 Returning cached image');
                    
                // Read the cached file from disk
                const filePath = path.join(imagesDir, cached.filename);
                const fileBuffer = fs.readFileSync(filePath);
                
                // Check if optimization is requested
                const optimize = req.query.optimize === 'true';
                    let finalBuffer = fileBuffer;
                let contentType = 'image/png';
                
                if (optimize) {
                    try {
                        finalBuffer = await sharp(fileBuffer)
                        .jpeg({ quality: 75 })
                        .toBuffer();
                        contentType = 'image/jpeg';
                    } catch (error) {
                        console.error('❌ Image optimization failed:', error.message);
                    }
                }
                
                res.setHeader('Content-Type', contentType);
                res.setHeader('Access-Control-Expose-Headers', 'X-Generated-Filename');
                if (cached && cached.filename) {
                    res.setHeader('X-Generated-Filename', cached.filename);
                }
                if (req.query.download === 'true') {
                    const extension = optimize ? 'jpg' : 'png';
                    const optimizedFilename = cached.filename.replace('.png', `.${extension}`);
                    res.setHeader('Content-Disposition', `attachment; filename="${optimizedFilename}"`);
                }
                res.send(finalBuffer);
                return;
            }
        }
        
        console.log('🔍 Building options for preset:', p);
        const opts = await buildOptions(p, null, req.query);
        const workspaceId = req.body.workspace || req.query.workspace || null;
        let result = await handleGeneration(opts, true, req.params.name, workspaceId);
        // Cache the result if generation was successful
        if (!forceGenerate) {
            const cacheKey = getPresetCacheKey(req.params.name, req.query);
        setCachedPreset(cacheKey, result.filename);
        }
        
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
        if (req.query.download === 'true') {
            const extension = optimize ? 'jpg' : 'png';
            const optimizedFilename = result.filename.replace('.png', `.${extension}`);
            res.setHeader('Content-Disposition', `attachment; filename="${optimizedFilename}"`);
        }
        res.send(finalBuffer);
    } catch(e) {
        console.error('❌ Error occurred:', e);
        res.status(500).json({ error: e.message });
    }
});

// Load character data for auto-complete

// Tag suggestions cache management
let tagSuggestionsCache = { tags: {}, queries: {} };
let cacheDirty = false;
let saveTimer = null;

// Initialize cache at startup
async function initializeCache() {
    try {
        if (fs.existsSync(cacheFile)) {
            const loadedCache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
            // Handle migration from old cache format
            if (loadedCache.tags && loadedCache.queries) {
                tagSuggestionsCache = loadedCache;
            } else {
                console.log('🔄 Migrating cache to new format...');
                tagSuggestionsCache = { tags: {}, queries: {} };
            }
            console.log(`✅ Loaded tag suggestions cache with ${Object.keys(tagSuggestionsCache.tags).length} tags`);
        } else {
            console.log('📝 Creating new tag suggestions cache');
        }
    } catch (error) {
        console.error('❌ Error loading tag suggestions cache:', error.message);
        process.exit(1);
    }

    console.log('🔄 Syncing previews...');
    await syncPreviews();

    // Initialize account data
    await initializeAccountData();
    
    // Set up periodic refreshes
    setInterval(() => initializeAccountData(), ACCOUNT_DATA_REFRESH_INTERVAL); // Check every 4 hours
    setInterval(() => refreshBalance(), BALANCE_REFRESH_INTERVAL); // Check every 15 minutes
}

// Delayed save function with atomic file operations
function scheduleCacheSave() {
    if (!cacheDirty) return;
    
    // Clear existing timer
    if (saveTimer) {
        clearTimeout(saveTimer);
    }
    
    // Schedule save in 5 minutes
    saveTimer = setTimeout(() => {
        saveCacheAtomic();
    }, 5 * 60 * 1000); // 5 minutes
}

function saveCacheAtomic() {
    if (!cacheDirty) return;
    
    const tempFile = `${cacheFile}.tmp`;
    
    try {
        // Write to temporary file first
        fs.writeFileSync(tempFile, JSON.stringify(tagSuggestionsCache, null, 2));
        
        // Delete old file if it exists
        if (fs.existsSync(cacheFile)) {
            fs.unlinkSync(cacheFile);
        }
        
        // Rename temp file to final name
        fs.renameSync(tempFile, cacheFile);
        
        cacheDirty = false;
        console.log(`💾 Tag suggestions cache saved atomically (${Object.keys(tagSuggestionsCache.tags).length} tags)`);
    } catch (error) {
        console.error('❌ Error saving tag suggestions cache:', error.message);
        
        // Clean up temp file if it exists
        if (fs.existsSync(tempFile)) {
            try {
                fs.unlinkSync(tempFile);
            } catch (cleanupError) {
                console.error('❌ Error cleaning up temp cache file:', cleanupError.message);
            }
        }
    }
}

// Test bias adjustment endpoint
app.post('/test-bias-adjustment', async (req, res) => {
    try {
        const { image_source, target_width, target_height, bias } = req.body;
        
        if (!image_source || !target_width || !target_height || !bias) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }
        
        // Load image from disk based on source
        let imagePath;
        if (image_source.startsWith('file:')) {
            imagePath = path.join(imagesDir, image_source.replace('file:', ''));
        } else if (image_source.startsWith('cache:')) {
            imagePath = path.join(uploadCacheDir, image_source.replace('cache:', ''));
        } else {
            return res.status(400).json({ error: 'Invalid image source format' });
        }
        
        // Check if file exists
        if (!fs.existsSync(imagePath)) {
            return res.status(404).json({ error: 'Image file not found' });
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
        res.status(500).json({ error: 'Failed to process bias adjustment' });
    }
});

// Upload endpoint
app.post('/workspaces/:id/images', authMiddleware, upload.array('images', 10), async (req, res) => {
    // Check if user is read-only
    if (req.userType === 'readonly') {
        return res.status(403).json({ error: 'Non-Administrator Login: This operation is not allowed for read-only users' });
    }
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No image files provided' });
        }
        
        const results = [];
        const errors = [];
        
        for (const file of req.files) {
            try {
                const filename = file.filename;
                const filePath = path.join(imagesDir, filename);
                
                // Generate preview
                const baseName = getBaseName(filename);
                const previewFile = `${baseName}.jpg`
                const blurPreviewFile = `${baseName}_blur.jpg`;
                const previewPath = path.join(previewsDir, previewFile);
                const blurPreviewPath = path.join(previewsDir, blurPreviewFile);
                
                await generatePreview(filePath, previewPath);
                console.log(`📸 Generated preview: ${previewFile}`);
                
                // Generate blurred preview
                await generateBlurredPreview(filePath, blurPreviewPath);
                console.log(`📸 Generated blurred preview: ${blurPreviewFile}`);
                
                // Add basic forge metadata for uploaded image
                const imageBuffer = fs.readFileSync(filePath);
                const forgeData = {
                    date_generated: Date.now(),
                    generation_type: 'uploaded',
                    request_type: 'upload'
                };
                const updatedBuffer = updateMetadata(imageBuffer, forgeData);
                fs.writeFileSync(filePath, updatedBuffer);
                
                console.log(`💾 Uploaded: ${filename}`);

                // Add to workspace
                addToWorkspaceArray('files', filename, req.params.id);
                
                results.push({
                    success: true,
                    filename: filename,
                    originalName: file.originalname
                });
                
            } catch (error) {
                console.error(`❌ Upload error for ${file.originalname}:`, error.message);
                errors.push({
                    filename: file.originalname,
                    error: error.message
                });
            }
        }
        
        const successCount = results.length;
        const errorCount = errors.length;
        
        res.json({ 
            success: true, 
            message: `Uploaded ${successCount} images${errorCount > 0 ? `, ${errorCount} failed` : ''}`,
            results: results,
            errors: errors,
            totalUploaded: successCount,
            totalErrors: errorCount
        });
        
    } catch(e) {
        console.error('❌ Upload error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Create context object for search functionality
const searchContext = {
    Model: Model,
    config: config,
    tagSuggestionsCache: tagSuggestionsCache,
    cacheDirty: cacheDirty,
    scheduleCacheSave,
    calculateCreditUsage,
    accountData: () => accountData,
    accountBalance: () => accountBalance
};

// Initialize WebSocket message handlers
const wsMessageHandlers = new WebSocketMessageHandlers(searchContext);

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

// Start ping interval with server data callback
wsServer.startPingInterval(() => {
    return {
        balance: accountBalance,
        queue_status: getQueueStatus(),
        image_count: imageCounter.getCount(),
        server_time: Date.now().valueOf()
    };
});

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

// Start server
(async () => {
    console.log('🚀 Initializing cache... (Server unavalible until cache is initialized)');
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
    
    server.listen(config.port, () => console.log(`Server running on port ${config.port}`));
})();

// Graceful shutdown handling
function gracefulShutdown() {
    console.log('🛑 Graceful shutdown initiated...');
    
    // Stop WebSocket ping interval
    if (wsServer) {
        console.log('🛑 Stopping WebSocket ping interval...');
        wsServer.stopPingInterval();
    }
    
    // Save cache immediately if dirty
    if (cacheDirty) {
        console.log('💾 Saving cache before shutdown...');
        saveCacheAtomic();
    }
    
    // Save metadata cache
    console.log('💾 Saving metadata cache before shutdown...');
    saveMetadataCache();
    
    process.exit(0);
}

// Register shutdown handlers
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);