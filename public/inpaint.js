// Mask Editor Functionality
let maskEditorCanvas = null;
let maskEditorCanvasInner = null;
let maskEditorCtx = null;
let maskBrushPreviewCanvas = null;
let maskBrushPreviewCtx = null;
let isDrawing = false;
let currentTool = 'brush'; // 'brush' or 'eraser'
let brushSize = 5;
let brushSizePercent = 0.03; // 3% of canvas size as default
let brushShape = 'circle'; // 'square' or 'circle'
let displayScale = 1; // Track the display scale for cursor positioning
let globalMouseDown = false; // Track global mouse state for continuous drawing
const negativeBtn = document.getElementById('maskNegativeBtn');
const inpaintBtn = document.getElementById('inpaintBtn');

document.addEventListener('DOMContentLoaded', async function() {
    inpaintBtn.addEventListener('click', openMaskEditor);
    negativeBtn.addEventListener('click', invertMask);
});

function resetInpaint() {
    inpaintBtn.setAttribute('data-state', 'off');
    inpaintBtn.classList.remove('active');
    window.currentMaskData = null;
    window.currentMaskCompressed = null;
    isDrawing = false;
    currentTool = 'brush';
    brushSize = 5;
    brushSizePercent = 0.03;
    brushShape = 'circle';
    displayScale = 1;
    globalMouseDown = false;
    updateInpaintButtonState();
    updateMaskPreview();
}

// Initialize mask editor
function initializeMaskEditor() {
    maskEditorCanvas = document.getElementById('maskCanvas');
    maskEditorCanvasInner = document.getElementById('maskEditorCanvasInner');
    maskBrushPreviewCanvas = document.getElementById('maskBrushPreviewCanvas');
    if (!maskEditorCanvas) return;

    maskEditorCtx = maskEditorCanvas.getContext('2d');
    if (maskBrushPreviewCanvas) {
        maskBrushPreviewCtx = maskBrushPreviewCanvas.getContext('2d');
        // Always match size to maskEditorCanvas
        maskBrushPreviewCanvas.width = maskEditorCanvas.width;
        maskBrushPreviewCanvas.height = maskEditorCanvas.height;
        maskBrushPreviewCanvas.style.position = 'absolute';
        maskBrushPreviewCanvas.style.left = '0';
        maskBrushPreviewCanvas.style.top = '0';
        maskBrushPreviewCanvas.style.pointerEvents = 'none';
        maskBrushPreviewCanvas.style.zIndex = 3;
    }
    // Make maskCanvas transparent
    maskEditorCanvas.style.background = 'transparent';

    if (!maskEditorCanvas) return;

    // Create brush cursor element if it doesn't exist
    let brushCursor = document.querySelector('.brush-cursor');
    if (!brushCursor) {
        brushCursor = document.createElement('div');
        brushCursor.className = 'brush-cursor';
        brushCursor.style.display = 'none';
        document.body.appendChild(brushCursor);
    }
    // Hide the floating brush cursor div (we use overlay canvas now)
    brushCursor.style.display = 'none';

    // Set up canvas event listeners
    maskEditorCanvas.addEventListener('mousedown', startDrawing);
    maskEditorCanvas.addEventListener('mousemove', draw);
    maskEditorCanvas.addEventListener('mouseup', stopDrawing);

    // Brush cursor events
    maskEditorCanvas.addEventListener('mousemove', updateBrushCursor);
    maskEditorCanvas.addEventListener('mouseenter', handleCanvasMouseEnter);
    maskEditorCanvas.addEventListener('mouseleave', () => {
        if (maskBrushPreviewCtx && maskBrushPreviewCanvas) {
            maskBrushPreviewCtx.clearRect(0, 0, maskBrushPreviewCanvas.width, maskBrushPreviewCanvas.height);
        }
    });

    // Wheel event for brush size adjustment
    maskEditorCanvas.addEventListener('wheel', handleCanvasWheel);

    // Global mouse events for continuous drawing
    document.addEventListener('mouseup', handleGlobalMouseUp);
    document.addEventListener('mousemove', handleGlobalMouseMove);

    // Touch events for mobile
    maskEditorCanvas.addEventListener('touchstart', handleTouchStart);
    maskEditorCanvas.addEventListener('touchmove', handleTouchMove);
    maskEditorCanvas.addEventListener('touchend', handleTouchEnd);

    // Tool buttons
    const brushBtn = document.getElementById('maskBrushBtn');
    const eraserBtn = document.getElementById('maskEraserBtn');
    const brushShapeBtn = document.getElementById('brushShapeBtn');
    const clearBtn = document.getElementById('clearMaskBtn');
    const saveBtn = document.getElementById('saveMaskBtn');
    const deleteBtn = document.getElementById('deleteMaskBtn');
    const cancelBtn = document.getElementById('cancelMaskBtn');
    const closeBtn = document.getElementById('closeMaskEditorBtn');
    const brushSizeInput = document.getElementById('brushSize');

    if (brushBtn) {
        brushBtn.addEventListener('click', () => setTool('brush'));
    }

    if (eraserBtn) {
        eraserBtn.addEventListener('click', () => setTool('eraser'));
    }

    if (brushShapeBtn) {
        brushShapeBtn.addEventListener('click', toggleBrushShape);
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', clearMask);
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', saveMask);
    }

    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => deleteMask());
    }

    if (cancelBtn) {
        cancelBtn.addEventListener('click', closeMaskEditor);
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', closeMaskEditor);
    }

    if (brushSizeInput) {
        // Set initial value
        brushSizeInput.value = brushSize;

        // Input change handler
        brushSizeInput.addEventListener('input', (e) => {
            let val = parseInt(e.target.value);
            if (isNaN(val)) val = 1;
            val = Math.max(1, Math.min(10, val));
            brushSize = val;
            e.target.value = val;

            // Calculate and store the percentage for future reference
            if (maskEditorCanvas) {
                const canvasDiagonal = Math.sqrt(maskEditorCanvas.width * maskEditorCanvas.width + maskEditorCanvas.height * maskEditorCanvas.height);
                brushSizePercent = brushSize / canvasDiagonal;
            }

            // Update cursor size if it exists
            const brushCursor = document.querySelector('.brush-cursor');
            if (brushCursor && brushCursor.style.display !== 'none') {
                const cursorSize = brushSize * displayScale;
                brushCursor.style.width = cursorSize + 'px';
                brushCursor.style.height = cursorSize + 'px';
            }
        });

        // Mouse wheel handler for scrolling
        brushSizeInput.addEventListener('wheel', function(e) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -1 : 1;
            const currentValue = parseInt(this.value) || 3;
            const newValue = Math.max(1, Math.min(10, currentValue + delta));
            this.value = newValue;
            brushSize = newValue;

            // Calculate and store the percentage for future reference
            if (maskEditorCanvas) {
                const canvasDiagonal = Math.sqrt(maskEditorCanvas.width * maskEditorCanvas.width + maskEditorCanvas.height * maskEditorCanvas.height);
                brushSizePercent = brushSize / canvasDiagonal;
            }

            // Update cursor size if it exists
            const brushCursor = document.querySelector('.brush-cursor');
            if (brushCursor && brushCursor.style.display !== 'none') {
                const cursorSize = brushSize * displayScale;
                brushCursor.style.width = cursorSize + 'px';
                brushCursor.style.height = cursorSize + 'px';
            }
        });
    }
}

// Set drawing tool
function setTool(tool) {
    currentTool = tool;

    const brushBtn = document.getElementById('maskBrushBtn');
    const eraserBtn = document.getElementById('maskEraserBtn');

    if (brushBtn) {
        brushBtn.setAttribute('data-state', tool === 'brush' ? 'on' : 'off');
    }

    if (eraserBtn) {
        eraserBtn.setAttribute('data-state', tool === 'eraser' ? 'on' : 'off');
    }
}

