/**
 * Cache Buster Utility
 * Prevents browser caching of CSS/JS files and ensures service worker has control
 */

class CacheBuster {
    constructor() {
        this.version = Date.now();
        this.init();
    }
    
    init() {
        // Add cache-busting to existing CSS/JS tags
        this.addCacheBustingToExisting();
        
        // Monitor for new dynamically added tags
        this.observeDynamicTags();
        
        console.log('🔧 Cache buster initialized with version:', this.version);
    }
    
    // Add cache-busting parameters to existing CSS/JS tags
    addCacheBustingToExisting() {
        // CSS files
        const cssLinks = document.querySelectorAll('link[rel="stylesheet"]');
        cssLinks.forEach(link => {
            if (link.href && !this.isExternalUrl(link.href)) {
                this.addCacheBustingToElement(link, 'href');
            }
        });
        
        // JS files
        const jsScripts = document.querySelectorAll('script[src]');
        jsScripts.forEach(script => {
            if (script.src && !this.isExternalUrl(script.src)) {
                this.addCacheBustingToElement(script, 'src');
            }
        });
    }
    
    // Add cache-busting to a specific element
    addCacheBustingToElement(element, attribute) {
        const originalUrl = element[attribute];
        if (!originalUrl.includes('?v=')) {
            const separator = originalUrl.includes('?') ? '&' : '?';
            element[attribute] = `${originalUrl}${separator}v=${this.version}`;
        }
    }
    
    // Check if URL is external
    isExternalUrl(url) {
        return url.startsWith('http') && !url.includes(window.location.hostname);
    }
    
    // Monitor for dynamically added tags
    observeDynamicTags() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // Check for new CSS links
                        if (node.tagName === 'LINK' && node.rel === 'stylesheet') {
                            if (node.href && !this.isExternalUrl(node.href)) {
                                this.addCacheBustingToElement(node, 'href');
                            }
                        }
                        
                        // Check for new JS scripts
                        if (node.tagName === 'SCRIPT' && node.src) {
                            if (node.src && !this.isExternalUrl(node.src)) {
                                this.addCacheBustingToElement(node, 'src');
                            }
                        }
                        
                        // Check children of added nodes
                        const cssLinks = node.querySelectorAll && node.querySelectorAll('link[rel="stylesheet"]');
                        const jsScripts = node.querySelectorAll && node.querySelectorAll('script[src]');
                        
                        if (cssLinks) {
                            cssLinks.forEach(link => {
                                if (link.href && !this.isExternalUrl(link.href)) {
                                    this.addCacheBustingToElement(link, 'href');
                                }
                            });
                        }
                        
                        if (jsScripts) {
                            jsScripts.forEach(script => {
                                if (script.src && !this.isExternalUrl(script.src)) {
                                    this.addCacheBustingToElement(script, 'src');
                                }
                            });
                        }
                    }
                });
            });
        });
        
        observer.observe(document.head, {
            childList: true,
            subtree: true
        });
    }
    
    // Force refresh all assets
    forceRefresh() {
        this.version = Date.now();
        this.addCacheBustingToExisting();
        console.log('🔄 Cache buster refreshed with new version:', this.version);
        
        // Show toast notification
        if (typeof showGlassToast === 'function') {
            showGlassToast('info', 'Cache Busted', 'All CSS/JS files refreshed with new cache-busting parameters', false, 3000, '<i class="fas fa-sync"></i>');
        }
    }
    
    // Get current version
    getVersion() {
        return this.version;
    }
    
    // Create cache-busting URL for any file
    createCacheBustingUrl(url) {
        if (this.isExternalUrl(url)) return url;
        const separator = url.includes('?') ? '&' : '?';
        return `${url}${separator}v=${this.version}`;
    }
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.cacheBuster = new CacheBuster();
    });
} else {
    window.cacheBuster = new CacheBuster();
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CacheBuster;
}
