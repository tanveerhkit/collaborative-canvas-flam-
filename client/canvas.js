

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
        this.activeStrokes = new Map(); // userId -> {points, color, width, tool}

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

        // Store current canvas content
        const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);

        // Resize canvas
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;

        // Restore canvas content
        this.ctx.putImageData(imageData, 0, 0);

        // Redraw all operations
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

        // Touch events for mobile
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const mouseEvent = new MouseEvent('mousedown', {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            this.canvas.dispatchEvent(mouseEvent);
        });

        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const mouseEvent = new MouseEvent('mousemove', {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            this.canvas.dispatchEvent(mouseEvent);
        });

        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            const mouseEvent = new MouseEvent('mouseup', {});
            this.canvas.dispatchEvent(mouseEvent);
        });
    }

    /**
     * Get mouse position relative to canvas
     */
    getMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    /**
     * Start drawing
     */
    startDrawing(e) {
        this.isDrawing = true;
        const pos = this.getMousePos(e);
        this.currentPath = [pos];
        this.lastPoint = pos;

        // Setup stroke style once at start
        this.ctx.strokeStyle = this.currentTool === 'eraser' ? '#FFFFFF' : this.currentColor;
        this.ctx.lineWidth = this.currentWidth;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';

        // Draw initial point as a dot
        this.ctx.beginPath();
        this.ctx.arc(pos.x, pos.y, this.currentWidth / 2, 0, Math.PI * 2);
        this.ctx.fillStyle = this.currentTool === 'eraser' ? '#FFFFFF' : this.currentColor;
        this.ctx.fill();
    }

    /**
     * Draw on canvas - uses midpoint quadratic curves for perfect smoothness
     */
    draw(e) {
        if (!this.isDrawing) {
            // Just emit cursor position for other users
            this.emitCursorMove(e);
            return;
        }

        const pos = this.getMousePos(e);

        // Don't draw if point hasn't moved
        if (pos.x === this.lastPoint.x && pos.y === this.lastPoint.y) return;

        this.currentPath.push(pos);

        // Core Smoothing Logic:
        // Instead of drawing to the current point, we draw to the MIDPOINT between last and current.
        // The last point serves as the control point for the quadratic curve.
        // This ensures C1 continuity (smooth tangents) at every segment join.

        const midPoint = {
            x: (this.lastPoint.x + pos.x) / 2,
            y: (this.lastPoint.y + pos.y) / 2
        };

        if (this.currentPath.length === 2) {
            // Second point: just draw a line from start to the first midpoint
            this.ctx.beginPath();
            this.ctx.moveTo(this.currentPath[0].x, this.currentPath[0].y);
            this.ctx.lineTo(midPoint.x, midPoint.y);
            this.ctx.stroke();
        } else {
            // Third point onwards:
            // We need to start from the *previous* midpoint.
            // Since we don't store "lastMid" explicitly in class state to avoiddrift,
            // we re-calculate it from the path history.

            const prevPoint = this.currentPath[this.currentPath.length - 2];
            const prevPrevPoint = this.currentPath[this.currentPath.length - 3];

            const lastMid = {
                x: (prevPrevPoint.x + prevPoint.x) / 2,
                y: (prevPrevPoint.y + prevPoint.y) / 2
            };

            this.ctx.beginPath();
            this.ctx.moveTo(lastMid.x, lastMid.y);
            this.ctx.quadraticCurveTo(prevPoint.x, prevPoint.y, midPoint.x, midPoint.y);
            this.ctx.stroke();
        }

        this.lastPoint = pos;

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
     */
    drawOperation(operation) {
        if (!operation.data || !operation.data.points) return;

        const { points, color, width, tool } = operation.data;

        if (points.length === 0) return;

        this.ctx.beginPath();
        this.ctx.strokeStyle = tool === 'eraser' ? '#FFFFFF' : color;
        this.ctx.lineWidth = width;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';

        // Draw first point
        this.ctx.moveTo(points[0].x, points[0].y);

        // Draw smooth path through all points
        for (let i = 1; i < points.length - 1; i++) {
            const midPoint = {
                x: (points[i].x + points[i + 1].x) / 2,
                y: (points[i].y + points[i + 1].y) / 2
            };

            this.ctx.quadraticCurveTo(
                points[i].x, points[i].y,
                midPoint.x, midPoint.y
            );
        }

        // Draw to last point
        if (points.length > 1) {
            const lastPoint = points[points.length - 1];
            this.ctx.lineTo(lastPoint.x, lastPoint.y);
        }

        this.ctx.stroke();
    }

    /**
     * Redraw entire canvas from operations
     */
    redrawCanvas() {
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Redraw all operations
        this.operations.forEach(op => {
            if (!op.undone) {
                this.drawOperation(op);
            }
        });
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
                this.drawOperation(operation);
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
        // Draw cursor indicator
        this.ctx.save();

        // Draw circle
        this.ctx.beginPath();
        this.ctx.arc(x, y, 5, 0, Math.PI * 2);
        this.ctx.fillStyle = color;
        this.ctx.fill();
        this.ctx.strokeStyle = '#FFFFFF';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        // Draw user name
        this.ctx.font = '12px Arial';
        this.ctx.fillStyle = color;
        this.ctx.fillText(userName, x + 10, y - 10);

        this.ctx.restore();
    }

    /**
     * Draw incremental points in real-time
     */
    drawIncrementalPoints(points, color, width, tool) {
        if (points.length === 0) return;

        this.ctx.beginPath();
        this.ctx.strokeStyle = tool === 'eraser' ? '#FFFFFF' : color;
        this.ctx.lineWidth = width;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';

        if (points.length < 3) {
            // Fallback for start of stroke or small updates
            this.ctx.moveTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length; i++) {
                this.ctx.lineTo(points[i].x, points[i].y);
            }
            this.ctx.stroke();
        } else {
            // Smooth curve
            // Note: points[0] might be '2nd last' from previous batch if we sliced -2
            // So we start drawing from mid(p0, p1) which should match where we left off

            this.ctx.moveTo(
                (points[0].x + points[1].x) / 2,
                (points[0].y + points[1].y) / 2
            );

            for (let i = 1; i < points.length - 1; i++) {
                const midPoint = {
                    x: (points[i].x + points[i + 1].x) / 2,
                    y: (points[i].y + points[i + 1].y) / 2
                };

                this.ctx.quadraticCurveTo(
                    points[i].x, points[i].y,
                    midPoint.x, midPoint.y
                );
            }
            // For the very last segment, just line to the end? 
            // Or better, let the next update handle the curve.
            // But we must render something to the tip.
            const last = points[points.length - 1];
            this.ctx.lineTo(last.x, last.y);

            this.ctx.stroke();
        }
    }
}
