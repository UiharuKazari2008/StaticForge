// Global variables
let isAuthenticated = false;
let authToken = null;
let currentPage = 1;
let imagesPerPage = 12;
let allImages = [];
let presets = [];
let resolutions = [];

// Cookie helpers
function setCookie(name, value, days) {
    let expires = '';
    if (days) {
        const date = new Date();
        date.setTime(date.getTime() + (days*24*60*60*1000));
        expires = '; expires=' + date.toUTCString();
    }
    document.cookie = name + '=' + (value || '')  + expires + '; path=/';
}
function getCookie(name) {
    const nameEQ = name + '=';
    const ca = document.cookie.split(';');
    for(let i=0;i < ca.length;i++) {
        let c = ca[i];
        while (c.charAt(0)==' ') c = c.substring(1,c.length);
        if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length,c.length);
    }
    return null;
}
function eraseCookie(name) {   
    document.cookie = name+'=; Max-Age=-99999999; path=/';  
}

// DOM elements
const loginModal = document.getElementById('loginModal');
const loginButton = document.getElementById('loginButton');
const loginBtn = document.getElementById('loginBtn');
const closeLoginBtn = document.getElementById('closeLoginBtn');
const loginPassword = document.getElementById('loginPassword');
const lightboxModal = document.getElementById('lightboxModal');
const lightboxImage = document.getElementById('lightboxImage');
const closeLightbox = document.querySelector('.close-lightbox');
const closeLightboxBtn = document.getElementById('closeLightboxBtn');
const downloadBtn = document.getElementById('downloadBtn');
const generateBtn = document.getElementById('generateBtn');
const presetSelect = document.getElementById('presetSelect');
const resolutionSelect = document.getElementById('resolutionSelect');
const upscaleToggle = document.getElementById('upscaleToggle');
const gallery = document.getElementById('gallery');
const prevPage = document.getElementById('prevPage');
const nextPage = document.getElementById('nextPage');
const pageInfo = document.getElementById('pageInfo');
const loadingOverlay = document.getElementById('loadingOverlay');
const confettiContainer = document.getElementById('confettiContainer');
const controlsWrapper = document.getElementById('controlsWrapper');
const lightboxUpscaleBtn = document.getElementById('lightboxUpscaleBtn');
const lightboxRerollBtn = document.getElementById('lightboxRerollBtn');

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    // Check for auth cookie
    const cookieToken = getCookie('authToken');
    if (cookieToken) {
        isAuthenticated = true;
        authToken = cookieToken;
    }
    updateLoginButton();
    updateControlsVisibility();
    initializeApp();
    setupEventListeners();
});

// Initialize the application
async function initializeApp() {
    try {
        if (isAuthenticated) {
            await loadOptions();
        }
        await loadGallery();
        updateGenerateButton();
    } catch (error) {
        console.error('Failed to initialize app:', error);
        showError('Failed to load application data');
    }
}

// Setup event listeners
function setupEventListeners() {
    // Login modal events
    loginBtn.addEventListener('click', handleLogin);
    closeLoginBtn.addEventListener('click', hideLoginModal);
    loginPassword.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });

    // Lightbox events
    if (closeLightboxBtn) {
        closeLightboxBtn.addEventListener('click', hideLightbox);
    }
    
    if (closeLightbox) {
        closeLightbox.addEventListener('click', hideLightbox);
    }
    
    // ESC key to close lightbox and modals
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (lightboxModal.style.display === 'block') {
                hideLightbox();
            }
            if (loginModal.style.display === 'block') {
                hideLoginModal();
            }
        }
    });

    // Download button
    if (downloadBtn) {
        downloadBtn.addEventListener('click', downloadImage);
    }

    // Generation controls
    presetSelect.addEventListener('change', updateGenerateButton);
    resolutionSelect.addEventListener('change', updateGenerateButton);
    generateBtn.addEventListener('click', generateImage);

    // Pagination
    prevPage.addEventListener('click', () => changePage(-1));
    nextPage.addEventListener('click', () => changePage(1));

    // Login button
    loginButton.addEventListener('click', showLoginModal);
    
    // Close modals on outside click
    window.addEventListener('click', function(e) {
        if (e.target === loginModal) hideLoginModal();
        if (e.target === lightboxModal) hideLightbox();
    });
}

