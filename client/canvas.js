

class CanvasManager {
    constructor(canvasElement) {
        this.canvas = canvasElement;
        this.ctx = canvasElement.getContext('2d');

        // Drawing state
        this.isDrawing = false;
        this.currentPath = [];
        this.currentTool = 'select';
        this.currentColor = '#000000';
        this.currentWidth = 2;

        // Operation history for rendering
        this.operations = [];

        // Active strokes being drawn by other users (for real-time incremental updates)
        this.activeStrokes = new Map(); // userId -> { points, color, width, tool }

        // Camera State (Zoom & Pan)
        this.camera = {
            x: 0,
            y: 0,
            zoom: 1
        };
        this.isPanning = false;
        this.lastPanPoint = { x: 0, y: 0 };
        this.lastPinchDist = 0;
        this.lastPinchCenter = null;

        // Shape Preview Overlay Canvas
        this.previewCanvas = document.getElementById('shape-preview');
        this.previewCtx = this.previewCanvas ? this.previewCanvas.getContext('2d') : null;

        // Selection/Move State
        this.selectedOperation = null; // Currently selected operation (for move)
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };

        // Image cache for hit detection and rendering
        this.imageCache = new Map(); // operationId -> loaded Image object

        // Resize State
        this.isResizing = false;
        this.resizeCorner = null; // 'tl', 'tr', 'bl', 'br'
        this.resizeStartSize = { width: 0, height: 0 };
        this.resizeStartPos = { x: 0, y: 0 };
        this.HANDLE_SIZE = 0.05; // Size of corner handles (normalized) - 5% of canvas