// Toggle brush shape
function toggleBrushShape() {
    brushShape = brushShape === 'square' ? 'circle' : 'square';

    // Update the toggle button icon
    const brushShapeBtn = document.getElementById('brushShapeBtn');
    if (brushShapeBtn) {
        const icon = brushShapeBtn.querySelector('i');
        if (icon) {
            if (brushShape === 'circle') {
                icon.className = 'fas fa-circle';
            } else {
                icon.className = 'fas fa-square';
            }
        }
    }

    // Update cursor if it's visible
    const brushCursor = document.querySelector('.brush-cursor');
    if (brushCursor && brushCursor.style.display !== 'none') {
        if (brushShape === 'circle') {
            brushCursor.style.borderRadius = '50%';
        } else {
            brushCursor.style.borderRadius = '0';
        }
    }
}

// Invert the mask: white <-> transparent
function invertMask() {
    if (!maskEditorCanvas || !maskEditorCtx) return;
    const width = maskEditorCanvas.width;
    const height = maskEditorCanvas.height;
    const imageData = maskEditorCtx.getImageData(0, 0, width, height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        // If pixel is green (75,254,108,255), make it transparent (0,0,0,0)
        // If pixel is transparent (0,0,0,0), make it green (75,254,108,255)
        if (data[i] === 75 && data[i+1] === 254 && data[i+2] === 108 && data[i+3] === 255) {
            data[i] = 0; data[i+1] = 0; data[i+2] = 0; data[i+3] = 0;
        } else if (data[i+3] === 0) {
            data[i] = 75; data[i+1] = 254; data[i+2] = 108; data[i+3] = 255;
        }
        // else leave other colors (e.g. partial alpha) unchanged
    }
    maskEditorCtx.putImageData(imageData, 0, 0);
    setTool(currentTool === 'eraser' ? 'brush' : 'eraser');
}

// Handle canvas wheel for brush size adjustment
function handleCanvasWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 1 : -1;
    const currentValue = brushSize;
    const newValue = Math.max(1, Math.min(10, currentValue + delta));
    brushSize = newValue;

    // Update brush size input if it exists
    const brushSizeInput = document.getElementById('brushSize');
    if (brushSizeInput) {
        brushSizeInput.value = newValue;
    }

    // Calculate and store the percentage for future reference
    if (maskEditorCanvas) {
        const canvasDiagonal = Math.sqrt(maskEditorCanvas.width * maskEditorCanvas.width + maskEditorCanvas.height * maskEditorCanvas.height);
        brushSizePercent = brushSize / canvasDiagonal;
    }

    // Update cursor size if it exists
    const brushCursor = document.querySelector('.brush-cursor');
    if (brushCursor && brushCursor.style.display !== 'none') {
        const rect = maskEditorCanvas.getBoundingClientRect();
        const visualScaleX = rect.width / maskEditorCanvas.width;
        const visualScaleY = rect.height / maskEditorCanvas.height;
        const visualScale = Math.min(visualScaleX, visualScaleY);
        const cursorSize = brushSize * visualScale;
        brushCursor.style.width = cursorSize + 'px';
        brushCursor.style.height = cursorSize + 'px';
    }
}

// Handle canvas mouse enter for continuous drawing
function handleCanvasMouseEnter(e) {
    if (maskBrushPreviewCtx && maskBrushPreviewCanvas) {
        maskBrushPreviewCtx.clearRect(0, 0, maskBrushPreviewCanvas.width, maskBrushPreviewCanvas.height);
    }
    updateBrushCursor(e);
    // If global mouse is down, resume drawing
    if (globalMouseDown && !isDrawing) {
        isDrawing = true;
        draw(e);
    }
}

// Handle global mouse up to stop drawing
function handleGlobalMouseUp() {
    if (isDrawing) {
        isDrawing = false;
        globalMouseDown = false;
    }
}

// Handle global mouse move for continuous drawing
function handleGlobalMouseMove(e) {
    // Only handle if we're drawing and mouse is over the canvas
    if (globalMouseDown && !isDrawing && maskEditorCanvas) {
        const rect = maskEditorCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Check if mouse is over the canvas
        if (x >= 0 && x <= rect.width && y >= 0 && y <= rect.height) {
            isDrawing = true;
            draw(e);
        }
    }
}

// Start drawing
function startDrawing(e) {
    isDrawing = true;
    globalMouseDown = true;
    draw(e);
}

// Draw function
function draw(e) {
    if (!isDrawing || !maskEditorCtx) return;

    e.preventDefault();

    const rect = maskEditorCanvas.getBoundingClientRect();

    // Calculate the actual canvas content area (accounting for object-fit: contain)
    const visualScaleX = rect.width / maskEditorCanvas.width;
    const visualScaleY = rect.height / maskEditorCanvas.height;
    const visualScale = Math.min(visualScaleX, visualScaleY);

    // Calculate the actual canvas content dimensions
    const actualCanvasWidth = maskEditorCanvas.width * visualScale;
    const actualCanvasHeight = maskEditorCanvas.height * visualScale;

    // Calculate padding around the canvas content
    const paddingX = (rect.width - actualCanvasWidth) / 2;
    const paddingY = (rect.height - actualCanvasHeight) / 2;

    // Calculate position relative to the actual canvas content
    const x = e.clientX - rect.left - paddingX;
    const y = e.clientY - rect.top - paddingY;

    // Only draw if mouse is over the actual canvas content
    if (x >= 0 && x <= actualCanvasWidth && y >= 0 && y <= actualCanvasHeight) {
        // Scale coordinates to canvas size
        const canvasX = (x / actualCanvasWidth) * maskEditorCanvas.width;
        const canvasY = (y / actualCanvasHeight) * maskEditorCanvas.height;

        // Use green for visual feedback in the editor
        if (currentTool === 'brush') {
            if (brushShape === 'circle') {
                drawCircle(canvasX, canvasY, brushSize, '#4bfe6c', 1);
            } else {
                drawSquare(canvasX, canvasY, brushSize * 2, '#4bfe6c', 1);
            }
        } else {
            if (brushShape === 'circle') {
                drawCircle(canvasX, canvasY, brushSize, '#000000', 0);
            } else {
                drawSquare(canvasX, canvasY, brushSize * 2, '#000000', 0);
            }
        }
    }
}

// Draw circle using direct pixel manipulation (like the inpainting editor)
function drawCircle(x, y, radius, color, alpha) {
    const roundedX = Math.round(x);
    const roundedY = Math.round(y);
    const roundedRadius = Math.round(radius);

    const startX = roundedX - roundedRadius;
    const startY = roundedY - roundedRadius;
    const size = 2 * roundedRadius + 1;

    const imageData = maskEditorCtx.getImageData(startX, startY, size, size);

    for (let i = 0; i <= roundedRadius; i++) {
        for (let j = 0; j <= roundedRadius; j++) {
            // Check if pixel is within circle using distance calculation
            const minDist = Math.min(
                Math.sqrt((j + 0.5) * (j + 0.5) + (i + 0.5) * (i + 0.5)),
                Math.sqrt((j - 0.5) * (j - 0.5) + (i - 0.5) * (i - 0.5))
            );

            if (minDist <= roundedRadius) {
                // Set pixels in all four quadrants
                const positions = [
                    (roundedRadius + j) * 4 + (roundedRadius + i) * size * 4,
                    (roundedRadius - j) * 4 + (roundedRadius + i) * size * 4,
                    (roundedRadius + j) * 4 + (roundedRadius - i) * size * 4,
                    (roundedRadius - j) * 4 + (roundedRadius - i) * size * 4
                ];

                positions.forEach(pos => {
                    if (pos >= 0 && pos < imageData.data.length) {
                        imageData.data[pos] = parseInt(color.slice(1, 3), 16);     // Red
                        imageData.data[pos + 1] = parseInt(color.slice(3, 5), 16); // Green
                        imageData.data[pos + 2] = parseInt(color.slice(5, 7), 16); // Blue
                        imageData.data[pos + 3] = 255 * alpha;                    // Alpha
                    }
                });
            }
        }
    }

    maskEditorCtx.putImageData(imageData, startX, startY);
}

