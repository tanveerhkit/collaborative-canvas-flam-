

class CanvasManager {
    constructor(canvasElement) {
        this.canvas = canvasElement;
        this.ctx = canvasElement.getContext('2d');

        // Drawing state
        this.isDrawing = false;
        this.currentPath = [];
        this.currentTool = 'brush';
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
        this.isDrawing = true;
        const pos = this.getMousePos(e); // Normalized
        this.currentPath = [pos];
        this.lastPoint = pos;

        // Draw initial point as a dot (convert to pixels and apply camera transform)
        const pixelPos = this.toPixelPos(pos);

        this.ctx.save();
        this.ctx.setTransform(this.camera.zoom, 0, 0, this.camera.zoom, this.camera.x, this.camera.y);

        this.ctx.beginPath();
        this.ctx.arc(pixelPos.x, pixelPos.y, this.currentWidth / 2, 0, Math.PI * 2);
        this.ctx.fillStyle = this.currentTool === 'eraser' ? '#FFFFFF' : this.currentColor;
        this.ctx.fill();

        this.ctx.restore();
    }

    /**
     * Draw on canvas - smooth drawing with continuous lines
     */
    draw(e) {
        if (!this.isDrawing) {
            // Just emit cursor position for other users
            this.emitCursorMove(e);
            return;
        }

        const pos = this.getMousePos(e); // Normalized

        // Don't draw if point hasn't moved significantly
        const dx = pos.x - this.lastPoint.x;
        const dy = pos.y - this.lastPoint.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < 0.0005) return; // Threshold to avoid jitter

        this.currentPath.push(pos);

        // Convert to pixels for local rendering (World Pixels)
        const pixelPos = this.toPixelPos(pos);
        const lastPixelPos = this.toPixelPos(this.lastPoint);

        // Setup context with camera transform
        this.ctx.save();
        this.ctx.setTransform(this.camera.zoom, 0, 0, this.camera.zoom, this.camera.x, this.camera.y);

        this.ctx.lineWidth = this.currentWidth;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.strokeStyle = this.currentTool === 'eraser' ? '#FFFFFF' : this.currentColor;

        // Draw a simple line segment (smooth because of lineCap: round)
        this.ctx.beginPath();
        this.ctx.moveTo(lastPixelPos.x, lastPixelPos.y);
        this.ctx.lineTo(pixelPos.x, pixelPos.y);
        this.ctx.stroke();

        this.ctx.restore(); // Restore transform

        this.lastPoint = pos; // Keep lastPoint normalized

        // Emit cursor position while drawing (so cursor follows the drawing)
        this.emitCursorMove(e);

        // Emit drawing event (throttled)
        this.emitDrawingEvent();
    }

    /**
     * Stop drawing
     */
    stopDrawing() {
        if (!this.isDrawing) return;

        this.isDrawing = false;

        // Finish the stroke: draw from the last midpoint to the actual final point
        if (this.currentPath.length > 1) {
            const lastPoint = this.currentPath[this.currentPath.length - 1];
            const prevPoint = this.currentPath[this.currentPath.length - 2];

            const lastMid = {
                x: (prevPoint.x + lastPoint.x) / 2,
                y: (prevPoint.y + lastPoint.y) / 2
            };

            this.ctx.beginPath();
            this.ctx.moveTo(lastMid.x, lastMid.y);
            this.ctx.lineTo(lastPoint.x, lastPoint.y);
            this.ctx.stroke();
        }

        // Emit complete stroke
        if (this.currentPath.length > 0) {
            this.emitCompleteStroke();
        }

        this.currentPath = [];
    }

    /**
     * Draw a complete operation (from server or history)
     * NOTE: Expects context to be already transformed if called inside redrawCanvas
     * But if called individually (e.g. late arrival), we might need to verify transform.
     * Since redrawCanvas handles the transform for all ops, we can assume this draws in World Coordinates.
     * BUT wait - redrawCanvas clears transform before finishing? No.
     * redrawCanvas wraps the loop in setTransform.
     * So drawOperation just needs to draw World Coordinates.
     * HOWEVER, 'addOperation' calls 'drawOperation' directly for realtime updates from other users.
     * IN THAT CASE, the context probably has Identity transform.
     * So we should check or enforce transform here?
     * Cleaner: Enforce transform inside drawOperation by using save/restore?
     * BUT if called from redrawCanvas loop, we would be doing save/restore 1000 times.
     * Let's refactor: Make drawOperation assume World Coords.
     * And callers must set transform.
     * 
     * Caller 1: redrawCanvas -> Sets transform. OK.
     * Caller 2: addOperation -> Needs to set transform.
     */
    drawOperation(operation) {
        if (!operation.data || !operation.data.points) return;

        const { points, color, width, tool } = operation.data;

        if (points.length === 0) return;

        // Convert to pixel coordinates (World)
        const pixelPoints = points.map(p => this.toPixelPos(p));

        this.ctx.beginPath();
        this.ctx.strokeStyle = tool === 'eraser' ? '#FFFFFF' : color;
        this.ctx.lineWidth = width;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';

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
                this.drawOperation(op);
            }
        });

        // Reset transform for UI/Overlays if any? NO, we might want cursor to scale too?
        // Actually, cursors should probably be drawn in world space too.
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
    addOperation(operation) {
        // Handle incremental updates (real-time streaming)
        if (operation.type === 'draw-incremental' && !operation.data.isComplete) {
            // Get or create active stroke for this user
            let activeStroke = this.activeStrokes.get(operation.userId);

            if (!activeStroke) {
                activeStroke = {
                    points: [],
                    color: operation.data.color,
                    width: operation.data.width,
                    tool: operation.data.tool,
                    lastDrawnIndex: 0
                };
                this.activeStrokes.set(operation.userId, activeStroke);
            }

            // Add new points to active stroke
            const previousLength = activeStroke.points.length;
            activeStroke.points.push(...operation.data.points);

            // Draw from last drawn point to connect smoothly
            if (activeStroke.points.length > 0) {
                // Include breakdown of overlap:
                // previousLength - 1 would give [LastPoint, NewPoints...] -> Starts at LastPoint
                // previousLength - 2 gives [2ndLast, Last, New...] -> Starts at Mid(2ndLast, Last)
                // This matches the mid-to-mid logic
                const startIndex = Math.max(0, previousLength - 2);
                const pointsToDraw = activeStroke.points.slice(startIndex);
                this.drawIncrementalPoints(pointsToDraw, operation.data.color, operation.data.width, operation.data.tool);
            }
        } else {
            // Complete stroke - check if already in history (from operation-history event)
            const exists = this.operations.find(op => op.id === operation.id);
            if (!exists) {
                this.operations.push(operation);
            }
            this.activeStrokes.delete(operation.userId);

            // Only draw if not undone
            if (!operation.undone) {
                // Ensure camera transform is applied for these updates
                this.ctx.save();
                this.ctx.setTransform(this.camera.zoom, 0, 0, this.camera.zoom, this.camera.x, this.camera.y);
                this.drawOperation(operation);
                this.ctx.restore();
            }
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
}