// Load options from server
async function loadOptions() {
    try {
        const response = await fetch('/options?auth=' + encodeURIComponent(getCookie('authToken')));
        if (!response.ok) throw new Error('Failed to load options');
        
        const options = await response.json();
        
        // Populate presets
        presets = options.presets;
        presetSelect.innerHTML = '<option value="">Select a preset...</option>';
        presets.forEach(preset => {
            const option = document.createElement('option');
            option.value = preset;
            option.textContent = preset;
            presetSelect.appendChild(option);
        });

        // Populate resolutions
        resolutions = Object.keys(options.resolutions);
        resolutionSelect.innerHTML = '<option value="">Select resolution...</option>';
        resolutions.forEach(resolution => {
            const option = document.createElement('option');
            option.value = resolution;
            option.textContent = resolution;
            resolutionSelect.appendChild(option);
        });

    } catch (error) {
        console.error('Error loading options:', error);
        throw error;
    }
}

// Load gallery images
async function loadGallery() {
    try {
        const response = await fetch('/images');
        if (!response.ok) throw new Error('Failed to load gallery');
        
        allImages = await response.json();
        displayCurrentPage();
    } catch (error) {
        console.error('Error loading gallery:', error);
        // Don't throw error for gallery loading failure
        allImages = [];
        displayCurrentPage();
    }
}

// Display current page of images
function displayCurrentPage() {
    const startIndex = (currentPage - 1) * imagesPerPage;
    const endIndex = startIndex + imagesPerPage;
    const pageImages = allImages.slice(startIndex, endIndex);

    gallery.innerHTML = '';

    if (pageImages.length === 0) {
        gallery.innerHTML = '<div class="no-images">No images found</div>';
        return;
    }

    pageImages.forEach(image => {
        const galleryItem = createGalleryItem(image);
        gallery.appendChild(galleryItem);
    });

    updatePagination();
}

// Create gallery item element
function createGalleryItem(image) {
    const item = document.createElement('div');
    item.className = 'gallery-item';
    
    // Use preview image
    const img = document.createElement('img');
    img.src = `/previews/${image.preview}`;
    img.alt = image.base;
    img.loading = 'lazy';
    
    const overlay = document.createElement('div');
    overlay.className = 'gallery-item-overlay';
    
    // Create info container for preset, seed, and date
    const infoContainer = document.createElement('div');
    infoContainer.className = 'gallery-item-info-container';
    
    // Extract preset name from filename (everything between timestamp and seed)
    const parts = image.base.split('_');
    const presetName = parts.length >= 3 ? parts.slice(1, -1).join('_') : 'generated';
    const seed = image.base.split('_').pop().replace('.png', '');
    const dateTime = new Date(image.mtime).toLocaleString();
    
    // Create info rows
    const presetRow = document.createElement('div');
    presetRow.className = 'gallery-info-row';
    presetRow.textContent = presetName;
    
    const seedRow = document.createElement('div');
    seedRow.className = 'gallery-info-row';
    seedRow.textContent = `Seed: ${seed}`;
    
    const dateRow = document.createElement('div');
    dateRow.className = 'gallery-info-row';
    dateRow.textContent = dateTime;
    
    infoContainer.appendChild(presetRow);
    infoContainer.appendChild(seedRow);
    infoContainer.appendChild(dateRow);
    
    overlay.appendChild(infoContainer);
    
    // Add button container
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'gallery-button-container';
    
    // Add reroll button
    const rerollBtn = document.createElement('button');
    rerollBtn.className = 'btn-primary reroll-btn';
    rerollBtn.innerHTML = '<i class="fas fa-dice"></i> Reroll';
    rerollBtn.title = 'Reroll with same settings';
    rerollBtn.onclick = (e) => {
        e.stopPropagation();
        rerollImage(image);
    };
    buttonContainer.appendChild(rerollBtn);
    
    // Add upscale button if image is not upscaled
    if (!image.upscaled && image.original) {
        const upscaleBtn = document.createElement('button');
        upscaleBtn.className = 'btn-primary upscale-btn';
        upscaleBtn.innerHTML = '<i class="fas fa-expand"></i> Upscale';
        upscaleBtn.title = 'Upscale image';
        upscaleBtn.onclick = (e) => {
            e.stopPropagation();
            upscaleImage(image);
        };
        buttonContainer.appendChild(upscaleBtn);
    }
    
    overlay.appendChild(buttonContainer);
    
    item.appendChild(img);
    item.appendChild(overlay);
    
    // Click to show lightbox - prefer upscaled version
    item.addEventListener('click', () => {
        const imageToShow = {
            filename: image.upscaled || image.original,
            base: image.base,
            upscaled: image.upscaled
        };
        showLightbox(imageToShow);
    });
    
    return item;
}