// Draw square using direct pixel manipulation (like the inpainting editor)
function drawSquare(x, y, size, color, alpha) {
    const startX = x - Math.floor(size / 2);
    const startY = y - Math.floor(size / 2);
    const endX = startX + size;
    const endY = startY + size;

    const imageData = maskEditorCtx.getImageData(startX, startY, endX - startX, endY - startY);

    for (let i = 0; i < imageData.data.length; i += 4) {
        imageData.data[i] = parseInt(color.slice(1, 3), 16);     // Red
        imageData.data[i + 1] = parseInt(color.slice(3, 5), 16); // Green
        imageData.data[i + 2] = parseInt(color.slice(5, 7), 16); // Blue
        imageData.data[i + 3] = 255 * alpha;                    // Alpha
    }

    maskEditorCtx.putImageData(imageData, startX, startY);
}

// Stop drawing
function stopDrawing() {
    isDrawing = false;
    globalMouseDown = false;
    if (maskBrushPreviewCtx && maskBrushPreviewCanvas) {
        maskBrushPreviewCtx.clearRect(0, 0, maskBrushPreviewCanvas.width, maskBrushPreviewCanvas.height);
    }
}

// Update brush cursor position and size
function updateBrushCursor(e) {
    if (!maskEditorCanvas || !maskBrushPreviewCtx || !maskBrushPreviewCanvas) return;

    // Clear previous preview
    maskBrushPreviewCtx.clearRect(0, 0, maskBrushPreviewCanvas.width, maskBrushPreviewCanvas.height);

    const rect = maskEditorCanvas.getBoundingClientRect();
    const visualScaleX = rect.width / maskEditorCanvas.width;
    const visualScaleY = rect.height / maskEditorCanvas.height;
    const visualScale = Math.min(visualScaleX, visualScaleY);
    const actualCanvasWidth = maskEditorCanvas.width * visualScale;
    const actualCanvasHeight = maskEditorCanvas.height * visualScale;
    const paddingX = (rect.width - actualCanvasWidth) / 2;
    const paddingY = (rect.height - actualCanvasHeight) / 2;
    const x = e.clientX - rect.left - paddingX;
    const y = e.clientY - rect.top - paddingY;

    // Only show preview if mouse is over the actual canvas content
    if (x >= 0 && x <= actualCanvasWidth && y >= 0 && y <= actualCanvasHeight) {
        // Scale coordinates to canvas size
        const canvasX = (x / actualCanvasWidth) * maskEditorCanvas.width;
        const canvasY = (y / actualCanvasHeight) * maskEditorCanvas.height;

        // Draw green preview using the same logic as drawCircle/drawSquare
        if (currentTool === 'brush') {
            if (brushShape === 'circle') {
                drawBrushPreviewCircle(canvasX, canvasY, brushSize, '#4bc6fe');
            } else {
                drawBrushPreviewSquare(canvasX, canvasY, brushSize * 2, '#4bc6fe');
            }
        } else {
            if (brushShape === 'circle') {
                drawBrushPreviewCircle(canvasX, canvasY, brushSize, '#4bc6fe');
            } else {
                drawBrushPreviewSquare(canvasX, canvasY, brushSize * 2, '#4bc6fe');
            }
        }
    }
}

// Draw green circle preview on overlay canvas
function drawBrushPreviewCircle(x, y, radius, color) {
    const roundedX = Math.round(x);
    const roundedY = Math.round(y);
    const roundedRadius = Math.round(radius);
    for (let i = 0; i <= roundedRadius; i++) {
        for (let j = 0; j <= roundedRadius; j++) {
            const minDist = Math.min(
                Math.sqrt((j + 0.5) * (j + 0.5) + (i + 0.5) * (i + 0.5)),
                Math.sqrt((j - 0.5) * (j - 0.5) + (i - 0.5) * (i - 0.5))
            );
            if (minDist <= roundedRadius) {
                // All four quadrants
                const positions = [
                    [roundedX + j, roundedY + i],
                    [roundedX - j, roundedY + i],
                    [roundedX + j, roundedY - i],
                    [roundedX - j, roundedY - i]
                ];
                positions.forEach(([px, py]) => {
                    if (
                        px >= 0 && px < maskBrushPreviewCanvas.width &&
                        py >= 0 && py < maskBrushPreviewCanvas.height
                    ) {
                        maskBrushPreviewCtx.fillStyle = color;
                        maskBrushPreviewCtx.globalAlpha = 0.5;
                        maskBrushPreviewCtx.fillRect(px, py, 1, 1);
                        maskBrushPreviewCtx.globalAlpha = 1.0;
                    }
                });
            }
        }
    }
}

// Draw green square preview on overlay canvas
function drawBrushPreviewSquare(x, y, size, color) {
    const startX = Math.round(x - Math.floor(size / 2));
    const startY = Math.round(y - Math.floor(size / 2));
    for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
            const px = startX + j;
            const py = startY + i;
            if (
                px >= 0 && px < maskBrushPreviewCanvas.width &&
                py >= 0 && py < maskBrushPreviewCanvas.height
            ) {
                maskBrushPreviewCtx.fillStyle = color;
                maskBrushPreviewCtx.globalAlpha = 0.5;
                maskBrushPreviewCtx.fillRect(px, py, 1, 1);
                maskBrushPreviewCtx.globalAlpha = 1.0;
            }
        }
    }
}

// Touch event handlers
function handleTouchStart(e) {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousedown', {
        clientX: touch.clientX,
        clientY: touch.clientY
    });
    maskEditorCanvas.dispatchEvent(mouseEvent);
}

function handleTouchMove(e) {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousemove', {
        clientX: touch.clientX,
        clientY: touch.clientY
    });
    maskEditorCanvas.dispatchEvent(mouseEvent);
}

function handleTouchEnd(e) {
    e.preventDefault();
    const mouseEvent = new MouseEvent('mouseup', {});
    maskEditorCanvas.dispatchEvent(mouseEvent);
}

// Clear mask
function clearMask() {
    if (!maskEditorCtx) return;

    // Clear the entire canvas to transparent
    maskEditorCtx.clearRect(0, 0, maskEditorCanvas.width, maskEditorCanvas.height);
}

// Save mask (upscaled version for display)
function saveMask() {
    if (!maskEditorCanvas) return;

    try {
        // Get target dimensions for scaling up
        const targetWidth = maskEditorCanvas.targetWidth || maskEditorCanvas.width * 8;
        const targetHeight = maskEditorCanvas.targetHeight || maskEditorCanvas.height * 8;

        // Create a temporary canvas with the target resolution
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');

        tempCanvas.width = targetWidth;
        tempCanvas.height = targetHeight;

        // Fill with black background
        tempCtx.fillStyle = '#000000';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

        // Disable image smoothing for nearest neighbor scaling
        tempCtx.imageSmoothingEnabled = false;

        // Draw the mask canvas scaled up to target resolution
        tempCtx.drawImage(maskEditorCanvas, 0, 0, maskEditorCanvas.width, maskEditorCanvas.height, 0, 0, targetWidth, targetHeight);

        // Binarize the image data to ensure crisp 1-bit mask
        const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];

            // If pixel is not black (has been drawn on), make it pure white
            if (r > 0 || g > 0 || b > 0) {
                data[i] = 255;     // Red
                data[i + 1] = 255; // Green
                data[i + 2] = 255; // Blue
                data[i + 3] = 255; // Alpha
            } else {
                // Black pixels (background) stay pure black
                data[i] = 0;       // Red
                data[i + 1] = 0;   // Green
                data[i + 2] = 0;   // Blue
                data[i + 3] = 255; // Alpha
            }
        }

        // Put the binarized image data back
        tempCtx.putImageData(imageData, 0, 0);

        // Convert to base64
        const base64Data = tempCanvas.toDataURL('image/png');

        // Store the mask data in a global variable
        window.currentMaskData = base64Data;

        // Also store the compressed version for server processing
        const compressedMask = saveMaskCompressed();
        if (compressedMask) {
            window.currentMaskCompressed = compressedMask;
        }

        // Set inpaint button to on
        if (inpaintBtn) {
            inpaintBtn.setAttribute('data-state', 'on');
            inpaintBtn.classList.add('active');
        }

        // Update vibe transfer UI state
        updateInpaintButtonState();
        closeMaskEditor();
    } catch (error) {
        console.error('Error saving mask:', error);
        showError('Failed to save mask');
    }
}

