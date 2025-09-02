/**
 * Custom Scrollbar Module
 * Handles custom scrollbar functionality for form-section-scroll elements
 */

class CustomScrollbar {
    constructor() {
        this.scrollbars = new Map();
        this.init();
    }

    init() {
        // Initialize existing elements
        this.initExistingElements();
        
        // Watch for new elements
        this.observeNewElements();
    }

    initExistingElements() {
        const elements = document.querySelectorAll('.form-section-scroll');
        elements.forEach(element => this.createScrollbar(element));
    }

    observeNewElements() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // Check if the added node is a form-section-scroll
                        if (node.classList && node.classList.contains('form-section-scroll')) {
                            this.createScrollbar(node);
                        }
                        // Check children of added node
                        const scrollElements = node.querySelectorAll && node.querySelectorAll('.form-section-scroll');
                        if (scrollElements) {
                            scrollElements.forEach(element => this.createScrollbar(element));
                        }
                    }
                });
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    createScrollbar(element) {
        if (this.scrollbars.has(element)) {
            return; // Already initialized
        }

        // Create scrollable content wrapper
        const content = element.firstElementChild;
        if (!content) return;

        const scrollableContent = document.createElement('div');
        scrollableContent.className = 'scrollable-content';
        
        // Move all children to the scrollable content
        while (element.firstChild) {
            scrollableContent.appendChild(element.firstChild);
        }
        element.appendChild(scrollableContent);

        // Create custom scrollbar
        const scrollbar = document.createElement('div');
        scrollbar.className = 'custom-scrollbar';
        
        const thumb = document.createElement('div');
        thumb.className = 'custom-scrollbar-thumb';
        scrollbar.appendChild(thumb);
        
        element.appendChild(scrollbar);

        // Initialize scrollbar functionality
        this.initScrollbarFunctionality(element, scrollableContent, scrollbar, thumb);
        
        // Store reference
        this.scrollbars.set(element, {
            scrollableContent,
            scrollbar,
            thumb
        });

        // Initial update
        this.updateScrollbar(element);
    }

    initScrollbarFunctionality(element, scrollableContent, scrollbar, thumb) {
        let isDragging = false;
        let startY = 0;
        let startScrollTop = 0;

        // Update scrollbar on scroll
        scrollableContent.addEventListener('scroll', () => {
            this.updateScrollbar(element);
        });

        // Mouse wheel handling - only prevent default on non-touch devices
        scrollableContent.addEventListener('wheel', (e) => {
            // Only prevent default on non-touch devices to allow touch scrolling
            if (!('ontouchstart' in window)) {
                e.preventDefault();
                const delta = e.deltaY;
                scrollableContent.scrollTop += delta;
            }
        });

        // Thumb drag handling
        thumb.addEventListener('mousedown', (e) => {
            isDragging = true;
            startY = e.clientY;
            startScrollTop = scrollableContent.scrollTop;
            
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            
            e.preventDefault();
        });

        const handleMouseMove = (e) => {
            if (!isDragging) return;
            
            const deltaY = e.clientY - startY;
            const scrollbarTrackHeight = scrollbar.offsetHeight - thumb.offsetHeight;
            const scrollRatio = deltaY / scrollbarTrackHeight;
            const maxScrollDistance = scrollableContent.scrollHeight - scrollableContent.clientHeight;
            const scrollDistance = scrollRatio * maxScrollDistance;
            
            scrollableContent.scrollTop = startScrollTop + scrollDistance;
        };

        const handleMouseUp = () => {
            isDragging = false;
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        // Track click handling
        scrollbar.addEventListener('click', (e) => {
            if (e.target === thumb) return;
            
            const rect = scrollbar.getBoundingClientRect();
            const clickY = e.clientY - rect.top;
            const scrollbarTrackHeight = scrollbar.offsetHeight - thumb.offsetHeight;
            const scrollRatio = Math.min(1, Math.max(0, clickY / scrollbarTrackHeight));
            const maxScrollDistance = scrollableContent.scrollHeight - scrollableContent.clientHeight;
            const scrollDistance = scrollRatio * maxScrollDistance;
            
            scrollableContent.scrollTop = scrollDistance;
        });

        // Touch event handling for mobile devices
        if ('ontouchstart' in window) {
            let touchStartY = 0;
            let touchStartScrollTop = 0;
            let isTouchScrolling = false;

            scrollableContent.addEventListener('touchstart', (e) => {
                touchStartY = e.touches[0].clientY;
                touchStartScrollTop = scrollableContent.scrollTop;
                isTouchScrolling = true;
            }, { passive: true });

            scrollableContent.addEventListener('touchmove', (e) => {
                if (!isTouchScrolling) return;
                
                const touchY = e.touches[0].clientY;
                const deltaY = touchStartY - touchY;
                scrollableContent.scrollTop = touchStartScrollTop + deltaY;
            }, { passive: true });

            scrollableContent.addEventListener('touchend', () => {
                isTouchScrolling = false;
            }, { passive: true });
        }

        // Resize observer to update scrollbar when content changes
        const resizeObserver = new ResizeObserver((entries) => {
            entries.forEach(entry => {
                // Check if height changed
                const newHeight = entry.contentRect.height;
                const oldHeight = this.scrollbars.get(element)?.lastHeight || 0;
                
                if (newHeight !== oldHeight) {
                    // Store the new height
                    const data = this.scrollbars.get(element);
                    if (data) {
                        data.lastHeight = newHeight;
                    }
                    
                    // Update scrollbar visibility
                    this.updateScrollbar(element);
                }
            });
        });
        resizeObserver.observe(scrollableContent);
    }

    updateScrollbar(element) {
        const data = this.scrollbars.get(element);
        if (!data) return;

        const { scrollableContent, scrollbar, thumb } = data;
        
        const scrollHeight = scrollableContent.scrollHeight;
        const clientHeight = scrollableContent.clientHeight;
        const scrollTop = scrollableContent.scrollTop;
        
        // Check if scrollbar is needed
        const needsScrollbar = scrollHeight > clientHeight;
        
        if (needsScrollbar) {
            // Calculate thumb position for static height
            const maxScrollDistance = scrollHeight - clientHeight;
            const scrollbarTrackHeight = scrollbar.offsetHeight - thumb.offsetHeight;
            const scrollRatio = maxScrollDistance > 0 ? scrollTop / maxScrollDistance : 0;
            const thumbTop = scrollRatio * scrollbarTrackHeight;
            
            // Update thumb position
            thumb.style.top = `${thumbTop}px`;
            
            // Show scrollbar
            scrollbar.classList.remove('hidden');
        } else {
            // Hide scrollbar when not needed
            scrollbar.classList.add('hidden');
        }
    }

    destroy(element) {
        const data = this.scrollbars.get(element);
        if (data) {
            // Restore original structure
            const { scrollableContent } = data;
            while (scrollableContent.firstChild) {
                element.appendChild(scrollableContent.firstChild);
            }
            element.removeChild(scrollableContent);
            
            // Remove scrollbar
            const scrollbar = element.querySelector('.custom-scrollbar');
            if (scrollbar) {
                element.removeChild(scrollbar);
            }
            
            // Restore original overflow
            element.style.overflow = 'auto';
            
            this.scrollbars.delete(element);
        }
    }

    destroyAll() {
        this.scrollbars.forEach((data, element) => {
            this.destroy(element);
        });
    }
}
window.wsClient.registerInitStep(25, 'Initializing Scrollbars', async () => {
    window.customScrollbar = new CustomScrollbar();
});

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CustomScrollbar;
}
