/**
 * Custom Scrollbar Module
 * Handles custom scrollbar functionality for any element with data-custom-scrollbar attribute
 * Also supports backward compatibility with .form-section-scroll class
 */

class CustomScrollbar {
    constructor() {
        this.scrollbars = new Map();
        this.maxScrollCache = new WeakMap(); // Cache max scroll values to avoid recalculating
        this._updateRafIds = new WeakMap();
        this._layoutBatchDepth = 0;
        this._layoutBatchPending = new Set();
        this._layoutSettling = false;
        this._layoutSettleRafId = null;
        this.init();
    }

    beginLayoutBatch() {
        this._layoutBatchDepth++;
        this._layoutSettling = true;
        if (this._layoutSettleRafId) {
            cancelAnimationFrame(this._layoutSettleRafId);
            this._layoutSettleRafId = null;
        }
    }

    endLayoutBatch() {
        if (this._layoutBatchDepth <= 0) return;
        this._layoutBatchDepth--;
        if (this._layoutBatchDepth > 0) return;

        const pending = Array.from(this._layoutBatchPending);
        this._layoutBatchPending.clear();
        pending.forEach((element) => {
            this._cancelScheduledUpdate(element);
            this._updateScrollbarNow(element);
        });
        this._scheduleLayoutSettleFlush();
    }

    _scheduleLayoutSettleFlush() {
        if (this._layoutSettleRafId) return;
        // ResizeObserver delivers after sync layout; wait two frames then apply scroll-state once.
        this._layoutSettleRafId = requestAnimationFrame(() => {
            this._layoutSettleRafId = requestAnimationFrame(() => {
                this._layoutSettleRafId = null;
                if (this._layoutBatchDepth > 0) {
                    this._scheduleLayoutSettleFlush();
                    return;
                }
                const latePending = Array.from(this._layoutBatchPending);
                this._layoutBatchPending.clear();
                this._layoutSettling = false;
                latePending.forEach((element) => {
                    this._cancelScheduledUpdate(element);
                    this._updateScrollbarNow(element);
                });
            });
        });
    }

    _scheduleUpdateScrollbar(element) {
        if (!element) return;
        if (this._layoutBatchDepth > 0 || this._layoutSettling) {
            this._layoutBatchPending.add(element);
            return;
        }
        if (this._updateRafIds.has(element)) return;
        const rafId = requestAnimationFrame(() => {
            this._updateRafIds.delete(element);
            this._updateScrollbarNow(element);
        });
        this._updateRafIds.set(element, rafId);
    }