// Save unupscaled mask for server processing
function saveMaskCompressed() {
    if (!maskEditorCanvas) return null;

    // Check if canvas has valid dimensions
    if (maskEditorCanvas.width === 0 || maskEditorCanvas.height === 0) {
        console.warn('Mask editor canvas has invalid dimensions');
        return null;
    }

    try {
        // Create a temporary canvas with the original (unupscaled) dimensions
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');

        tempCanvas.width = maskEditorCanvas.width;
        tempCanvas.height = maskEditorCanvas.height;

        // Fill with black background
        tempCtx.fillStyle = '#000000';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

        // Draw the mask canvas at original size
        tempCtx.drawImage(maskEditorCanvas, 0, 0);

        // Binarize the image data to ensure crisp 1-bit mask
        const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];

            // If pixel is not black (has been drawn on), make it pure white
            if (r > 0 || g > 0 || b > 0) {
                data[i] = 255;     // Red
                data[i + 1] = 255; // Green
                data[i + 2] = 255; // Blue
                data[i + 3] = 255; // Alpha
            } else {
                // Black pixels (background) stay pure black
                data[i] = 0;       // Red
                data[i + 1] = 0;   // Green
                data[i + 2] = 0;   // Blue
                data[i + 3] = 255; // Alpha
            }
        }

        // Put the binarized image data back
        tempCtx.putImageData(imageData, 0, 0);

        // Convert to base64 (without data URL prefix)
        const base64Data = tempCanvas.toDataURL('image/png').replace('data:image/png;base64,', '');

        return base64Data;
    } catch (error) {
        console.error('Error saving compressed mask:', error);
        return null;
    }
}
// Helper: Set mask editor canvas from a data URL
function setMaskEditorFromDataUrl(dataUrl) {
    // Ensure mask editor is initialized
    if (!window.maskEditorCanvas || !window.maskEditorCtx) {
        if (typeof initializeMaskEditor === 'function') initializeMaskEditor();
    }
    if (!window.maskEditorCanvas) return; // Still not available, abort

    const img = new Image();
    img.onload = function() {
        window.maskEditorCanvas.width = img.width;
        window.maskEditorCanvas.height = img.height;
        window.maskEditorCtx.clearRect(0, 0, img.width, img.height);
        window.maskEditorCtx.drawImage(img, 0, 0);
    };
    img.onerror = function() {
        console.error('Failed to load mask image for editor');
    };
    img.src = dataUrl;
}

// Helper function to convert standard mask to compressed format
async function convertStandardMaskToCompressed(standardMaskBase64, originalWidth, originalHeight) {
    return new Promise((resolve, reject) => {
        // Validate input parameters
        if (!standardMaskBase64 || !originalWidth || !originalHeight) {
            reject(new Error('Invalid parameters: standardMaskBase64, originalWidth, and originalHeight are required'));
            return;
        }

        if (originalWidth <= 0 || originalHeight <= 0) {
            reject(new Error(`Invalid original dimensions: ${originalWidth}x${originalHeight}`));
            return;
        }

        // Calculate compressed dimensions (1/8 scale)
        const compressedWidth = Math.floor(originalWidth / 8);
        const compressedHeight = Math.floor(originalHeight / 8);

        // Create a temporary canvas to process the standard mask
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');

        tempCanvas.width = compressedWidth;
        tempCanvas.height = compressedHeight;

        // Fill with black background
        tempCtx.fillStyle = '#000000';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

        // Disable image smoothing for nearest neighbor scaling
        tempCtx.imageSmoothingEnabled = false;

        // Create image from standard mask
        const img = new Image();
        img.onload = function() {
            try {
                // Validate loaded image dimensions
                if (!img.width || !img.height || img.width <= 0 || img.height <= 0) {
                    reject(new Error(`Invalid loaded mask image dimensions: ${img.width}x${img.height}`));
                    return;
                }

                // Draw the standard mask scaled down to compressed size
                tempCtx.drawImage(img, 0, 0, img.width, img.height, 0, 0, compressedWidth, compressedHeight);

                // Binarize the image data to ensure crisp 1-bit mask
                const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
                const data = imageData.data;

                for (let i = 0; i < data.length; i += 4) {
                    const r = data[i];
                    const g = data[i + 1];
                    const b = data[i + 2];
                    const a = data[i + 3];

                    // If pixel is not black (has been drawn on), make it pure white
                    if (r > 0 || g > 0 || b > 0) {
                        data[i] = 255;     // Red
                        data[i + 1] = 255; // Green
                        data[i + 2] = 255; // Blue
                        data[i + 3] = 255; // Alpha
                    } else {
                        // Black pixels (background) stay pure black
                        data[i] = 0;       // Red
                        data[i + 1] = 0;   // Green
                        data[i + 2] = 0;   // Blue
                        data[i + 3] = 255; // Alpha
                    }
                }

                // Put the binarized image data back
                tempCtx.putImageData(imageData, 0, 0);

                // Convert to base64 (without data URL prefix)
                const compressedMaskBase64 = tempCanvas.toDataURL('image/png').replace('data:image/png;base64,', '');

                // Resolve the promise
                resolve(compressedMaskBase64);
            } catch (error) {
                console.error('Error converting standard mask to compressed:', error);
                reject(error);
            }
        };

        img.onerror = function() {
            console.error('Failed to load standard mask image');
            reject(new Error('Failed to load standard mask image'));
        };

        img.src = "data:image/png;base64," + standardMaskBase64;
    });
}