// Reroll an image with the same settings
async function rerollImage(image) {
    if (!isAuthenticated) {
        showError('Please login first');
        return;
    }

    try {
        // Get metadata from the image
        const response = await fetch(`/metadata/${image.original}?auth=${encodeURIComponent(getCookie('authToken'))}`);
        
        if (!response.ok) {
            throw new Error('Failed to load image metadata');
        }

        const metadata = await response.json();
        
        if (!metadata) {
            throw new Error('No metadata found for this image');
        }

        // Extract preset name from filename
        const parts = image.base.split('_');
        const presetName = parts.length >= 3 ? parts.slice(1, -1).join('_') : 'generated';
        
        // Show loading
        showLoading(true);

        // Generate new image using the generate endpoint
        const generateResponse = await fetch(`/${metadata.model}/generate?auth=${encodeURIComponent(getCookie('authToken'))}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                prompt: metadata.prompt,
                uc: metadata.uc,
                steps: metadata.steps,
                scale: metadata.scale,
                cfg_rescale: metadata.cfg_rescale,
                sampler: metadata.sampler,
                noise_schedule: metadata.noise_schedule,
                resolution: metadata.resolution,
                preset: presetName
            })
        });

        if (!generateResponse.ok) {
            throw new Error(`Generation failed: ${generateResponse.statusText}`);
        }

        const blob = await generateResponse.blob();
        
        showLoading(false);
        showSuccess('Image rerolled successfully!');
        createConfetti();
        
        // Reload gallery to show new image
        await loadGallery();
        
        // Find the newly generated image (it should be the first one since it's the most recent)
        if (allImages.length > 0) {
            const newImage = allImages[0]; // Most recent image
            showLightbox(newImage);
        }

    } catch (error) {
        console.error('Reroll error:', error);
        showLoading(false);
        showError('Reroll failed: ' + error.message);
    }
}

// Upscale an image
async function upscaleImage(image) {
    if (!isAuthenticated) {
        showError('Please login first');
        return;
    }

    // Show upscaling dialog
    showUpscalingDialog();

    try {
        const response = await fetch(`/upscale/${image.original}?auth=${encodeURIComponent(getCookie('authToken'))}`, {
            method: 'POST'
        });
        
        if (!response.ok) {
            throw new Error(`Upscaling failed: ${response.statusText}`);
        }

        const blob = await response.blob();
        const imageUrl = URL.createObjectURL(blob);
        
        // Hide upscaling dialog
        hideUpscalingDialog();
        
        // Show success message
        showSuccess('Image upscaled successfully!');
        
        // Reload gallery to show new upscaled image
        await loadGallery();
        
        // Show the upscaled image in lightbox
        const upscaledImage = {
            filename: image.original.replace('.png', '_upscaled.png'),
            base: image.base,
            upscaled: true,
            url: imageUrl
        };
        showLightbox(upscaledImage);
        
    } catch (error) {
        console.error('Upscaling error:', error);
        hideUpscalingDialog();
        showError('Image upscaling failed. Please try again.');
    }
}

// Show upscaling dialog
function showUpscalingDialog() {
    const dialog = document.createElement('div');
    dialog.id = 'upscalingDialog';
    dialog.className = 'modal';
    dialog.style.display = 'block';
    dialog.innerHTML = `
        <div class="modal-content">
            <div class="loading-content">
                <div class="spinner"></div>
                <p>Upscaling image...</p>
                <p style="font-size: 0.9rem; color: #ccc;">This may take a few moments</p>
            </div>
        </div>
    `;
    document.body.appendChild(dialog);
}

// Hide upscaling dialog
function hideUpscalingDialog() {
    const dialog = document.getElementById('upscalingDialog');
    if (dialog) {
        dialog.remove();
    }
}

// Update pagination controls
function updatePagination() {
    const totalPages = Math.ceil(allImages.length / imagesPerPage);
    
    prevPage.disabled = currentPage <= 1;
    nextPage.disabled = currentPage >= totalPages;
    
    pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
}

// Change page
function changePage(delta) {
    const newPage = currentPage + delta;
    const totalPages = Math.ceil(allImages.length / imagesPerPage);
    
    if (newPage >= 1 && newPage <= totalPages) {
        currentPage = newPage;
        displayCurrentPage();
    }
}

// Show login modal
function showLoginModal() {
    loginModal.style.display = 'block';
    loginPassword.focus();
}

// Hide login modal
function hideLoginModal() {
    loginModal.style.display = 'none';
    loginPassword.value = '';
}

// Handle login
async function handleLogin() {
    const password = loginPassword.value.trim();
    if (!password) {
        showError('Please enter a password');
        return;
    }

    try {
        // Test authentication with a simple request
        const response = await fetch('/options?auth=' + encodeURIComponent(password));
        if (response.ok) {
            isAuthenticated = true;
            setCookie('authToken', password, 7);
            authToken = password;
            hideLoginModal();
            updateLoginButton();
            updateControlsVisibility();
            showSuccess('Login successful!');
            await loadOptions();
            updateGenerateButton();
        } else {
            showError('Invalid password');
        }
    } catch (error) {
        console.error('Login error:', error);
        showError('Login failed. Please try again.');
    }
}

// Update login button
function updateLoginButton() {
    if (isAuthenticated) {
        loginButton.innerHTML = '<i class="fas fa-sign-out-alt"></i> Logout';
        loginButton.onclick = logout;
    } else {
        loginButton.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login';
        loginButton.onclick = showLoginModal;
    }
}

// Show/hide controls based on login
function updateControlsVisibility() {
    if (isAuthenticated) {
        controlsWrapper.style.display = '';
    } else {
        controlsWrapper.style.display = 'none';
    }
}

// Logout
function logout() {
    isAuthenticated = false;
    authToken = null;
    eraseCookie('authToken');
    updateLoginButton();
    updateControlsVisibility();
    updateGenerateButton();
    showSuccess('Logged out successfully');
}

// Update generate button state
function updateGenerateButton() {
    if (!isAuthenticated) {
        generateBtn.disabled = true;
        return;
    }
    const hasPreset = presetSelect.value !== '';
    const hasResolution = resolutionSelect.value !== '';
    const canGenerate = isAuthenticated && hasPreset && hasResolution;
    generateBtn.disabled = !canGenerate;
}

// Generate image
async function generateImage() {
    if (!isAuthenticated) {
        showError('Please login first');
        return;
    }

    const preset = presetSelect.value;
    const resolution = resolutionSelect.value;
    const upscale = upscaleToggle.checked;

    if (!preset || !resolution) {
        showError('Please select both preset and resolution');
        return;
    }

    showLoading(true);

    try {
        const url = `/preset/${preset}/${resolution}?auth=${encodeURIComponent(getCookie('authToken'))}&forceGenerate=true${upscale ? '&upscale=true' : ''}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Generation failed: ${response.statusText}`);
        }

        const blob = await response.blob();
        const imageUrl = URL.createObjectURL(blob);
        
        // Create a temporary image to get dimensions
        const img = new Image();
        img.onload = function() {
            const generatedImage = {
                filename: `generated_${Date.now()}.png`,
                width: img.width,
                height: img.height,
                url: imageUrl
            };
            
            showLightbox(generatedImage);
            createConfetti();
            showSuccess('Image generated successfully!');
            
            // Refresh gallery after a short delay
            setTimeout(() => {
                loadGallery();
            }, 1000);
        };
        img.src = imageUrl;

    } catch (error) {
        console.error('Generation error:', error);
        showError('Image generation failed. Please try again.');
    } finally {
        showLoading(false);
    }
}

// Show lightbox
async function showLightbox(image) {
    if (image.url) {
        lightboxImage.src = image.url;
    } else {
        lightboxImage.src = `/images/${image.filename}`;
    }
    
    lightboxModal.style.display = 'block';
    
    // Prevent body scrolling
    document.body.style.overflow = 'hidden';
    
    // Store current image for download
    lightboxImage.dataset.filename = image.filename;
    lightboxImage.dataset.url = image.url;
    lightboxImage.dataset.base = image.base;
    lightboxImage.dataset.upscaled = image.upscaled ? 'true' : '';

    // Show/hide reroll button in lightbox
    if (lightboxRerollBtn) {
        if (image.filename && !image.filename.includes('_upscaled')) {
            lightboxRerollBtn.style.display = '';
            lightboxRerollBtn.onclick = function() {
                // Find the gallery image object by base name
                const galleryImage = allImages.find(img => img.base === image.base);
                if (galleryImage) {
                    rerollImage(galleryImage);
                    hideLightbox();
                }
            };
        } else {
            lightboxRerollBtn.style.display = 'none';
            lightboxRerollBtn.onclick = null;
        }
    }

    // Show/hide upscale button in lightbox
    if (lightboxUpscaleBtn) {
        if (!image.upscaled && image.filename && !image.filename.includes('_upscaled')) {
            lightboxUpscaleBtn.style.display = '';
            lightboxUpscaleBtn.onclick = function() {
                // Find the gallery image object by base name
                const galleryImage = allImages.find(img => img.base === image.base);
                if (galleryImage) {
                    upscaleImage(galleryImage);
                    hideLightbox();
                }
            };
        } else {
            lightboxUpscaleBtn.style.display = 'none';
            lightboxUpscaleBtn.onclick = null;
        }
    }

    // Load and display metadata
    await loadAndDisplayMetadata(image.filename);
}

// Helper: Format resolution name for display
function formatResolution(resolution) {
    if (!resolution) return '';
    
    // Convert snake_case to Title Case
    return resolution
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

// Load and display metadata
async function loadAndDisplayMetadata(filename) {
    const metadataDiv = document.getElementById('lightboxMetadata');
    const metadataContent = document.getElementById('metadataContent');
    
    try {
        const response = await fetch(`/metadata/${filename}?auth=${encodeURIComponent(getCookie('authToken'))}`);
        
        if (response.ok) {
            const metadata = await response.json();
            
            if (metadata && Object.keys(metadata).length > 0) {
                // Display metadata
                let html = '';
                
                // Define field mappings for better labels
                const fieldMappings = {
                    'prompt': 'Prompt',
                    'uc': 'Undesired Content',
                    'model_display_name': 'Model',
                    'steps': 'Steps',
                    'scale': 'Prompt Guidance',
                    'cfg_rescale': 'Prompt Guidance Rescale',
                    'sampler': 'Sampler',
                    'noise_schedule': 'Noise Schedule',
                    'seed': 'Seed',
                    'resolution': 'Resolution',
                    'width': 'Width',
                    'height': 'Height'
                };
                
                // Display key metadata fields in order
                const keyFields = ['prompt', 'uc', 'model_display_name', 'steps', 'scale', 'cfg_rescale', 'sampler', 'noise_schedule', 'seed'];
                
                keyFields.forEach(field => {
                    if (metadata[field] !== undefined && metadata[field] !== null) {
                        html += `<div class="metadata-item">`;
                        html += `<span class="metadata-label">${fieldMappings[field] || field.replace('_', ' ')}:</span>`;
                        
                        if (field === 'prompt' || field === 'uc') {
                            html += `<span class="metadata-value ${field}">${metadata[field]}</span>`;
                        } else {
                            html += `<span class="metadata-value">${metadata[field]}</span>`;
                        }
                        
                        html += `</div>`;
                    }
                });
                
                // Handle resolution vs width/height
                if (metadata.resolution) {
                    html += `<div class="metadata-item">`;
                    html += `<span class="metadata-label">Resolution:</span>`;
                    html += `<span class="metadata-value">${formatResolution(metadata.resolution)}</span>`;
                    html += `</div>`;
                } else if (metadata.width && metadata.height) {
                    html += `<div class="metadata-item">`;
                    html += `<span class="metadata-label">Dimensions:</span>`;
                    html += `<span class="metadata-value">${metadata.width} × ${metadata.height}</span>`;
                    html += `</div>`;
                }
                
                // Display source/software info if available
                if (metadata.source) {
                    html += `<div class="metadata-item">`;
                    html += `<span class="metadata-label">Source:</span>`;
                    html += `<span class="metadata-value">${metadata.source}</span>`;
                    html += `</div>`;
                }
                
                if (metadata.software) {
                    html += `<div class="metadata-item">`;
                    html += `<span class="metadata-label">Software:</span>`;
                    html += `<span class="metadata-value">${metadata.software}</span>`;
                    html += `</div>`;
                }
                
                metadataContent.innerHTML = html;
                metadataDiv.style.display = 'block';
            } else {
                metadataDiv.style.display = 'none';
            }
        } else {
            metadataDiv.style.display = 'none';
        }
    } catch (error) {
        console.error('Error loading metadata:', error);
        metadataDiv.style.display = 'none';
    }
}

// Hide lightbox
function hideLightbox() {
    lightboxModal.style.display = 'none';
    lightboxImage.src = '';
    
    // Restore body scrolling
    document.body.style.overflow = '';
    
    // Clear metadata
    const metadataDiv = document.getElementById('lightboxMetadata');
    const metadataContent = document.getElementById('metadataContent');
    if (metadataDiv) metadataDiv.style.display = 'none';
    if (metadataContent) metadataContent.innerHTML = '';
    
    if (lightboxUpscaleBtn) {
        lightboxUpscaleBtn.style.display = 'none';
        lightboxUpscaleBtn.onclick = null;
    }
    
    if (lightboxRerollBtn) {
        lightboxRerollBtn.style.display = 'none';
        lightboxRerollBtn.onclick = null;
    }
}

// Download image
function downloadImage() {
    const filename = lightboxImage.dataset.filename;
    const url = lightboxImage.dataset.url;
    
    if (url) {
        // For newly generated images
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
    } else {
        // For existing images
        const link = document.createElement('a');
        link.href = `/images/${filename}?download=true`;
        link.download = filename;
        link.click();
    }
}

// Create confetti effect
function createConfetti() {
    const colors = ['#ff4500', '#ff6347', '#ff8c00', '#ffa500'];
    
    for (let i = 0; i < 50; i++) {
        setTimeout(() => {
            const confetti = document.createElement('div');
            confetti.className = 'confetti';
            confetti.style.left = Math.random() * 100 + 'vw';
            confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            confetti.style.width = (Math.random() * 10 + 5) + 'px';
            confetti.style.height = (Math.random() * 10 + 5) + 'px';
            
            confettiContainer.appendChild(confetti);
            
            // Remove confetti after animation
            setTimeout(() => {
                if (confetti.parentNode) {
                    confetti.parentNode.removeChild(confetti);
                }
            }, 3000);
        }, i * 50);
    }
}

// Show loading overlay
function showLoading(show) {
    if (show) {
        loadingOverlay.classList.remove('hidden');
    } else {
        loadingOverlay.classList.add('hidden');
    }
}

// Show success message
function showSuccess(message) {
    // Simple success notification
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(45deg, #ff4500, #ff6347);
        color: white;
        padding: 15px 20px;
        border-radius: 5px;
        z-index: 3000;
        font-weight: 600;
        box-shadow: 0 5px 15px rgba(255, 69, 0, 0.3);
        animation: slideIn 0.3s ease;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 3000);
}

// Show error message
function showError(message) {
    // Simple error notification
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #dc3545;
        color: white;
        padding: 15px 20px;
        border-radius: 5px;
        z-index: 3000;
        font-weight: 600;
        box-shadow: 0 5px 15px rgba(220, 53, 69, 0.3);
        animation: slideIn 0.3s ease;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 4000);
}

// Add CSS animations for notifications
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
    
    .no-images {
        grid-column: 1 / -1;
        text-align: center;
        padding: 50px;
        color: #666;
        font-size: 1.2rem;
    }
    
    .upscale-btn {
        font-size: 0.9rem;
        padding: 8px 16px;
    }
`;
document.head.appendChild(style); 