    _cancelScheduledUpdate(element) {
        const rafId = this._updateRafIds.get(element);
        if (rafId) {
            cancelAnimationFrame(rafId);
            this._updateRafIds.delete(element);
        }
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

                // Tear down trackers when scroll shells leave the DOM (Map keys block GC)
                mutation.removedNodes.forEach((node) => {
                    if (node.nodeType !== Node.ELEMENT_NODE) return;
                    if (this.scrollbars.has(node)) {
                        this.destroy(node);
                    }
                    if (!this.scrollbars.size || !node.querySelectorAll) return;
                    node.querySelectorAll('[data-custom-scrollbar], .form-section-scroll').forEach((el) => {
                        if (this.scrollbars.has(el)) {
                            this.destroy(el);
                        }
                    });
                });

            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        document.addEventListener('staticforge:modal-lifecycle', (e) => {
            if (!e.detail || e.detail.type !== 'opened') return;
            const modal = e.detail.id ? document.getElementById(e.detail.id) : null;
            if (!modal) return;
            modal.querySelectorAll('[data-custom-scrollbar], .form-section-scroll:not([data-custom-scrollbar])').forEach((el) => {
                if (!this.scrollbars.has(el)) {
                    this.createScrollbar(el);
                }
            });
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

        // Store reference before init — initScrollbarFunctionality attaches listeners/observers to this entry
        this.scrollbars.set(element, {
            scrollableContent,
            scrollbar,
            thumb,
            wrapperClass: customWrapperClass
        });

        // Initialize scrollbar functionality
        this.initScrollbarFunctionality(element, scrollableContent, scrollbar, thumb, customWrapperClass);

        // Initial update - use requestAnimationFrame to ensure layout is complete
        this._scheduleUpdateScrollbar(element);
    }

    initScrollbarFunctionality(element, scrollableContent, scrollbar, thumb, wrapperClass = 'scrollable-content') {
        const data = this.scrollbars.get(element);
        const boundListeners = [];
        const trackListener = (target, type, handler, options) => {
            target.addEventListener(type, handler, options);
            boundListeners.push({ target, type, handler, options });
        };

        let isDragging = false;
        let startY = 0;
        let startScrollTop = 0;

        const onScroll = () => {
            this._scheduleUpdateScrollbar(element);
        };
        trackListener(scrollableContent, 'scroll', onScroll);

        const onIndicate = () => {
            this.indicateScrollbar(element);
        };
        trackListener(element, 'custom-scrollbar-indicate', onIndicate);

        const onWheel = (e) => {
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
        };
        trackListener(scrollableContent, 'wheel', onWheel, { passive: false });

        const onThumbMouseDown = (e) => {
            isDragging = true;
            startY = e.clientY;
            startScrollTop = scrollableContent.scrollTop;

            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);

            e.preventDefault();
        };
        trackListener(thumb, 'mousedown', onThumbMouseDown);

        const onThumbTouchStart = (e) => {
            isDragging = true;
            startY = e.touches[0].clientY;
            startScrollTop = scrollableContent.scrollTop;

            document.addEventListener('touchmove', handleTouchMove, { passive: false });
            document.addEventListener('touchend', handleTouchEnd);

            e.preventDefault(); // Prevent scrolling the page while dragging scrollbar
        };
        trackListener(thumb, 'touchstart', onThumbTouchStart, { passive: false });

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

        const onTrackClick = (e) => {
            if (e.target === thumb) return;

            const rect = scrollbar.getBoundingClientRect();
            const clickY = e.clientY - rect.top;
            const scrollbarTrackHeight = scrollbar.offsetHeight - thumb.offsetHeight;
            const scrollRatio = Math.min(1, Math.max(0, clickY / scrollbarTrackHeight));
            const maxScrollDistance = this.getMaxScrollDistance(scrollableContent);
            const scrollDistance = scrollRatio * maxScrollDistance;

            scrollableContent.scrollTop = scrollDistance;
        };
        trackListener(scrollbar, 'click', onTrackClick);

        // Touch event handling for mobile devices
        if ('ontouchstart' in window) {
            let touchStartY = 0;
            let touchStartScrollTop = 0;
            let isTouchScrolling = false;

            const onTouchStart = (e) => {
                touchStartY = e.touches[0].clientY;
                touchStartScrollTop = scrollableContent.scrollTop;
                isTouchScrolling = true;
            };
            trackListener(scrollableContent, 'touchstart', onTouchStart, { passive: true });

            const onTouchMove = (e) => {
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
            };
            trackListener(scrollableContent, 'touchmove', onTouchMove, { passive: false });

            const onTouchEnd = () => {
                isTouchScrolling = false;
            };
            trackListener(scrollableContent, 'touchend', onTouchEnd, { passive: true });
        }

        // Resize observer to update scrollbar when content or container changes
        const resizeObserver = new ResizeObserver(() => {
            // Clear cache when size changes
            this.maxScrollCache.delete(scrollableContent);
            // Update scrollbar on any resize event - content or container size changes
            this._scheduleUpdateScrollbar(element);
        });

        // Only observe scrollableContent, not the parent element
        resizeObserver.observe(scrollableContent);

        // Structural DOM changes only — attributes/style fire from textarea auto-resize (handled via syncPromptTextareaContainerMeasurements).
        const mutationObserver = new MutationObserver(() => {
            this.maxScrollCache.delete(scrollableContent);
            this._scheduleUpdateScrollbar(element);
        });

        mutationObserver.observe(scrollableContent, {
            childList: true,
            subtree: true
        });

        data._boundListeners = boundListeners;
        data._resizeObserver = resizeObserver;
        data._mutationObserver = mutationObserver;
    }

    // Helper function to get max scroll distance
    // This ensures we can scroll into all padding by using the actual scrollable area
    getMaxScrollDistance(scrollableContent) {
        const scrollHeight = scrollableContent.scrollHeight;
        const clientHeight = scrollableContent.clientHeight;
        const cached = this.maxScrollCache.get(scrollableContent);
        if (cached && cached.scrollHeight === scrollHeight && cached.clientHeight === clientHeight) {
            return cached.max;
        }

        let maxScroll = Math.max(0, scrollHeight - clientHeight);
        let max = maxScroll;

        if (maxScroll > 0) {
            const savedScrollTop = scrollableContent.scrollTop;
            scrollableContent.scrollTop = 999999;
            max = Math.max(maxScroll, scrollableContent.scrollTop);
            scrollableContent.scrollTop = savedScrollTop;
        }

        this.maxScrollCache.set(scrollableContent, { scrollHeight, clientHeight, max });
        return max;
    }

    updateScrollbar(element) {
        this._scheduleUpdateScrollbar(element);
    }

    indicateScrollbar(element) {
        const data = this.scrollbars.get(element);
        if (!data) return;
        element.classList.add('scrollbar-indicating');
        if (data._indicateTimer) {
            clearTimeout(data._indicateTimer);
        }
        data._indicateTimer = setTimeout(() => {
            element.classList.remove('scrollbar-indicating');
            data._indicateTimer = null;
        }, 1200);
        this._scheduleUpdateScrollbar(element);
    }

    _updateScrollbarNow(element) {
        const data = this.scrollbars.get(element);
        if (!data) return;

        const { scrollableContent, scrollbar, thumb } = data;

        const scrollHeight = scrollableContent.scrollHeight;
        const clientHeight = scrollableContent.clientHeight;
        const scrollTop = scrollableContent.scrollTop;

        // Check if scrollbar is needed
        const needsScrollbar = scrollHeight > clientHeight;
        const scrollState = data.scrollState || {};
        const skipScrollStateClasses = this._layoutSettling;

        // Update scroll state classes (deferred during layout settling to preserve CSS transitions)
        if (needsScrollbar) {
            const maxScrollDistance = this.getMaxScrollDistance(scrollableContent);

            if (!skipScrollStateClasses) {
                if (!scrollState.needsScrollbar) {
                    element.classList.add('scroll-ready');
                }

                const atTop = scrollTop <= 0;
                const atBottom = scrollTop >= (maxScrollDistance - 1);

                element.classList.toggle('scroll-top', atTop);
                element.classList.toggle('scroll-end', atBottom);

                scrollState.needsScrollbar = true;
                scrollState.atTop = atTop;
                scrollState.atBottom = atBottom;
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
            if (!skipScrollStateClasses && scrollState.needsScrollbar) {
                element.classList.remove('scroll-ready', 'scroll-top', 'scroll-end');
                scrollState.needsScrollbar = false;
                scrollState.atTop = false;
                scrollState.atBottom = false;
            }

            // Hide scrollbar when not needed
            scrollbar.classList.add('hidden');
        }

        data.scrollState = scrollState;
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
                this._cancelScheduledUpdate(element);
                this._layoutBatchPending.delete(element);

                if (data._resizeObserver) {
                    data._resizeObserver.disconnect();
                    data._resizeObserver = null;
                }
                if (data._mutationObserver) {
                    data._mutationObserver.disconnect();
                    data._mutationObserver = null;
                }
                if (data._boundListeners) {
                    data._boundListeners.forEach(({ target, type, handler, options }) => {
                        target.removeEventListener(type, handler, options);
                    });
                    data._boundListeners = null;
                }

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