// Helper function to process compressed mask to display resolution
function processCompressedMask(compressedMaskBase64, targetWidth, targetHeight, callback) {
    return new Promise((resolve, reject) => {
        // Validate input parameters
        if (!compressedMaskBase64 || !targetWidth || !targetHeight) {
            reject(new Error('Invalid parameters: compressedMaskBase64, targetWidth, and targetHeight are required'));
            return;
        }

        if (targetWidth <= 0 || targetHeight <= 0) {
            reject(new Error(`Invalid target dimensions: ${targetWidth}x${targetHeight}`));
            return;
        }

        // Create a temporary canvas to process the compressed mask
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');

        tempCanvas.width = targetWidth;
        tempCanvas.height = targetHeight;

        // Fill with black background
        tempCtx.fillStyle = '#000000';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

        // Disable image smoothing for nearest neighbor scaling
        tempCtx.imageSmoothingEnabled = false;

        // Create image from compressed mask
        const img = new Image();
        img.onload = function() {
            try {
                // Validate loaded image dimensions
                if (!img.width || !img.height || img.width <= 0 || img.height <= 0) {
                    reject(new Error(`Invalid loaded mask image dimensions: ${img.width}x${img.height}`));
                    return;
                }

                // Draw the compressed mask scaled up to target resolution
                tempCtx.drawImage(img, 0, 0, img.width, img.height, 0, 0, targetWidth, targetHeight);

                // Binarize the image data to ensure crisp 1-bit mask
                const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
                const data = imageData.data;

                for (let i = 0; i < data.length; i += 4) {
                    const r = data[i];
                    const g = data[i + 1];
                    const b = data[i + 2];
                    const a = data[i + 3];

                    // If pixel is not black (has been drawn on), make it pure white
                    if (r > 0 || g > 0 || b > 0) {
                        data[i] = 255;     // Red
                        data[i + 1] = 255; // Green
                        data[i + 2] = 255; // Blue
                        data[i + 3] = 255; // Alpha
                    } else {
                        // Black pixels (background) stay pure black
                        data[i] = 0;       // Red
                        data[i + 1] = 0;   // Green
                        data[i + 2] = 0;   // Blue
                        data[i + 3] = 255; // Alpha
                    }
                }

                // Put the binarized image data back
                tempCtx.putImageData(imageData, 0, 0);

                // Convert to base64
                const base64Data = tempCanvas.toDataURL('image/png');

                // Call the callback with the processed mask if provided
                if (callback) {
                    callback(base64Data);
                }

                // Resolve the promise
                resolve(base64Data);
            } catch (error) {
                console.error('Error processing compressed mask:', error);
                reject(error);
            }
        };

        img.onerror = function() {
            console.error('Failed to load compressed mask image');
            reject(new Error('Failed to load compressed mask image'));
        };

        img.src = "data:image/png;base64," + compressedMaskBase64;
    });
}

// Move to mask.js: Delete mask
async function deleteMask() {
    // Clear the stored mask data
    window.currentMaskData = null;

    // Set inpaint button to off
    if (inpaintBtn) {
        inpaintBtn.setAttribute('data-state', 'off');
        inpaintBtn.classList.remove('active');
    }

    // Clear the canvas
    if (maskEditorCtx) {
        maskEditorCtx.clearRect(0, 0, maskEditorCanvas.width, maskEditorCanvas.height);
    }

    // For pipeline images, restore the original pipeline mask
    const isPipeline = window.currentEditMetadata && window.currentEditMetadata.request_type === 'pipeline';
    if (isPipeline && window.pipelineMaskData) {
        window.currentMaskData = window.pipelineMaskData + "";
    }
    window.currentMaskCompressed = null;

    // Update vibe transfer UI state
    updateInpaintButtonState();

    closeMaskEditor();
}

// Move to mask.js: Close mask editor
function closeMaskEditor() {
    document.getElementById('maskEditorDialog').style.display = 'none';

    // Reset drawing state
    isDrawing = false;
    globalMouseDown = false;

    // Remove global event listeners
    document.removeEventListener('mouseup', handleGlobalMouseUp);
    document.removeEventListener('mousemove', handleGlobalMouseMove);

    // Update inpaint button state and mask preview
    updateInpaintButtonState();
    updateMaskPreview();
}