        // Setup canvas
        this.setupCanvas();
        this.setupEventListeners();
    }

    /**
     * Setup canvas size and properties
     */
    setupCanvas() {
        // Set canvas size to fill container
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());

        // Set default canvas properties
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
    }

    /**
     * Resize canvas to fit container
     */
    resizeCanvas() {
        const container = this.canvas.parentElement;
        const rect = container.getBoundingClientRect();

        // Resize canvas
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;

        // Resize preview canvas if exists
        if (this.previewCanvas) {
            this.previewCanvas.width = rect.width;
            this.previewCanvas.height = rect.height;
        }

        // Redraw all operations (resolution independent)
        this.redrawCanvas();
    }

    /**
     * Setup mouse and touch event listeners
     */
    setupEventListeners() {
        // Mouse events
        this.canvas.addEventListener('mousedown', (e) => this.startDrawing(e));
        this.canvas.addEventListener('mousemove', (e) => this.draw(e));
        this.canvas.addEventListener('mouseup', () => this.stopDrawing());
        this.canvas.addEventListener('mouseout', () => this.stopDrawing());

        // Zoom (Wheel)
        this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });

        // Touch events for mobile
        this.canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                // Pinched / Pan Start
                this.handleTouchStart(e);
            } else {
                e.preventDefault();
                const touch = e.touches[0];
                const mouseEvent = new MouseEvent('mousedown', {
                    clientX: touch.clientX,
                    clientY: touch.clientY
                });
                this.canvas.dispatchEvent(mouseEvent);
            }
        }, { passive: false });

        this.canvas.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2) {
                // Pinched / Pan Move
                this.handleTouchMove(e);
            } else {
                e.preventDefault();
                const touch = e.touches[0];
                const mouseEvent = new MouseEvent('mousemove', {
                    clientX: touch.clientX,
                    clientY: touch.clientY
                });
                this.canvas.dispatchEvent(mouseEvent);
            }
        }, { passive: false });

        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            const mouseEvent = new MouseEvent('mouseup', {});
            this.canvas.dispatchEvent(mouseEvent);
            this.handleTouchEnd(e);
        });
    }

    handleWheel(e) {
        e.preventDefault();
        const zoomSensitivity = 0.001;
        const delta = -e.deltaY * zoomSensitivity;
        const newZoom = Math.min(Math.max(0.1, this.camera.zoom + delta), 5); // Limit zoom 0.1x to 5x

        // Zoom towards mouse pointer
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Calculate world point before zoom
        const worldX = (mouseX - this.camera.x) / this.camera.zoom;
        const worldY = (mouseY - this.camera.y) / this.camera.zoom;

        // Apply new zoom
        this.camera.zoom = newZoom;

        // Calculate new camera position to keep world point under mouse
        this.camera.x = mouseX - worldX * this.camera.zoom;
        this.camera.y = mouseY - worldY * this.camera.zoom;

        this.redrawCanvas();
    }

    handleTouchStart(e) {
        if (e.touches.length === 2) {
            this.isDrawing = false; // Stop drawing if pinching
            const touch1 = e.touches[0];
            const touch2 = e.touches[1];

            // Calculate initial distance
            const dx = touch1.clientX - touch2.clientX;
            const dy = touch1.clientY - touch2.clientY;
            this.lastPinchDist = Math.sqrt(dx * dx + dy * dy);

            // Calculate center point
            this.lastPinchCenter = {
                x: (touch1.clientX + touch2.clientX) / 2,
                y: (touch1.clientY + touch2.clientY) / 2
            };
        }
    }

    handleTouchMove(e) {
        if (e.touches.length === 2) {
            e.preventDefault(); // Prevent browser zoom

            const touch1 = e.touches[0];
            const touch2 = e.touches[1];

            // Calculate new distance
            const dx = touch1.clientX - touch2.clientX;
            const dy = touch1.clientY - touch2.clientY;
            const currentDist = Math.sqrt(dx * dx + dy * dy);

            // Calculate new center
            const currentCenter = {
                x: (touch1.clientX + touch2.clientX) / 2,
                y: (touch1.clientY + touch2.clientY) / 2
            };

            if (this.lastPinchDist > 0) {
                // Determine zoom factor
                const zoomFactor = currentDist / this.lastPinchDist;

                // Limit zoom speed/bounds
                let newZoom = this.camera.zoom * zoomFactor;
                newZoom = Math.min(Math.max(0.1, newZoom), 5);

                // Zoom towards the center of the pinch
                const rect = this.canvas.getBoundingClientRect();
                const centerX = this.lastPinchCenter.x - rect.left;
                const centerY = this.lastPinchCenter.y - rect.top;

                // World Point under the pinch center (before zoom)
                const worldX = (centerX - this.camera.x) / this.camera.zoom;
                const worldY = (centerY - this.camera.y) / this.camera.zoom;

                // Pan logic (movement of the center point itself)
                const panDX = currentCenter.x - this.lastPinchCenter.x;
                const panDY = currentCenter.y - this.lastPinchCenter.y;

                // Apply new zoom
                this.camera.zoom = newZoom;

                // Update Camera X/Y:
                // 1. Keep world point stationary relative to zoom
                this.camera.x = centerX - worldX * this.camera.zoom;
                this.camera.y = centerY - worldY * this.camera.zoom;

                // 2. Apply the pan movement (fingers moving together)
                this.camera.x += panDX;
                this.camera.y += panDY;

                this.redrawCanvas();
            }

            // Update state for next frame
            this.lastPinchDist = currentDist;
            this.lastPinchCenter = currentCenter;
        }
    }

    handleTouchEnd(e) {
        // Reset pinch state if fingers lifted
        if (e.touches.length < 2) {
            this.lastPinchDist = 0;
            this.lastPinchCenter = null;
        }
    }

    /**
     * Get mouse position relative to canvas
     */
    /**
     * Get mouse position relative to canvas (Normalized 0-1)
     */
    getMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        // Screen Coordinates
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;

        // Apply Inverse Camera Transform (Screen -> World Pixels)
        const worldPixelX = (screenX - this.camera.x) / this.camera.zoom;
        const worldPixelY = (screenY - this.camera.y) / this.camera.zoom;

        // Normalize (0-1) based on actual canvas dimensions
        return {
            x: worldPixelX / this.canvas.width,
            y: worldPixelY / this.canvas.height
        };
    }

    /**
     * Convert normalized coordinates to pixel coordinates
     */
    toPixelPos(normalizedPos) {
        return {
            x: normalizedPos.x * this.canvas.width,
            y: normalizedPos.y * this.canvas.height
        };
    }

    /**
     * Start drawing
     */
    startDrawing(e) {
        // Text Tool Logic - Show inline text input
        if (this.currentTool === 'text') {
            e.preventDefault();
            e.stopPropagation();

            const pos = this.getMousePos(e); // Normalized
            const pixelPos = this.toPixelPos(pos);

            // Get screen coordinates accounting for camera
            const screenX = pixelPos.x * this.camera.zoom + this.camera.x;
            const screenY = pixelPos.y * this.camera.zoom + this.camera.y;

            // Remove any existing text input
            const existingInput = document.getElementById('text-input-overlay');
            if (existingInput) {
                existingInput.remove();
            }

            // Create new text input element
            const textInput = document.createElement('input');
            textInput.id = 'text-input-overlay';
            textInput.type = 'text';
            textInput.placeholder = 'Type and press Enter...';
            textInput.style.cssText = `
                position: absolute;
                left: ${screenX}px;
                top: ${screenY}px;
                display: block;
                background: rgba(255, 255, 255, 0.95);
                border: 2px solid #6366f1;
                border-radius: 4px;
                padding: 4px 8px;
                font-family: 'Plus Jakarta Sans', sans-serif;
                font-size: ${Math.max(16, this.currentWidth * 4)}px;
                color: ${this.currentColor};
                min-width: 150px;
                outline: none;
                z-index: 1000;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
            `;

            this.canvas.parentElement.appendChild(textInput);

            // Store position for later use
            const savedPos = { x: pos.x, y: pos.y };
            const color = this.currentColor;
            const fontSize = Math.max(16, this.currentWidth * 4);
            const self = this;

            // Handle Enter key to finalize text
            textInput.onkeydown = function (event) {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    const text = textInput.value.trim();
                    if (text) {
                        const tempId = 'temp-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
                        const operation = {
                            type: 'text',
                            id: tempId,
                            data: {
                                tempId: tempId,
                                x: savedPos.x,
                                y: savedPos.y,
                                text: text,
                                color: color,
                                fontSize: fontSize,
                                font: 'Plus Jakarta Sans, sans-serif'
                            }
                        };

                        if (self.onShapeComplete) {
                            self.onShapeComplete(operation);
                        }
                    }
                    textInput.remove();
                } else if (event.key === 'Escape') {
                    textInput.remove();
                }
            };

            // Focus after a delay to prevent immediate blur
            setTimeout(() => {
                textInput.focus();
            }, 50);

            return;
        }

        // Select Tool Logic - Click to select/deselect images or resize
        if (this.currentTool === 'select') {
            const pos = this.getMousePos(e); // Normalized

            // First check if clicking on a corner handle of ANY image
            const cornerResult = this.findCornerAtPosition(pos);
            if (cornerResult) {
                // Start resizing this image
                this.selectedOperation = cornerResult.operation;
                this.isResizing = true;
                this.resizeCorner = cornerResult.corner;
                this.resizeStartSize = {
                    width: cornerResult.operation.data.width,
                    height: cornerResult.operation.data.height
                };
                this.resizeStartPos = { x: pos.x, y: pos.y };
                this.canvas.style.cursor = cornerResult.corner.includes('t') ?
                    (cornerResult.corner.includes('l') ? 'nw-resize' : 'ne-resize') :
                    (cornerResult.corner.includes('l') ? 'sw-resize' : 'se-resize');
                this.redrawCanvas();
                return;
            }

            // Check if clicking on an image operation (for move)
            const clickedOp = this.findOperationAtPosition(pos);

            if (clickedOp && clickedOp.type === 'image') {
                this.selectedOperation = clickedOp;
                this.isDragging = true;
                this.dragOffset = {
                    x: pos.x - clickedOp.data.x,
                    y: pos.y - clickedOp.data.y
                };
                this.canvas.style.cursor = 'grabbing';
            } else {
                this.selectedOperation = null;
            }
            this.redrawCanvas();
            return;
        }

        // Image Tool Logic - Click to place image at this position
        if (this.currentTool === 'image') {
            const pos = this.getMousePos(e); // Normalized
            if (this.onImagePlacement) {
                this.onImagePlacement(pos);
            }
            return;
        }

        this.isDrawing = true;
        const pos = this.getMousePos(e); // Normalized
        this.startPoint = pos; // Save start point for shapes
        this.currentPath = [pos];
        this.lastPoint = pos;

        // Draw initial point (only for freehand)
        if (['brush', 'eraser'].includes(this.currentTool)) {
            const pixelPos = this.toPixelPos(pos);
            this.ctx.save();
            this.ctx.setTransform(this.camera.zoom, 0, 0, this.camera.zoom, this.camera.x, this.camera.y);

            this.ctx.beginPath();
            this.ctx.arc(pixelPos.x, pixelPos.y, this.currentWidth / 2, 0, Math.PI * 2);
            this.ctx.fillStyle = this.currentTool === 'eraser' ? '#FFFFFF' : this.currentColor;
            this.ctx.fill();
            this.ctx.restore();
        }
    }

    /**
     * Draw on canvas - handles Freehand and Shape previews
     */
    draw(e) {
        const pos = this.getMousePos(e); // Normalized

        // Select Tool - Resizing selected image
        if (this.currentTool === 'select' && this.isResizing && this.selectedOperation) {
            const op = this.selectedOperation;

            // Calculate size change based on corner being dragged
            const deltaX = pos.x - this.resizeStartPos.x;
            const deltaY = pos.y - this.resizeStartPos.y;

            // Determine scale factor based on corner
            let newWidth = this.resizeStartSize.width;
            let newHeight = this.resizeStartSize.height;

            if (this.resizeCorner === 'br') {
                newWidth = Math.max(0.05, this.resizeStartSize.width + deltaX * 2);
                newHeight = Math.max(0.05, this.resizeStartSize.height + deltaY * 2);
            } else if (this.resizeCorner === 'bl') {
                newWidth = Math.max(0.05, this.resizeStartSize.width - deltaX * 2);
                newHeight = Math.max(0.05, this.resizeStartSize.height + deltaY * 2);
            } else if (this.resizeCorner === 'tr') {
                newWidth = Math.max(0.05, this.resizeStartSize.width + deltaX * 2);
                newHeight = Math.max(0.05, this.resizeStartSize.height - deltaY * 2);
            } else if (this.resizeCorner === 'tl') {
                newWidth = Math.max(0.05, this.resizeStartSize.width - deltaX * 2);
                newHeight = Math.max(0.05, this.resizeStartSize.height - deltaY * 2);
            }

            // Enforce minimum size
            newWidth = Math.max(0.05, newWidth);
            newHeight = Math.max(0.05, newHeight);

            // Constraint to aspect ratio if image is loaded
            const img = this.imageCache.get(op.id);
            if (img && img.complete && img.naturalWidth && img.naturalHeight) {
                const aspectRatio = img.naturalWidth / img.naturalHeight;

                // Calculate dimensions that maintain aspect ratio while fitting in the dragged box
                let finalWidth = newWidth;
                let finalHeight = newWidth / aspectRatio;

                // If calculated height exceeds the drag height, constrain by height instead
                if (finalHeight > newHeight) {
                    finalHeight = newHeight;
                    finalWidth = finalHeight * aspectRatio;
                }

                newWidth = finalWidth;
                newHeight = finalHeight;
            }

            op.data.width = newWidth;
            op.data.height = newHeight;

            // Draw preview on overlay
            this.drawImagePreview(op);
            return;
        }

        // Select Tool - Dragging selected image
        if (this.currentTool === 'select' && this.isDragging && this.selectedOperation) {
            // Update the selected operation's position
            const newX = pos.x - this.dragOffset.x;
            const newY = pos.y - this.dragOffset.y;
            this.selectedOperation.data.x = newX;
            this.selectedOperation.data.y = newY;

            // Draw preview on overlay canvas (don't redraw main canvas)
            if (this.previewCtx && this.selectedOperation.type === 'image') {
                const op = this.selectedOperation;

                // Clear preview canvas
                this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);

                // Apply camera transform
                this.previewCtx.save();
                this.previewCtx.setTransform(this.camera.zoom, 0, 0, this.camera.zoom, this.camera.x, this.camera.y);

                const { src, width, height } = op.data;
                const pixelPos = this.toPixelPos({ x: newX, y: newY });
                const imgWidth = width * this.canvas.width;
                const imgHeight = height * this.canvas.height;

                // Use cached image if available
                let img = this.imageCache.get(op.id);
                if (!img) {
                    img = new Image();
                    img.src = src;
                    this.imageCache.set(op.id, img);
                }

                if (img.complete) {
                    const aspectRatio = img.width / img.height;
                    let finalWidth = imgWidth;
                    let finalHeight = imgWidth / aspectRatio;
                    if (finalHeight > imgHeight) {
                        finalHeight = imgHeight;
                        finalWidth = imgHeight * aspectRatio;
                    }
                    const finalX = pixelPos.x - finalWidth / 2;
                    const finalY = pixelPos.y - finalHeight / 2;

                    this.previewCtx.drawImage(img, finalX, finalY, finalWidth, finalHeight);

                    // Draw selection border
                    this.previewCtx.strokeStyle = '#6366f1';
                    this.previewCtx.lineWidth = 3;
                    this.previewCtx.setLineDash([5, 5]);
                    this.previewCtx.strokeRect(finalX - 2, finalY - 2, finalWidth + 4, finalHeight + 4);
                }

                this.previewCtx.restore();
            }
            return;
        }

        if (!this.isDrawing) {
            // Check for corner hover on ANY image (for resize cursor)
            if (this.currentTool === 'select') {
                const cornerResult = this.findCornerAtPosition(pos);
                if (cornerResult) {
                    // Set resize cursor based on corner
                    if (cornerResult.corner === 'tl' || cornerResult.corner === 'br') {
                        this.canvas.style.cursor = 'nwse-resize';
                    } else {
                        this.canvas.style.cursor = 'nesw-resize';
                    }
                } else {
                    // Check if hovering over any image (show move cursor)
                    const clickedOp = this.findOperationAtPosition(pos);
                    if (clickedOp && clickedOp.type === 'image') {
                        this.canvas.style.cursor = 'move';
                    } else {
                        this.canvas.style.cursor = 'default';
                    }
                }
            }
            this.emitCursorMove(e);
            return;
        }

        // If Shape Tool (rect, circle, line) - Draw preview on OVERLAY canvas
        if (['rectangle', 'circle', 'line'].includes(this.currentTool)) {
            this.lastPoint = pos; // Track current position for final shape

            // Draw preview on overlay canvas (cleared each frame)
            if (this.previewCtx) {
                // Clear preview canvas
                this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);

                // Apply camera transform
                this.previewCtx.save();
                this.previewCtx.setTransform(this.camera.zoom, 0, 0, this.camera.zoom, this.camera.x, this.camera.y);

                const startPixel = this.toPixelPos(this.startPoint);
                const endPixel = this.toPixelPos(pos);
                const width = endPixel.x - startPixel.x;
                const height = endPixel.y - startPixel.y;

                this.previewCtx.strokeStyle = this.currentColor;
                this.previewCtx.lineWidth = this.currentWidth;
                this.previewCtx.lineCap = 'round';
                this.previewCtx.lineJoin = 'round';

                if (this.currentTool === 'rectangle') {
                    this.previewCtx.strokeRect(startPixel.x, startPixel.y, width, height);
                } else if (this.currentTool === 'circle') {
                    const radius = Math.sqrt(width * width + height * height) / 2;
                    const centerX = startPixel.x + width / 2;
                    const centerY = startPixel.y + height / 2;
                    this.previewCtx.beginPath();
                    this.previewCtx.arc(centerX, centerY, Math.abs(radius), 0, Math.PI * 2);
                    this.previewCtx.stroke();
                } else if (this.currentTool === 'line') {
                    this.previewCtx.beginPath();
                    this.previewCtx.moveTo(startPixel.x, startPixel.y);
                    this.previewCtx.lineTo(endPixel.x, endPixel.y);
                    this.previewCtx.stroke();
                }

                this.previewCtx.restore();
            }

            this.emitCursorMove(e);
            return;
        }

        // Freehand Drawing (Brush/Eraser)
        const dx = pos.x - this.lastPoint.x;
        const dy = pos.y - this.lastPoint.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < 0.0005) return;

        this.currentPath.push(pos);

        const pixelPos = this.toPixelPos(pos);
        const lastPixelPos = this.toPixelPos(this.lastPoint);

        this.ctx.save();
        this.ctx.setTransform(this.camera.zoom, 0, 0, this.camera.zoom, this.camera.x, this.camera.y);

        this.ctx.lineWidth = this.currentWidth;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.strokeStyle = this.currentTool === 'eraser' ? '#FFFFFF' : this.currentColor;

        this.ctx.beginPath();
        this.ctx.moveTo(lastPixelPos.x, lastPixelPos.y);
        this.ctx.lineTo(pixelPos.x, pixelPos.y);
        this.ctx.stroke();

        this.ctx.restore();

        this.lastPoint = pos;
        this.emitCursorMove(e);
        this.emitDrawingEvent();
    }

    /**
     * Stop drawing
     */
    stopDrawing() {
        // Handle Select tool resize end
        if (this.currentTool === 'select' && this.isResizing && this.selectedOperation) {
            this.isResizing = false;
            this.resizeCorner = null;
            this.canvas.style.cursor = 'default';

            // Clear preview canvas
            if (this.previewCtx) {
                this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
            }

            // Redraw main canvas with final size
            this.redrawCanvas();

            // Emit the updated operation to server
            if (this.onOperationResize) {
                this.onOperationResize(this.selectedOperation);
            }
            return;
        }

        // Handle Select tool drag end - emit position update
        if (this.currentTool === 'select' && this.isDragging && this.selectedOperation) {
            this.isDragging = false;
            this.canvas.style.cursor = 'default';

            // Clear preview canvas
            if (this.previewCtx) {
                this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
            }

            // Redraw main canvas with final position
            this.redrawCanvas();

            // Emit the updated operation position to server
            if (this.onOperationMove) {
                this.onOperationMove(this.selectedOperation);
            }
            return;
        }

        if (!this.isDrawing) return;
        this.isDrawing = false;

        // Finalize Shape
        if (['rectangle', 'circle', 'line'].includes(this.currentTool)) {
            // Create Shape Operation
            const tempId = 'temp-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            const operation = {
                type: 'shape',
                id: tempId, // Local ID for optimistic add
                data: {
                    tempId: tempId, // Sent to server to reflect back
                    shapeType: this.currentTool,
                    start: this.startPoint,
                    end: this.lastPoint, // Captured from last draw()
                    color: this.currentColor,
                    width: this.currentWidth,
                    filled: false // Default to outline for now
                }
            };

            // Emit using custom callback or wsClient integration
            if (this.onShapeComplete) {
                this.onShapeComplete(operation);
            }

            // Clear preview canvas
            if (this.previewCtx) {
                this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
            }
            return;
        }

        // Finalize Freehand Stroke logic
        if (this.currentPath.length > 1) {
            const lastPoint = this.currentPath[this.currentPath.length - 1];
            const prevPoint = this.currentPath[this.currentPath.length - 2];

            const lastMid = {
                x: (prevPoint.x + lastPoint.x) / 2,
                y: (prevPoint.y + lastPoint.y) / 2
            };

            this.ctx.save();
            this.ctx.setTransform(this.camera.zoom, 0, 0, this.camera.zoom, this.camera.x, this.camera.y);

            // Convert to pixels for rendering final segment
            const lastPixelPoint = this.toPixelPos(lastPoint);
            const lastPixelMid = this.toPixelPos(lastMid);

            this.ctx.beginPath();
            this.ctx.moveTo(lastPixelMid.x, lastPixelMid.y);
            this.ctx.lineTo(lastPixelPoint.x, lastPixelPoint.y);
            this.ctx.stroke();

            this.ctx.restore();
        }

        // Emit complete stroke
        if (this.currentPath.length > 0) {
            this.emitCompleteStroke();
        }

        this.currentPath = [];
    }

    /**
     * Draw a complete operation (from server or history)
     */
    drawOperation(operation) {
        if (!operation.data) return;

        // Skip drawing the selected operation while dragging (it's on preview layer)
        if (this.isDragging && this.selectedOperation && operation.id === this.selectedOperation.id) {
            return;
        }

        const { type, data } = operation;

        // Ensure we have correct context settings
        this.ctx.beginPath();
        this.ctx.strokeStyle = data.tool === 'eraser' ? '#FFFFFF' : data.color;
        this.ctx.lineWidth = data.width || 2;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.fillStyle = data.color; // For fills if needed

        if (type === 'shape') {
            const { shapeType, start, end, filled } = data;
            const startPixel = this.toPixelPos(start);
            const endPixel = this.toPixelPos(end);
            const width = endPixel.x - startPixel.x;
            const height = endPixel.y - startPixel.y;

            if (shapeType === 'rectangle') {
                if (filled) {
                    this.ctx.fillRect(startPixel.x, startPixel.y, width, height);
                } else {
                    this.ctx.strokeRect(startPixel.x, startPixel.y, width, height);
                }
            } else if (shapeType === 'circle') {
                const radius = Math.sqrt(width * width + height * height) / 2;
                const centerX = startPixel.x + width / 2;
                const centerY = startPixel.y + height / 2;

                this.ctx.beginPath();
                this.ctx.arc(centerX, centerY, Math.abs(radius), 0, Math.PI * 2);
                if (filled) this.ctx.fill();
                else this.ctx.stroke();
            } else if (shapeType === 'line') {
                this.ctx.beginPath();
                this.ctx.moveTo(startPixel.x, startPixel.y);
                this.ctx.lineTo(endPixel.x, endPixel.y);
                this.ctx.stroke();
            }
            return;
        }

        if (type === 'text') {
            const { x, y, text, color, font, fontSize } = data;
            const pixelPos = this.toPixelPos({ x, y });

            this.ctx.font = `${fontSize || 24}px ${font || 'Plus Jakarta Sans, sans-serif'}`;
            this.ctx.fillStyle = color;
            this.ctx.textBaseline = 'top';
            this.ctx.fillText(text, pixelPos.x, pixelPos.y);
            return;
        }

        if (type === 'image') {
            const { x, y, src, width, height } = data;
            const pixelPos = this.toPixelPos({ x, y });

            // Calculate pixel dimensions
            const imgWidth = width * this.canvas.width;
            const imgHeight = height * this.canvas.height;

            // Center the image at the position
            const drawX = pixelPos.x - imgWidth / 2;
            const drawY = pixelPos.y - imgHeight / 2;

            // Create image and draw
            const img = new Image();
            const self = this;
            const isSelected = this.selectedOperation && this.selectedOperation.id === operation.id;

            img.onload = () => {
                // Maintain aspect ratio
                const aspectRatio = img.width / img.height;
                let finalWidth = imgWidth;
                let finalHeight = imgWidth / aspectRatio;

                if (finalHeight > imgHeight) {
                    finalHeight = imgHeight;
                    finalWidth = imgHeight * aspectRatio;
                }

                const finalX = pixelPos.x - finalWidth / 2;
                const finalY = pixelPos.y - finalHeight / 2;

                self.ctx.drawImage(img, finalX, finalY, finalWidth, finalHeight);

                // Draw selection border if selected
                if (isSelected) {
                    self.ctx.save();
                    self.ctx.strokeStyle = '#6366f1';
                    self.ctx.lineWidth = 3;
                    self.ctx.setLineDash([5, 5]);
                    self.ctx.strokeRect(finalX - 2, finalY - 2, finalWidth + 4, finalHeight + 4);
                    self.ctx.restore();
                }
            };
            img.src = src;
            return;
        }

        // Default: Freehand Draw
        const points = data.points;
        if (!points || points.length === 0) return;

        // Convert to pixel coordinates (World)
        const pixelPoints = points.map(p => this.toPixelPos(p));

        // Draw first point
        this.ctx.moveTo(pixelPoints[0].x, pixelPoints[0].y);

        // Draw smooth path through all points
        for (let i = 1; i < pixelPoints.length - 1; i++) {
            const midPoint = {
                x: (pixelPoints[i].x + pixelPoints[i + 1].x) / 2,
                y: (pixelPoints[i].y + pixelPoints[i + 1].y) / 2
            };

            this.ctx.quadraticCurveTo(
                pixelPoints[i].x, pixelPoints[i].y,
                midPoint.x, midPoint.y
            );
        }

        // Draw to last point
        if (pixelPoints.length > 1) {
            const lastPoint = pixelPoints[pixelPoints.length - 1];
            this.ctx.lineTo(lastPoint.x, lastPoint.y);
        }

        this.ctx.stroke();
    }

    /**
     * Redraw entire canvas from operations
     */
    redrawCanvas() {
        // console.log('Redrawing canvas, operations count:', this.operations.length);
        // Clear screen (using full canvas size)
        this.ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform to clear
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Background
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Grid (Optional visual aid for infinite canvas feel)
        this.drawGrid();

        // Apply Camera Transform
        this.ctx.setTransform(this.camera.zoom, 0, 0, this.camera.zoom, this.camera.x, this.camera.y);

        // Redraw all operations
        this.operations.forEach(op => {
            if (!op.undone) {
                try {
                    this.drawOperation(op);
                } catch (e) {
                    console.error('Error drawing operation:', op, e);
                }
            }
        });

        this.ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset
    }

    drawGrid() {
        // Simple grid to visualize zoom
        const step = 50 * this.camera.zoom;
        if (step < 10) return; // Too dense

        const offsetX = this.camera.x % step;
        const offsetY = this.camera.y % step;

        this.ctx.beginPath();
        this.ctx.strokeStyle = 'rgba(0,0,0,0.05)';
        this.ctx.lineWidth = 1;

        for (let x = offsetX; x < this.canvas.width; x += step) {
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.canvas.height);
        }
        for (let y = offsetY; y < this.canvas.height; y += step) {
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.canvas.width, y);
        }
        this.ctx.stroke();
    }

    /**
     * Add operation to history
     */
    /**
     * Add operation to history
     */
    addOperation(operation) {
        // console.log('Adding operation:', operation.type, operation.id);

        if (operation.type === 'clear') {
            this.clearCanvas();
            return;
        }

        // Handle move operations - update existing operation position
        if (operation.type === 'move' && operation.data && operation.data.operationId) {
            const existingOp = this.operations.find(op => op.id === operation.data.operationId);
            if (existingOp && existingOp.data) {
                existingOp.data.x = operation.data.x;
                existingOp.data.y = operation.data.y;
                this.redrawCanvas();
            }
            return;
        }

        // Handle resize operations - update existing operation size
        if (operation.type === 'resize' && operation.data && operation.data.operationId) {
            const existingOp = this.operations.find(op => op.id === operation.data.operationId);
            if (existingOp && existingOp.data) {
                existingOp.data.width = operation.data.width;
                existingOp.data.height = operation.data.height;
                this.redrawCanvas();
            }
            return;
        }

        if (operation.type === 'draw-incremental') {
            // Handle incremental updates (real-time streaming)
            if (!this.activeStrokes.has(operation.userId)) {
                this.activeStrokes.set(operation.userId, {
                    points: [],
                    color: operation.data.color,
                    width: operation.data.width,
                    tool: operation.data.tool,
                    lastDrawnIndex: 0
                });
            }

            const activeStroke = this.activeStrokes.get(operation.userId);

            // Add new points
            if (operation.data.points && operation.data.points.length > 0) {
                activeStroke.points.push(...operation.data.points);

                // Draw new segment
                this.drawIncrementalPoints(
                    operation.data.points,
                    operation.data.color,
                    operation.data.width,
                    operation.data.tool
                );
            }
            return;
        }

        // Handle Completed Operations (Shapes, Text, Strokes)

        // 1. Reconciliation: Check if this is a confirmation of a local optimistic update
        if (operation.data && operation.data.tempId) {
            const pendingOpIndex = this.operations.findIndex(op => op.id === operation.data.tempId);
            if (pendingOpIndex !== -1) {
                console.log('Reconciled pending operation:', operation.data.tempId, '->', operation.id);
                this.operations[pendingOpIndex] = operation;
                return;
            }
        }

        // 2. Add to history if not exists
        const exists = this.operations.find(op => op.id === operation.id);
        if (!exists) {
            console.log('Pushing new operation to history:', operation.id);
            this.operations.push(operation);
        } else {
            console.log('Operation already exists:', operation.id);
            return;
        }

        // 3. Cleanup active stroke for this user (if any)
        this.activeStrokes.delete(operation.userId);

        // 4. Draw the operation (if not undone)
        if (!operation.undone) {
            this.ctx.save();
            this.ctx.setTransform(this.camera.zoom, 0, 0, this.camera.zoom, this.camera.x, this.camera.y);
            try {
                this.drawOperation(operation);
            } catch (e) {
                console.error('Error drawing new operation:', e);
            }
            this.ctx.restore();
        }
    }

    /**
     * Load operation history (for new users)
     */
    loadOperationHistory(history) {
        this.operations = history.operations || [];
        // Note: We don't use currentIndex from server for client-side rendering
        // Client always renders all non-undone operations
        this.redrawCanvas();
    }

    /**
     * Clear canvas
     */
    clearCanvas() {
        this.operations = [];
        this.redrawCanvas();
    }

    /**
     * Set drawing tool
     */
    setTool(tool) {
        this.currentTool = tool;

        // Clear selection when switching tools
        if (tool !== 'select') {
            this.selectedOperation = null;
            this.isDragging = false;
        }

        // Toggle text cursor style on canvas
        if (tool === 'text') {
            this.canvas.classList.add('text-tool-active');
            this.canvas.style.cursor = 'text';
        } else if (tool === 'select') {
            this.canvas.classList.remove('text-tool-active');
            this.canvas.style.cursor = 'default';
        } else {
            this.canvas.classList.remove('text-tool-active');
            this.canvas.style.cursor = 'crosshair';
        }
    }

    /**
     * Set drawing color
     */
    setColor(color) {
        this.currentColor = color;
    }

    /**
     * Set stroke width
     */
    setWidth(width) {
        this.currentWidth = width;
    }

    /**
     * Emit drawing event (to be overridden by main app)
     */
    emitDrawingEvent() {
        // Throttled emission - implemented in main.js
    }

    /**
     * Emit complete stroke (to be overridden by main app)
     */
    emitCompleteStroke() {
        // Implemented in main.js
    }

    /**
     * Emit cursor move (to be overridden by main app)
     */
    emitCursorMove(e) {
        // Implemented in main.js
    }

    /**
     * Draw remote cursor
     */
    drawRemoteCursor(x, y, color, userName) {
        // x, y are normalized
        const pixelPos = this.toPixelPos({ x, y });
        // Transform to Screen Coordinates manually
        const screenX = pixelPos.x * this.camera.zoom + this.camera.x;
        const screenY = pixelPos.y * this.camera.zoom + this.camera.y;

        // Draw cursor indicator (Fixed size on screen)
        this.ctx.save();
        this.ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset to Identity (Screen Coords)

        // Draw circle
        this.ctx.beginPath();
        this.ctx.arc(screenX, screenY, 5, 0, Math.PI * 2);
        this.ctx.fillStyle = color;
        this.ctx.fill();
        this.ctx.strokeStyle = '#FFFFFF';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        // Draw user name
        this.ctx.font = '12px Arial';
        this.ctx.fillStyle = color;
        this.ctx.fillText(userName, screenX + 10, screenY - 10);

        this.ctx.restore();
    }

    /**
     * Draw incremental points in real-time
     * @param {Array} points - Array of NORMALIZED points
     */
    drawIncrementalPoints(points, color, width, tool) {
        if (points.length === 0) return;

        // Convert all points to pixels (World Coordinates)
        const pixelPoints = points.map(p => this.toPixelPos(p));

        this.ctx.save();
        this.ctx.setTransform(this.camera.zoom, 0, 0, this.camera.zoom, this.camera.x, this.camera.y);

        this.ctx.beginPath();
        this.ctx.strokeStyle = tool === 'eraser' ? '#FFFFFF' : color;
        this.ctx.lineWidth = width;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';

        if (pixelPoints.length < 3) {
            // Fallback for start of stroke or small updates
            this.ctx.moveTo(pixelPoints[0].x, pixelPoints[0].y);
            for (let i = 1; i < pixelPoints.length; i++) {
                this.ctx.lineTo(pixelPoints[i].x, pixelPoints[i].y);
            }
            this.ctx.stroke();
        } else {
            // Smooth curve
            this.ctx.moveTo(
                (pixelPoints[0].x + pixelPoints[1].x) / 2,
                (pixelPoints[0].y + pixelPoints[1].y) / 2
            );

            for (let i = 1; i < pixelPoints.length - 1; i++) {
                const midPoint = {
                    x: (pixelPoints[i].x + pixelPoints[i + 1].x) / 2,
                    y: (pixelPoints[i].y + pixelPoints[i + 1].y) / 2
                };

                this.ctx.quadraticCurveTo(
                    pixelPoints[i].x, pixelPoints[i].y,
                    midPoint.x, midPoint.y
                );
            }
            const last = pixelPoints[pixelPoints.length - 1];
            this.ctx.lineTo(last.x, last.y);

            this.ctx.stroke();
        }

        this.ctx.restore();
    }

    /**
     * Find operation at given normalized position (for selection)
     * Currently only supports image operations
     */
    findOperationAtPosition(pos) {
        console.log('Finding operation at position:', pos);
        console.log('Total operations:', this.operations.length);

        // Search in reverse order (top-most first)
        for (let i = this.operations.length - 1; i >= 0; i--) {
            const op = this.operations[i];
            if (op.undone) continue;

            if (op.type === 'image') {
                const { x, y, width, height } = op.data;
                console.log('Checking image at:', { x, y, width, height });

                // Calculate bounds (image is centered at x, y)
                // Use more generous hit area for easier selection
                const halfWidth = Math.max(width / 2, 0.1);
                const halfHeight = Math.max(height / 2, 0.1);

                const left = x - halfWidth;
                const right = x + halfWidth;
                const top = y - halfHeight;
                const bottom = y + halfHeight;

                console.log('Bounds:', { left, right, top, bottom });

                // Hit test
                if (pos.x >= left && pos.x <= right && pos.y >= top && pos.y <= bottom) {
                    console.log('HIT! Selected image:', op.id);
                    return op;
                }
            }
        }
        console.log('No operation found at position');
        return null;
    }

    /**
     * Get corner handle at position (for resize)
     * Returns: 'tl', 'tr', 'bl', 'br' or null
     */
    getCornerAtPosition(pos, operation) {
        if (!operation || operation.type !== 'image') return null;

        let { x, y, width, height } = operation.data;

        // Adjust width/height to match visual aspect ratio if image is loaded
        // This ensures the handles match the visual border exactly
        const img = this.imageCache.get(operation.id);
        if (img && img.complete) {
            const aspectRatio = img.width / img.height;
            const imgWidth = width * this.canvas.width;
            const imgHeight = height * this.canvas.height;

            let finalWidth = imgWidth;
            let finalHeight = imgWidth / aspectRatio;

            if (finalHeight > imgHeight) {
                finalHeight = imgHeight;
                finalWidth = finalHeight * aspectRatio;
            }

            // Convert back to normalized units for hit detection
            width = finalWidth / this.canvas.width;
            height = finalHeight / this.canvas.height;
        }

        const halfWidth = width / 2;
        const halfHeight = height / 2;
        const handleSize = this.HANDLE_SIZE;

        console.log('Checking corners for image at:', x, y, 'size:', width, height);
        console.log('Mouse pos:', pos.x, pos.y, 'halfW:', halfWidth, 'halfH:', halfHeight);

        // Define corner positions
        const corners = {
            tl: { x: x - halfWidth, y: y - halfHeight },
            tr: { x: x + halfWidth, y: y - halfHeight },
            bl: { x: x - halfWidth, y: y + halfHeight },
            br: { x: x + halfWidth, y: y + halfHeight }
        };

        // Check each corner
        for (const [corner, cornerPos] of Object.entries(corners)) {
            const dist = Math.sqrt(
                Math.pow(pos.x - cornerPos.x, 2) +
                Math.pow(pos.y - cornerPos.y, 2)
            );
            console.log('Corner', corner, 'at', cornerPos.x, cornerPos.y, 'dist:', dist, 'handleSize:', handleSize);
            if (dist <= handleSize) {
                return corner;
            }
        }

        return null;
    }

    /**
     * Find corner handle at position for ANY image operation
     * Returns: { operation, corner } or null
     */
    findCornerAtPosition(pos) {
        // Search in reverse order (top-most first)
        for (let i = this.operations.length - 1; i >= 0; i--) {
            const op = this.operations[i];
            if (op.undone) continue;

            if (op.type === 'image') {
                const corner = this.getCornerAtPosition(pos, op);
                if (corner) {
                    console.log('Corner found:', corner, 'for image:', op.id);
                    return { operation: op, corner: corner };
                }
            }
        }
        return null;
    }

    /**
     * Draw image preview on overlay canvas (for drag/resize)
     */
    drawImagePreview(op) {
        if (!this.previewCtx || op.type !== 'image') return;

        // Clear preview canvas
        this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);

        // Apply camera transform
        this.previewCtx.save();
        this.previewCtx.setTransform(this.camera.zoom, 0, 0, this.camera.zoom, this.camera.x, this.camera.y);

        const { x, y, src, width, height } = op.data;
        const pixelPos = this.toPixelPos({ x, y });
        const imgWidth = width * this.canvas.width;
        const imgHeight = height * this.canvas.height;

        // Use cached image
        let img = this.imageCache.get(op.id);
        if (!img) {
            img = new Image();
            img.src = src;
            this.imageCache.set(op.id, img);
        }

        if (img.complete) {
            const aspectRatio = img.width / img.height;
            let finalWidth = imgWidth;
            let finalHeight = imgWidth / aspectRatio;
            if (finalHeight > imgHeight) {
                finalHeight = imgHeight;
                finalWidth = imgHeight * aspectRatio;
            }
            const finalX = pixelPos.x - finalWidth / 2;
            const finalY = pixelPos.y - finalHeight / 2;

            this.previewCtx.drawImage(img, finalX, finalY, finalWidth, finalHeight);

            // Draw selection border
            this.previewCtx.strokeStyle = '#6366f1';
            this.previewCtx.lineWidth = 3;
            this.previewCtx.setLineDash([5, 5]);
            this.previewCtx.strokeRect(finalX - 2, finalY - 2, finalWidth + 4, finalHeight + 4);

            // Draw corner handles
            this.previewCtx.setLineDash([]);
            this.previewCtx.fillStyle = '#6366f1';
            const handlePixelSize = 8;

            // TL
            this.previewCtx.fillRect(finalX - handlePixelSize / 2, finalY - handlePixelSize / 2, handlePixelSize, handlePixelSize);
            // TR
            this.previewCtx.fillRect(finalX + finalWidth - handlePixelSize / 2, finalY - handlePixelSize / 2, handlePixelSize, handlePixelSize);
            // BL
            this.previewCtx.fillRect(finalX - handlePixelSize / 2, finalY + finalHeight - handlePixelSize / 2, handlePixelSize, handlePixelSize);
            // BR
            this.previewCtx.fillRect(finalX + finalWidth - handlePixelSize / 2, finalY + finalHeight - handlePixelSize / 2, handlePixelSize, handlePixelSize);
        }

        this.previewCtx.restore();
    }
}
