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

    // Force re-initialization of a specific element (useful when content is added dynamically)
    forceReinit(element) {
        try {
            // Check if element exists and has content
            if (!element || !element.firstElementChild) {
                console.debug('Skipping scrollbar reinit: element is empty or doesn\'t exist');
                return;
            }

            // Destroy existing scrollbar if it exists
            if (this.scrollbars.has(element)) {
                this.destroy(element);
            }

            // Re-create the scrollbar
            this.createScrollbar(element);
        } catch (error) {
            console.warn('Error during scrollbar force reinit:', error);
        }
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
                // Check if this is the innermost scrollable element to prevent conflicts
                const isInnermostScrollable = this.isInnermostScrollable(scrollableContent, e.target);
                if (isInnermostScrollable) {
                    // Check if this element actually needs scrolling and can scroll in the current direction
                    const scrollHeight = scrollableContent.scrollHeight;
                    const clientHeight = scrollableContent.clientHeight;
                    const scrollTop = scrollableContent.scrollTop;
                    const delta = e.deltaY;

                    // Check if scrolling is possible at all
                    const canScrollVertically = scrollHeight > clientHeight;

                    // Check if we can scroll in the requested direction
                    const atTop = scrollTop <= 0;
                    const atBottom = scrollTop >= scrollHeight - clientHeight;
                    const scrollingUp = delta < 0; // negative delta = scrolling up
                    const canScrollInDirection = (scrollingUp && !atTop) || (!scrollingUp && !atBottom);

                    if (canScrollVertically && canScrollInDirection) {
                        // If this element can scroll in the requested direction, prevent the event from bubbling to outer areas
                        e.preventDefault();
                        e.stopPropagation();
                        scrollableContent.scrollTop += delta;
                    }
                }
            }
        }, { passive: false });

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

                // Check if this is the innermost scrollable element to prevent conflicts
                const isInnermostScrollable = this.isInnermostScrollable(scrollableContent, e.target);
                if (isInnermostScrollable) {
                    const touchY = e.touches[0].clientY;
                    const deltaY = touchStartY - touchY;
                    const scrollHeight = scrollableContent.scrollHeight;
                    const clientHeight = scrollableContent.clientHeight;
                    const currentScrollTop = scrollableContent.scrollTop;
                    
                    const canScrollVertically = scrollHeight > clientHeight;
                    
                    const atTop = currentScrollTop <= 0;
                    const atBottom = currentScrollTop >= scrollHeight - clientHeight;
                    const scrollingUp = deltaY < 0; // dragging up = scroll down
                    const canScrollInDirection = (scrollingUp && !atTop) || (!scrollingUp && !atBottom);

                    if (canScrollVertically && canScrollInDirection) {
                        // If this element can scroll in the requested direction, prevent the event from bubbling to outer areas
                        e.stopPropagation();
                        scrollableContent.scrollTop = touchStartScrollTop + deltaY;
                    }
                }
            }, { passive: false });

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
            
            // Update thumb position
            const isReversed = element.classList.contains('reverse-scroll');
            if (isReversed) {
                const thumbTop = -1 * (scrollRatio * scrollbarTrackHeight);
                // For reversed scrollbars, use bottom positioning
                thumb.style.bottom = `${thumbTop}px`;
                thumb.style.top = 'auto';
            } else {
                const thumbTop = scrollRatio * scrollbarTrackHeight;
                // For normal scrollbars, use top positioning
                thumb.style.top = `${thumbTop}px`;
                thumb.style.bottom = 'auto';
            }
            
            // Show scrollbar
            scrollbar.classList.remove('hidden');
        } else {
            // Hide scrollbar when not needed
            scrollbar.classList.add('hidden');
        }
    }

    // Check if this scrollable element is the innermost one relative to the event target
    isInnermostScrollable(scrollableContent, eventTarget) {
        // Find all scrollable elements that contain the event target
        const scrollableElements = [];
        let currentElement = eventTarget;

        while (currentElement && currentElement !== document.body) {
            if (currentElement.classList && currentElement.classList.contains('scrollable-content')) {
                scrollableElements.push(currentElement);
            }
            currentElement = currentElement.parentElement;
        }

        // If there's only one scrollable element, it's the innermost
        if (scrollableElements.length <= 1) {
            return true;
        }

        // Check if our scrollable content is the innermost one
        return scrollableElements[0] === scrollableContent;
    }

    destroy(element) {
        const data = this.scrollbars.get(element);
        if (data) {
            try {
                // Restore original structure
                const { scrollableContent } = data;
                while (scrollableContent.firstChild) {
                    element.appendChild(scrollableContent.firstChild);
                }

                // Only remove scrollableContent if it's actually a child of element
                if (scrollableContent.parentNode === element) {
                    element.removeChild(scrollableContent);
                }

                // Remove scrollbar only if it exists and is a child of element
                const scrollbar = element.querySelector('.custom-scrollbar');
                if (scrollbar && scrollbar.parentNode === element) {
                    element.removeChild(scrollbar);
                }

                // Restore original overflow
                element.style.overflow = 'auto';
            } catch (error) {
                console.warn('Error during scrollbar destruction:', error);
            } finally {
                // Always remove from the map to prevent future issues
                this.scrollbars.delete(element);
            }
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