// Move to mask.js: Open mask editor
function openMaskEditor() {
    console.log('openMaskEditor called');
    const maskEditorDialog = document.getElementById('maskEditorDialog');

    if (!maskEditorDialog) {
        console.error('maskEditorDialog not found');
        return;
    }

    // Initialize mask editor first if not already done
    if (!maskEditorCtx) {
        initializeMaskEditor();
    }

    // Pipeline mask edit mode
    if (window.isPipelineMaskEdit) {
        let canvasWidth = window.pipelineMaskEditWidth || 1024;
        let canvasHeight = window.pipelineMaskEditHeight || 1536;
        maskEditorCanvas.width = canvasWidth;
        maskEditorCanvas.height = canvasHeight;
        if (maskBrushPreviewCanvas) {
            maskBrushPreviewCanvas.width = canvasWidth;
            maskBrushPreviewCanvas.height = canvasHeight;
        }
        // Set the canvas display size
        maskEditorCanvasInner.style.aspectRatio = `${canvasWidth} / ${canvasHeight}`;
        maskEditorCanvas.style.imageRendering = 'pixelated';
        maskEditorCanvas.style.imageRendering = '-moz-crisp-edges';
        maskEditorCanvas.style.imageRendering = 'crisp-edges';
        maskEditorCanvas.targetWidth = canvasWidth;
        maskEditorCanvas.targetHeight = canvasHeight;
        // Set brush size
        const canvasDiagonal = Math.sqrt(canvasWidth * canvasWidth + canvasHeight * canvasHeight);
        brushSize = Math.round(canvasDiagonal * brushSizePercent);
        brushSize = Math.max(1, Math.min(10, brushSize));
        const brushSizeInput = document.getElementById('brushSize');
        if (brushSizeInput) brushSizeInput.value = brushSize;
        // Set gray background
        const canvasInner = document.querySelector('.mask-editor-canvas-inner');
        if (canvasInner && window.setMaskEditorFromDataUrl && window.pipelineMaskEditWidth && window.pipelineMaskEditHeight) {
            // Use the gray image as background
            if (window.currentMaskData) {
                // If editing an existing mask, draw it
                window.setMaskEditorFromDataUrl(window.currentMaskData);
            } else if (window.pipelineMaskEditGrayBg) {
                window.setMaskEditorFromDataUrl(window.pipelineMaskEditGrayBg);
            }
        }
        // Clear any reference/variation/placeholder logic
        // Show the dialog
        maskEditorDialog.style.display = 'block';
        document.addEventListener('mouseup', handleGlobalMouseUp);
        document.addEventListener('mousemove', handleGlobalMouseMove);
        return;
    }

    // Get the source image dimensions
    const isPipelineEdit = window.currentPipelineEdit && window.currentPipelineEdit.isPipelineEdit;

    // For pipeline editing, we don't need a variation image
    if (!isPipelineEdit && (!variationImage || !variationImage.src)) {
        showError('No source image available');
        return;
    }

    // Get the resolution from the form
    let resolutionValue = document.getElementById('manualResolution').value;

    // If resolution value is empty, try to get it from the dropdown display or use default
    if (!resolutionValue) {
        const resolutionSelected = document.getElementById('manualResolutionSelected');

        if (resolutionSelected && resolutionSelected.textContent !== 'Select resolution...') {
            // Try to find the resolution value from the display text
            resolutionValue = getResolutionFromDisplay(resolutionSelected.textContent);
        }

        // Default to normal portrait if no resolution is selected or found
        if (!resolutionValue) {
            resolutionValue = 'normal_portrait';
        }

        // Ensure the hidden input is also set for consistency
        const manualResolutionHidden = document.getElementById('manualResolution');
        if (manualResolutionHidden) {
            manualResolutionHidden.value = resolutionValue;
        }
    }

    let canvasWidth, canvasHeight;

    if (resolutionValue === 'custom') {
        // Use custom resolution values
        canvasWidth = parseInt(document.getElementById('manualWidth').value) || 512;
        canvasHeight = parseInt(document.getElementById('manualHeight').value) || 512;
    } else {
        // Use resolution map to get dimensions
        const dimensions = getDimensionsFromResolution(resolutionValue);
        canvasWidth = dimensions.width;
        canvasHeight = dimensions.height;
    }

    // Store target dimensions for saving
    const targetWidth = canvasWidth;
    const targetHeight = canvasHeight;

    // Calculate 8x smaller canvas dimensions for editing
    canvasWidth = Math.ceil(canvasWidth / 8);
    canvasHeight = Math.ceil(canvasHeight / 8);

    // Set canvas dimensions to the 8x smaller size
    maskEditorCanvas.width = canvasWidth;
    maskEditorCanvas.height = canvasHeight;
    if (maskBrushPreviewCanvas) {
        maskBrushPreviewCanvas.width = canvasWidth;
        maskBrushPreviewCanvas.height = canvasHeight;
    }

    // Calculate display scale to fit in the container (max 512px)
    const maxDisplaySize = 512;
    const scaleX = maxDisplaySize / canvasWidth;
    const scaleY = maxDisplaySize / canvasHeight;
    displayScale = Math.min(scaleX, scaleY, 1); // Don't scale up, only down

    // Set the canvas display size
    maskEditorCanvasInner.style.aspectRatio = `${canvasWidth} / ${canvasHeight}`;

    // Set nearest neighbor scaling
    maskEditorCanvas.style.imageRendering = 'pixelated';
    maskEditorCanvas.style.imageRendering = '-moz-crisp-edges';
    maskEditorCanvas.style.imageRendering = 'crisp-edges';

    // Store target dimensions for saving
    maskEditorCanvas.targetWidth = targetWidth;
    maskEditorCanvas.targetHeight = targetHeight;

    // Calculate brush size based on canvas resolution (8x smaller canvas)
    const canvasDiagonal = Math.sqrt(canvasWidth * canvasWidth + canvasHeight * canvasHeight);
    brushSize = Math.round(canvasDiagonal * brushSizePercent);

    // Ensure brush size is within bounds (1-10)
    brushSize = Math.max(1, Math.min(10, brushSize));

    // Update brush size input
    const brushSizeInput = document.getElementById('brushSize');
    if (brushSizeInput) {
        brushSizeInput.value = brushSize;
    }

    // Set the background image in the inner container with aspect ratio scaling
    const canvasInner = document.querySelector('.mask-editor-canvas-inner');
    if (canvasInner) {
        // Check if we have a placeholder image (current image for pipeline or regular image)
        if (window.uploadedImageData && window.uploadedImageData.isPlaceholder) {
            // Use the placeholder image as background
            const backgroundImageValue = `url(${window.uploadedImageData.image_source.replace('file:', '/images/')})`;
            canvasInner.style.setProperty('--background-image', backgroundImageValue);
            canvasInner.style.setProperty('--background-aspect-ratio', `${canvasWidth} / ${canvasHeight}`);
            canvasInner.style.setProperty('--background-size', 'contain');
            canvasInner.style.setProperty('--background-width', '100%');
            canvasInner.style.setProperty('--background-height', '100%');
        } else if (isPipelineEdit || !variationImage || !variationImage.src) {
            // For pipeline editing or when no variation image, create a black placeholder
            const placeholderCanvas = document.createElement('canvas');
            const placeholderCtx = placeholderCanvas.getContext('2d');
            placeholderCanvas.width = targetWidth;
            placeholderCanvas.height = targetHeight;

            // Fill with black
            placeholderCtx.fillStyle = '#000000';
            placeholderCtx.fillRect(0, 0, targetWidth, targetHeight);

            // Convert to data URL and store as placeholder
            window.uploadedImageData.image_source = placeholderCanvas.toDataURL('image/png');
            window.uploadedImageData.isPlaceholder = true;

            // Use the placeholder as background
            const backgroundImageValue = `url(${window.uploadedImageData.image_source})`;
            canvasInner.style.setProperty('--background-image', backgroundImageValue);
            canvasInner.style.setProperty('--background-aspect-ratio', `${canvasWidth} / ${canvasHeight}`);
            canvasInner.style.setProperty('--background-size', 'contain');
            canvasInner.style.setProperty('--background-width', '100%');
            canvasInner.style.setProperty('--background-height', '100%');
        } else {
            // Use the variation image as background with aspect ratio scaling
            const backgroundImageValue = `url(${variationImage.src})`;
            canvasInner.style.setProperty('--background-image', backgroundImageValue);
            canvasInner.style.setProperty('--background-aspect-ratio', `${canvasWidth} / ${canvasHeight}`);
            canvasInner.style.setProperty('--background-size', 'contain');
            canvasInner.style.setProperty('--background-width', '100%');
            canvasInner.style.setProperty('--background-height', '100%');
        }
    }

    // Initialize canvas with transparent background (black will be drawn as needed)
    maskEditorCtx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Load existing mask if available
    if (window.currentMaskData) {
        const maskImg = new Image();
        maskImg.onload = function() {
            // Create a temporary canvas to scale down the mask
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            tempCanvas.width = canvasWidth;
            tempCanvas.height = canvasHeight;

            // Disable image smoothing for nearest neighbor scaling
            tempCtx.imageSmoothingEnabled = false;

            // Draw the mask image onto the temp canvas (scaled down)
            tempCtx.drawImage(maskImg, 0, 0, canvasWidth, canvasHeight);

            // Get the scaled down image data
            const imageData = tempCtx.getImageData(0, 0, canvasWidth, canvasHeight);
            const data = imageData.data;

            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];

                // If pixel is pure black (0,0,0), make it transparent for editing
                if (r === 0 && g === 0 && b === 0) {
                    data[i + 3] = 0; // Set alpha to 0 (transparent)
                } else if (r > 0 || g > 0 || b > 0) {
                    // Any non-black pixel becomes white with full opacity
                    data[i] = 255;     // Red
                    data[i + 1] = 255; // Green
                    data[i + 2] = 255; // Blue
                    data[i + 3] = 255; // Alpha
                }
            }

            // Put the modified image data back to the main canvas
            maskEditorCtx.putImageData(imageData, 0, 0);
        };
        maskImg.src = window.currentMaskData;
    }

    // Show the dialog
    maskEditorDialog.style.display = 'block';

    // Add global event listeners for continuous drawing
    document.addEventListener('mouseup', handleGlobalMouseUp);
    document.addEventListener('mousemove', handleGlobalMouseMove);
}

// Update inpaint button state
function updateInpaintButtonState() {
    if (inpaintBtn) {
        if (window.currentMaskData) {
            inpaintBtn.setAttribute('data-state', 'on');
            inpaintBtn.classList.add('active');
        } else {
            inpaintBtn.setAttribute('data-state', 'off');
            inpaintBtn.classList.remove('active');
        }
    }

    // Disable noise slider when mask is set
    if (manualNoiseValue) {
        if (window.currentMaskData) {
            manualNoiseValue.disabled = true;
            manualNoiseValue.style.opacity = '0.5';
        } else {
            manualNoiseValue.disabled = false;
            manualNoiseValue.style.opacity = '1';
        }
    }

    // Disable vibe transfer section and tabs when inpainting is enabled
    const vibeReferencesSection = document.getElementById('vibeReferencesSection');
    const vibeReferencesTabBtn = document.querySelector('.cache-browser-tabs .tab-btn[data-tab="vibe-references"]');
    const vibeTabBtn = document.querySelector('.cache-manager-tabs .tab-btn[data-tab="vibe"]');

    if (window.currentMaskData) {
        // Disable vibe references section
        if (vibeReferencesSection) {
            vibeReferencesSection.style.opacity = '0.5';
            vibeReferencesSection.style.pointerEvents = 'none';
        }

        // Disable vibe references tab in cache browser
        if (vibeReferencesTabBtn) {
            vibeReferencesTabBtn.style.opacity = '0.5';
            vibeReferencesTabBtn.style.pointerEvents = 'none';
            vibeReferencesTabBtn.title = 'Vibe transfers disabled during inpainting';
        }

        // Disable vibe tab in cache manager
        if (vibeTabBtn) {
            vibeTabBtn.style.opacity = '0.5';
            vibeTabBtn.style.pointerEvents = 'none';
            vibeTabBtn.title = 'Vibe transfers disabled during inpainting';
        }
    } else {
        // Re-enable vibe references section
        if (vibeReferencesSection) {
            vibeReferencesSection.style.opacity = '1';
            vibeReferencesSection.style.pointerEvents = 'auto';
        }

        // Re-enable vibe references tab in cache browser
        if (vibeReferencesTabBtn) {
            vibeReferencesTabBtn.style.opacity = '1';
            vibeReferencesTabBtn.style.pointerEvents = 'auto';
            vibeReferencesTabBtn.title = '';
        }

        // Re-enable vibe tab in cache manager
        if (vibeTabBtn) {
            vibeTabBtn.style.opacity = '1';
            vibeTabBtn.style.pointerEvents = 'auto';
            vibeTabBtn.title = '';
        }
    }

    // Show inpaint button for pipeline images or when there's uploaded image data
    const shouldShowInpaint = window.uploadedImageData || (window.currentEditMetadata && window.currentEditMetadata.request_type === 'pipeline');
    if (shouldShowInpaint) {
        if (inpaintBtn) {
            inpaintBtn.style.display = '';
        }
        // Set strength value based on mask presence
        if (manualStrengthValue) {
            if (window.currentMaskData) {
                // Set strength to 1.0 when mask is set (unless it was loaded from a preset)
                if (manualStrengthValue.textContent === '0.8') {
                    manualStrengthValue.textContent = '1.0';
                }
            } else {
                // Set strength to 0.8 when no mask (unless it was loaded from a preset)
                if (manualStrengthValue.textContent === '1.0') {
                    manualStrengthValue.textContent = '0.8';
                }
            }
        }
    } else {
        if (inpaintBtn) {
            inpaintBtn.style.display = 'none';
        }
    }
}

