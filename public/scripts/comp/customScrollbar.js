/**
 * Custom Scrollbar Module
 * Handles custom scrollbar functionality for any element with data-custom-scrollbar attribute
 * Also supports backward compatibility with .form-section-scroll class
 */

class CustomScrollbar {
    constructor() {
        this.scrollbars = new Map();
        this.maxScrollCache = new WeakMap(); // Cache max scroll values to avoid recalculating
        this.init();
    }

    init() {
        // Initialize existing elements
        this.initExistingElements();

        // Watch for new elements
        this.observeNewElements();
    }

    initExistingElements() {
        // Support both data attribute and legacy class for backward compatibility
        const dataAttrElements = document.querySelectorAll('[data-custom-scrollbar]');
        const classElements = document.querySelectorAll('.form-section-scroll:not([data-custom-scrollbar])');

        dataAttrElements.forEach(element => this.createScrollbar(element));
        classElements.forEach(element => this.createScrollbar(element));
    }

    // Check if an element should have a custom scrollbar
    shouldHaveScrollbar(element) {
        return element.hasAttribute('data-custom-scrollbar') ||
            (element.classList && element.classList.contains('form-section-scroll'));
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
                // Handle added nodes
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // Check if the added node should have a scrollbar
                        if (this.shouldHaveScrollbar(node)) {
                            this.createScrollbar(node);
                        }
                        // Check children of added node
                        const dataAttrElements = node.querySelectorAll && node.querySelectorAll('[data-custom-scrollbar]');
                        const classElements = node.querySelectorAll && node.querySelectorAll('.form-section-scroll:not([data-custom-scrollbar])');

                        if (dataAttrElements) {
                            dataAttrElements.forEach(element => this.createScrollbar(element));
                        }
                        if (classElements) {
                            classElements.forEach(element => this.createScrollbar(element));
                        }
                    }
                });

                // Handle attribute changes (e.g., when hidden class is removed from modal)
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    const target = mutation.target;
                    // Check if a modal was just shown (hidden class removed)
                    if (target.classList && target.classList.contains('modal') && !target.classList.contains('hidden')) {
                        // Look for scrollbar-enabled elements inside this modal
                        const dataAttrElements = target.querySelectorAll && target.querySelectorAll('[data-custom-scrollbar]');
                        if (dataAttrElements) {
                            dataAttrElements.forEach(element => {
                                if (!this.scrollbars.has(element)) {
                                    this.createScrollbar(element);
                                }
                            });
                        }
                    }
                }
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });
    }

    createScrollbar(element) {
        if (this.scrollbars.has(element)) {
            return; // Already initialized
        }

        // Create scrollable content wrapper
        const content = element.firstElementChild;
        if (!content) return;

        // Get custom wrapper class from data attribute, or default to 'scrollable-content'
        const customWrapperClass = element.dataset.scrollableWrapperClass || 'scrollable-content';

        const scrollableContent = document.createElement('div');
        // Always include 'scrollable-content' for base styles, plus custom class if specified
        scrollableContent.className = customWrapperClass === 'scrollable-content'
            ? 'scrollable-content'
            : `scrollable-content ${customWrapperClass}`;

        // Add class to element BEFORE accessing scroll properties to prevent browser from setting overflow: auto
        // This must happen before any scrollHeight/scrollTop access
        element.classList.add('has-custom-scrollbar');

        // Move all children to the scrollable content
        while (element.firstChild) {
            scrollableContent.appendChild(element.firstChild);
        }
        element.appendChild(scrollableContent);

        // Ensure scrollable-content uses full height
        // Force it to take up 100% of parent height
        scrollableContent.style.height = '100%';
        scrollableContent.style.minHeight = '100%';

        // Create custom scrollbar
        const scrollbar = document.createElement('div');
        scrollbar.className = 'custom-scrollbar';

        const thumb = document.createElement('div');
        thumb.className = 'custom-scrollbar-thumb';
        scrollbar.appendChild(thumb);

        element.appendChild(scrollbar);

        // Initialize scrollbar functionality
        this.initScrollbarFunctionality(element, scrollableContent, scrollbar, thumb, customWrapperClass);

        // Store reference
        this.scrollbars.set(element, {
            scrollableContent,
            scrollbar,
            thumb,
            wrapperClass: customWrapperClass
        });

        // Initial update - use requestAnimationFrame to ensure layout is complete
        requestAnimationFrame(() => {
            this.updateScrollbar(element);
        });
    }

    initScrollbarFunctionality(element, scrollableContent, scrollbar, thumb, wrapperClass = 'scrollable-content') {
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
                const isInnermostScrollable = this.isInnermostScrollable(scrollableContent, e.target, wrapperClass);
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
                    const maxScrollDistance = this.getMaxScrollDistance(scrollableContent);
                    const atBottom = scrollTop >= maxScrollDistance;
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

        // Touch drag handling for thumb
        thumb.addEventListener('touchstart', (e) => {
            isDragging = true;
            startY = e.touches[0].clientY;
            startScrollTop = scrollableContent.scrollTop;

            document.addEventListener('touchmove', handleTouchMove, { passive: false });
            document.addEventListener('touchend', handleTouchEnd);

            e.preventDefault(); // Prevent scrolling the page while dragging scrollbar
        }, { passive: false });

        const handleMouseMove = (e) => {
            if (!isDragging) return;

            const deltaY = e.clientY - startY;
            const scrollbarTrackHeight = scrollbar.offsetHeight - thumb.offsetHeight;
            const scrollRatio = deltaY / scrollbarTrackHeight;
            const maxScrollDistance = this.getMaxScrollDistance(scrollableContent);
            const scrollDistance = scrollRatio * maxScrollDistance;
            const targetScrollTop = startScrollTop + scrollDistance;

            scrollableContent.scrollTop = Math.max(0, targetScrollTop);
        };

        const handleMouseUp = () => {
            isDragging = false;
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        const handleTouchMove = (e) => {
            if (!isDragging) return;

            e.preventDefault(); // Prevent scrolling

            const deltaY = e.touches[0].clientY - startY;
            const scrollbarTrackHeight = scrollbar.offsetHeight - thumb.offsetHeight;
            const scrollRatio = deltaY / scrollbarTrackHeight;
            const maxScrollDistance = this.getMaxScrollDistance(scrollableContent);
            const scrollDistance = scrollRatio * maxScrollDistance;
            const targetScrollTop = startScrollTop + scrollDistance;

            scrollableContent.scrollTop = Math.max(0, targetScrollTop);
        };

        const handleTouchEnd = () => {
            isDragging = false;
            document.removeEventListener('touchmove', handleTouchMove);
            document.removeEventListener('touchend', handleTouchEnd);
        };

        // Track click handling
        scrollbar.addEventListener('click', (e) => {
            if (e.target === thumb) return;

            const rect = scrollbar.getBoundingClientRect();
            const clickY = e.clientY - rect.top;
            const scrollbarTrackHeight = scrollbar.offsetHeight - thumb.offsetHeight;
            const scrollRatio = Math.min(1, Math.max(0, clickY / scrollbarTrackHeight));
            const maxScrollDistance = this.getMaxScrollDistance(scrollableContent);
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
                const isInnermostScrollable = this.isInnermostScrollable(scrollableContent, e.target, wrapperClass);
                if (isInnermostScrollable) {
                    const touchY = e.touches[0].clientY;
                    const deltaY = touchStartY - touchY;
                    const scrollHeight = scrollableContent.scrollHeight;
                    const clientHeight = scrollableContent.clientHeight;
                    const currentScrollTop = scrollableContent.scrollTop;

                    const canScrollVertically = scrollHeight > clientHeight;

                    const atTop = currentScrollTop <= 0;
                    const maxScrollDistance = this.getMaxScrollDistance(scrollableContent);
                    const atBottom = currentScrollTop >= maxScrollDistance;
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

        // Resize observer to update scrollbar when content or container changes
        const resizeObserver = new ResizeObserver(() => {
            // Clear cache when size changes
            this.maxScrollCache.delete(scrollableContent);
            // Update scrollbar on any resize event - content or container size changes
            this.updateScrollbar(element);
        });

        // Only observe scrollableContent, not the parent element
        resizeObserver.observe(scrollableContent);

        // Mutation observer to watch for content changes that might affect scrollability
        const mutationObserver = new MutationObserver(() => {
            // Clear cache when content changes
            this.maxScrollCache.delete(scrollableContent);
            // Update scrollbar when content is added, removed, or modified
            this.updateScrollbar(element);
        });

        // Observe child additions/removals and subtree changes
        mutationObserver.observe(scrollableContent, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true
        });
    }

    // Helper function to get max scroll distance
    // This ensures we can scroll into all padding by using the actual scrollable area
    getMaxScrollDistance(scrollableContent) {
        // Get the actual scroll dimensions
        const scrollHeight = scrollableContent.scrollHeight;
        const clientHeight = scrollableContent.clientHeight;
        let maxScroll = Math.max(0, scrollHeight - clientHeight);
        const savedScrollTop = scrollableContent.scrollTop;
        scrollableContent.scrollTop = 999999;
        const actualMax = scrollableContent.scrollTop;
        scrollableContent.scrollTop = savedScrollTop;

        return Math.max(maxScroll, actualMax);
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

        // Update scroll state classes
        if (needsScrollbar) {
            // Add scroll-ready class when content is scrollable
            element.classList.add('scroll-ready');

            // Get max scroll distance (scrollHeight already includes padding)
            const maxScrollDistance = this.getMaxScrollDistance(scrollableContent);

            // Check scroll position for top/bottom classes
            // For atBottom, we need to check against the actual maximum the browser allows
            // Use a small tolerance (1px) to account for rounding
            const atTop = scrollTop <= 0;
            const actualMaxScroll = scrollableContent.scrollHeight - scrollableContent.clientHeight;
            const atBottom = scrollTop >= (actualMaxScroll - 1);

            if (atTop) {
                element.classList.add('scroll-top');
            } else {
                element.classList.remove('scroll-top');
            }

            if (atBottom) {
                element.classList.add('scroll-end');
            } else {
                element.classList.remove('scroll-end');
            }

            // Calculate thumb position for static height
            const thumbHeight = 80; // Height of the scrollbar thumb in pixels
            const scrollbarTrackHeight = scrollbar.offsetHeight;
            const maxThumbPosition = scrollbarTrackHeight - thumbHeight;

            // Clamp scrollRatio between 0 and 1
            const scrollRatio = maxScrollDistance > 0
                ? Math.max(0, Math.min(1, scrollTop / maxScrollDistance))
                : 0;

            // Update thumb position
            const isReversed = element.classList.contains('reverse-scroll');
            if (isReversed) {
                // Clamp thumbTop to not exceed maxThumbPosition (negative for reversed)
                const thumbTop = Math.max(-maxThumbPosition, Math.min(0, -1 * (scrollRatio * maxThumbPosition)));
                // For reversed scrollbars, use bottom positioning
                thumb.style.bottom = `${thumbTop}px`;
                thumb.style.top = 'auto';
            } else {
                // Clamp thumbTop to not exceed maxThumbPosition
                const thumbTop = Math.max(0, Math.min(maxThumbPosition, scrollRatio * maxThumbPosition));
                // For normal scrollbars, use top positioning
                thumb.style.top = `${thumbTop}px`;
                thumb.style.bottom = 'auto';
            }

            // Show scrollbar
            scrollbar.classList.remove('hidden');
        } else {
            // Remove all scroll state classes when not scrollable
            element.classList.remove('scroll-ready', 'scroll-top', 'scroll-end');

            // Hide scrollbar when not needed
            scrollbar.classList.add('hidden');
        }
    }

    // Check if this scrollable element is the innermost one relative to the event target
    isInnermostScrollable(scrollableContent, eventTarget, wrapperClass = 'scrollable-content') {
        const scrollableElements = [];
        let currentElement = eventTarget;

        // Collect all registered scrollable content wrappers in the path
        while (currentElement && currentElement !== document.body) {
            for (const [parentElement, data] of this.scrollbars.entries()) {
                if (data.scrollableContent === currentElement) {
                    scrollableElements.push(currentElement);
                    break;
                }
            }
            currentElement = currentElement.parentElement;
        }

        // If there's only one scrollable element, it's the innermost
        if (scrollableElements.length <= 1) {
            return true;
        }

        // Check if our scrollable content is the innermost one (first in the array)
        return scrollableElements[0] === scrollableContent;
    }

    destroy(element) {
        const data = this.scrollbars.get(element);
        if (data) {
            try {
                // Restore original structure
                const { scrollableContent } = data;

                // Clear cache for this scrollable content
                this.maxScrollCache.delete(scrollableContent);

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

                // Remove has-custom-scrollbar class to restore original CSS behavior
                element.classList.remove('has-custom-scrollbar');
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
