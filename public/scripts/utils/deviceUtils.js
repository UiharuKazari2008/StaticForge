/**
 * Device utilities for detecting mobile devices and pixel ratios
 */

// Detect if device is mobile based on screen width and user agent
function isMobileDevice() {
    // Check screen width
    const isMobileWidth = window.innerWidth <= 768;
    
    // Check user agent for mobile devices
    const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    // Check if device has touch capability
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    
    return isMobileWidth || isMobileUA || hasTouch;
}

// Get device pixel ratio
function getDevicePixelRatio() {
    return window.devicePixelRatio || 1;
}

// Check if device has high DPI display (retina)
function isHighDPIDevice() {
    return getDevicePixelRatio() > 1;
}

// Get appropriate preview URL based on device capabilities
function getPreviewUrl(basePreviewPath, options = {}) {
    const {
        forceRetina = false,
        forceMobile = false
    } = options;
    
    // Remove file extension to get base name
    const baseName = basePreviewPath.replace(/\.(jpg|jpeg|png|webp)$/i, '');
    
    // Check if we should use @2x version
    const shouldUseRetina = forceRetina || 
                           (isHighDPIDevice() && (isMobileDevice() || forceMobile));
    
    if (shouldUseRetina) {
        return `${baseName}@2x.jpg`;
    }
    
    return `${baseName}.jpg`;
}

// Get preview URL for gallery images
function getGalleryPreviewUrl(imagePreview) {
    if (!imagePreview) return '';
    
    // For gallery images, always use @2x on mobile/high-DPI devices
    return getPreviewUrl(imagePreview, { forceMobile: true });
}

// Get preview URL for cache images
function getCachePreviewUrl(cacheHash) {
    if (!cacheHash) return '';
    
    // For cache images, use @2x on high-DPI devices
    return getPreviewUrl(cacheHash, { forceRetina: true });
}

// Export functions
window.deviceUtils = {
    isMobileDevice,
    getDevicePixelRatio,
    isHighDPIDevice,
    getPreviewUrl,
    getGalleryPreviewUrl,
    getCachePreviewUrl
};

// Log device information for debugging
console.log('📱 Device Info:', {
    isMobile: isMobileDevice(),
    pixelRatio: getDevicePixelRatio(),
    isHighDPI: isHighDPIDevice(),
    screenWidth: window.innerWidth,
    userAgent: navigator.userAgent
});