// Update mask preview overlay
async function updateMaskPreview() {
    const maskPreviewCanvas = document.getElementById('maskPreviewCanvas');

    if (!maskPreviewCanvas || !variationImage) {
        if (maskPreviewCanvas) {
            maskPreviewCanvas.style.display = 'none';
        }
        return;
    }

    // Wait for the image to load and get valid dimensions
    let retryCount = 0;
    const maxRetries = 20; // Increased retries for slower loading

    while (retryCount < maxRetries) {
        // Check if image is loaded and has valid dimensions
        if (variationImage.complete && variationImage.naturalWidth > 0 && variationImage.naturalHeight > 0) {
            // Get the actual displayed dimensions
            const imageRect = variationImage.getBoundingClientRect();

            // Check if the displayed dimensions are valid and the image is visible
            if (imageRect.width > 0 && imageRect.height > 0 &&
                variationImage.style.display !== 'none' &&
                variationImage.style.visibility !== 'hidden') {
                break; // Valid dimensions found, proceed
            }
        }

        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, 150)); // Slightly longer wait
        retryCount++;
    }

    if (retryCount >= maxRetries) {
        console.warn('Failed to get valid image dimensions after retries');
        if (maskPreviewCanvas) {
            maskPreviewCanvas.style.display = 'none';
        }
        return;
    }

    // Check if we have a compressed mask first
    let maskData = window.currentMaskData;
    if (window.currentMaskCompressed && !maskData) {
        // Get the current resolution for scaling
        let dims = null;
        if (manualHeight.value && manualWidth.value) {
            dims = { width: manualWidth.value, height: manualHeight.value };
        } else {
            const resolutionValue = manualResolutionHidden ? manualResolutionHidden.value : 'normal_portrait';
            dims = getDimensionsFromResolution(resolutionValue);
        }

        if (dims && dims.width > 0 && dims.height > 0) {
            try {
                // Process the compressed mask to display resolution
                maskData = await processCompressedMask(window.currentMaskCompressed, dims.width, dims.height);
            } catch (error) {
                console.error('Error processing compressed mask:', error);
                // Fallback to regular mask if available
                maskData = window.currentMaskData;
            }
        } else {
            console.warn('Invalid dimensions for mask processing:', dims);
        }
    }

    if (!maskData) {
        if (maskPreviewCanvas) {
            maskPreviewCanvas.style.display = 'none';
        }
        return;
    }

    // Validate mask data format
    if (typeof maskData !== 'string' || !maskData.startsWith('data:image/')) {
        console.warn('Invalid mask data format:', typeof maskData, maskData ? maskData.substring(0, 50) + '...' : 'null');
        if (maskPreviewCanvas) {
            maskPreviewCanvas.style.display = 'none';
        }
        return;
    }

    // Get the actual displayed dimensions of the variation image
    const imageRect = variationImage.getBoundingClientRect();
    const containerRect = variationImage.closest('.variation-image-container').getBoundingClientRect();

    // Validate that we have valid dimensions
    if (imageRect.width <= 0 || imageRect.height <= 0) {
        console.warn('Invalid image dimensions for mask preview:', imageRect);
        if (maskPreviewCanvas) {
            maskPreviewCanvas.style.display = 'none';
        }
        return;
    }

    // Set canvas size to match the actual displayed image dimensions
    maskPreviewCanvas.width = imageRect.width;
    maskPreviewCanvas.height = imageRect.height;

    // Position the canvas to overlay the image exactly
    maskPreviewCanvas.style.position = 'absolute';
    maskPreviewCanvas.style.left = (imageRect.left - containerRect.left) + 'px';
    maskPreviewCanvas.style.top = (imageRect.top - containerRect.top) + 'px';
    maskPreviewCanvas.style.width = imageRect.width + 'px';
    maskPreviewCanvas.style.height = imageRect.height + 'px';

    const ctx = maskPreviewCanvas.getContext('2d');

    // Load the mask image
    const maskImg = new Image();
    maskImg.onload = function() {
        // Validate canvas dimensions before proceeding
        if (maskPreviewCanvas.width <= 0 || maskPreviewCanvas.height <= 0) {
            console.warn('Canvas dimensions are invalid for mask preview:', {
                width: maskPreviewCanvas.width,
                height: maskPreviewCanvas.height
            });
            return;
        }

        // Clear the canvas first
        ctx.clearRect(0, 0, maskPreviewCanvas.width, maskPreviewCanvas.height);

        // Draw the mask image onto the preview canvas, maintaining aspect ratio
        ctx.drawImage(maskImg, 0, 0, maskPreviewCanvas.width, maskPreviewCanvas.height);

        // Get image data to modify colors
        const imageData = ctx.getImageData(0, 0, maskPreviewCanvas.width, maskPreviewCanvas.height);
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            // If pixel is white (masked area), make it green overlay
            if (r === 255 && g === 255 && b === 255) {
                data[i] = 149;     // Red
                data[i + 1] = 254;   // Green
                data[i + 2] = 108;   // Blue
                data[i + 3] = 200; // Semi-transparent
            } else {
                // Make black areas transparent
                data[i + 3] = 0;
            }
        }

        // Put the modified image data back
        ctx.putImageData(imageData, 0, 0);

        // Show the preview canvas
        maskPreviewCanvas.style.display = 'block';
    };
    maskImg.src = maskData;
}

// Function to detect transparent pixels in an image
function detectTransparentPixels(imageDataUrl) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = img.width;
            canvas.height = img.height;

            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;

            let transparentPixels = 0;
            const totalPixels = canvas.width * canvas.height;

            for (let i = 0; i < data.length; i += 4) {
                const alpha = data[i + 3];
                if (alpha < 128) { // Consider pixels with alpha < 128 as transparent
                    transparentPixels++;
                }
            }

            const transparentPercentage = (transparentPixels / totalPixels) * 100;
            resolve({
                hasTransparentPixels: transparentPixels > 0,
                transparentPercentage: transparentPercentage,
                transparentPixels: transparentPixels,
                totalPixels: totalPixels
            });
        };
        img.src = imageDataUrl;
    });
}

// Function to auto-fill mask based on transparent pixels
async function autoFillMaskFromTransparentPixels() {
    if (!window.uploadedImageData || !window.uploadedImageData.originalDataUrl) {
        showError('No image data available for auto-fill');
        return;
    }

    if (!window.currentMaskData) {
        showError('No existing mask found for auto-fill');
        return;
    }

    try {
        // Get the current resolution
        const currentResolution = manualResolutionHidden ? manualResolutionHidden.value : 'normal_portrait';
        const resolutionDims = getDimensionsFromResolution(currentResolution);
        if (!resolutionDims) {
            showError('Invalid resolution for auto-fill');
            return;
        }

        // Load the existing mask
        const maskImg = new Image();
        maskImg.onload = function() {
            // Step 1: Upscale the mask 8x with nearest neighbor
            const upscaledCanvas = document.createElement('canvas');
            const upscaledCtx = upscaledCanvas.getContext('2d');
            upscaledCanvas.width = resolutionDims.width;
            upscaledCanvas.height = resolutionDims.height;

            // Use nearest neighbor scaling for upscaling
            upscaledCtx.imageSmoothingEnabled = false;
            upscaledCtx.drawImage(maskImg, 0, 0, upscaledCanvas.width, upscaledCanvas.height);

            // Step 2: Apply the same transforms as the image bias
            const transformedCanvas = document.createElement('canvas');
            const transformedCtx = transformedCanvas.getContext('2d');
            transformedCanvas.width = resolutionDims.width;
            transformedCanvas.height = resolutionDims.height;

            // Fill with white background
            transformedCtx.fillStyle = '#FFFFFF';
            transformedCtx.fillRect(0, 0, transformedCanvas.width, transformedCanvas.height);

            // Apply the same transforms as the image bias, calculating delta from original bias
            const dynamicBias = window.uploadedImageData.image_bias;
            const previousBias = window.uploadedImageData.previousBias; // The bias that was active when mask was created

            if (dynamicBias && typeof dynamicBias === 'object') {
                transformedCtx.save();

                // Calculate the difference between current bias and the bias that was active when mask was created
                if (previousBias && typeof previousBias === 'object') {
                    // Calculate delta from previous bias to current bias
                    const deltaX = (dynamicBias.x || 0) - (previousBias.x || 0);
                    const deltaY = (dynamicBias.y || 0) - (previousBias.y || 0);
                    const deltaRotate = (dynamicBias.rotate || 0) - (previousBias.rotate || 0);

                    // For scale, we need to calculate the relative change
                    // If previous scale was 1.2 and current is 1.5, delta should be 1.5/1.2 = 1.25
                    const previousScale = previousBias.scale || 1;
                    const currentScale = dynamicBias.scale || 1;
                    const deltaScale = currentScale / previousScale;

                    // Calculate the source image position when the mask was created
                    // The source image fills the target area, so we need to find its top-left corner
                    const sourceImageWidth = upscaledCanvas.width;
                    const sourceImageHeight = upscaledCanvas.height;
                    const targetWidth = resolutionDims.width;
                    const targetHeight = resolutionDims.height;

                    // Calculate how the source image was positioned (like in cropImageWithDynamicBias)
                    const imageAR = sourceImageWidth / sourceImageHeight;
                    const targetAR = targetWidth / targetHeight;

                    let sourceX, sourceY, sourceWidth, sourceHeight;
                    if (imageAR > targetAR) {
                        // Image is wider than target, scale to match target height
                        sourceHeight = targetHeight;
                        sourceWidth = targetHeight * imageAR;
                        sourceX = 0;
                        sourceY = 0;
                    } else {
                        // Image is taller than target, scale to match target width
                        sourceWidth = targetWidth;
                        sourceHeight = targetWidth / imageAR;
                        sourceX = 0;
                        sourceY = 0;
                    }

                    // Apply transformations from the source image's top-left origin (like cropImageWithDynamicBias)
                    transformedCtx.translate(deltaX, deltaY);
                    transformedCtx.rotate(deltaRotate * Math.PI / 180);
                    transformedCtx.scale(deltaScale, deltaScale);
                } else {
                    // No previous bias, apply the full current bias transformations
                    // Calculate the source image position (same logic as above)
                    const sourceImageWidth = upscaledCanvas.width;
                    const sourceImageHeight = upscaledCanvas.height;
                    const targetWidth = resolutionDims.width;
                    const targetHeight = resolutionDims.height;

                    const imageAR = sourceImageWidth / sourceImageHeight;
                    const targetAR = targetWidth / targetHeight;

                    let sourceX, sourceY, sourceWidth, sourceHeight;
                    if (imageAR > targetAR) {
                        sourceHeight = targetHeight;
                        sourceWidth = targetHeight * imageAR;
                        sourceX = 0;
                        sourceY = 0;
                    } else {
                        sourceWidth = targetWidth;
                        sourceHeight = targetWidth / imageAR;
                        sourceX = 0;
                        sourceY = 0;
                    }

                    // Apply transformations from the source image's top-left origin
                    transformedCtx.translate(dynamicBias.x || 0, dynamicBias.y || 0);
                    transformedCtx.rotate((dynamicBias.rotate || 0) * Math.PI / 180);
                    transformedCtx.scale(dynamicBias.scale || 1, dynamicBias.scale || 1);
                }

                transformedCtx.drawImage(upscaledCanvas, 0, 0);
                transformedCtx.restore();
            } else {
                // For regular bias, apply the standard crop transform
                const bias = window.uploadedImageData.bias || 2;
                const originalWidth = window.uploadedImageData.originalWidth;
                const originalHeight = window.uploadedImageData.originalHeight;

                const scale = Math.max(resolutionDims.width / originalWidth, resolutionDims.height / originalHeight) * (bias / 2);
                const scaledWidth = originalWidth * scale;
                const scaledHeight = originalHeight * scale;
                const x = (resolutionDims.width - scaledWidth) / 2;
                const y = (resolutionDims.height - scaledHeight) / 2;

                // If there was a previous bias, calculate the delta
                if (previousBias && typeof previousBias === 'number') {
                    const previousScale = Math.max(resolutionDims.width / originalWidth, resolutionDims.height / originalHeight) * (previousBias / 2);
                    const previousScaledWidth = originalWidth * previousScale;
                    const previousScaledHeight = originalHeight * previousScale;
                    const previousX = (resolutionDims.width - previousScaledWidth) / 2;
                    const previousY = (resolutionDims.height - previousScaledHeight) / 2;

                    // Calculate the offset to align the mask
                    const offsetX = x - previousX;
                    const offsetY = y - previousY;
                    const scaleRatio = scale / previousScale;

                    transformedCtx.save();
                    transformedCtx.translate(offsetX, offsetY);
                    transformedCtx.scale(scaleRatio, scaleRatio);
                    transformedCtx.drawImage(upscaledCanvas, previousX, previousY, previousScaledWidth, previousScaledHeight);
                    transformedCtx.restore();
                } else {
                    transformedCtx.drawImage(upscaledCanvas, x, y, scaledWidth, scaledHeight);
                }
            }

            // Step 3: Scale down 8x with nearest neighbor
            const finalCanvas = document.createElement('canvas');
            const finalCtx = finalCanvas.getContext('2d');
            finalCanvas.width = Math.floor(resolutionDims.width / 8);
            finalCanvas.height = Math.floor(resolutionDims.height / 8);

            // Use nearest neighbor scaling
            finalCtx.imageSmoothingEnabled = false;
            finalCtx.drawImage(transformedCanvas, 0, 0, finalCanvas.width, finalCanvas.height);

            // Convert mask to base64
            const maskBase64 = finalCanvas.toDataURL('image/png');

            // Store the mask data
            window.currentMaskData = maskBase64;

            // Set inpaint button to on
            if (inpaintBtn) {
                inpaintBtn.setAttribute('data-state', 'on');
                inpaintBtn.classList.add('active');
            }

            // Update mask preview
            updateMaskPreview();
        };

        // Load the existing mask
        maskImg.src = window.currentMaskData;

    } catch (error) {
        console.error('Error auto-filling mask:', error);
        showError('Failed to auto-fill mask');
    }
}
