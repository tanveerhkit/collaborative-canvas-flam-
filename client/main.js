

let canvasManager;
let wsClient;
let remoteCursors = new Map(); // userId -> {x, y, color, userName}
let cursorUpdateInterval;
let currentUserId; // Current user's ID for admin checks


async function init() {
    // Get room ID from URL or generate new one
    const urlParams = new URLSearchParams(window.location.search);
    let roomId = urlParams.get('room');

    if (!roomId) {
        roomId = generateRoomId();
        window.history.pushState({}, '', `?room=${roomId}`);
    }

    document.getElementById('room-id').textContent = roomId;
    document.getElementById('share-link').value = window.location.href;

    // Get user name
    const userName = prompt('Enter your name:', 'User' + Math.floor(Math.random() * 1000)) || 'Anonymous';

    // Initialize canvas
    const canvas = document.getElementById('canvas');
    canvasManager = new CanvasManager(canvas);

    // Initialize WebSocket
    wsClient = new WebSocketClient(window.location.origin);

    try {
        await wsClient.connect();
        wsClient.joinRoom(roomId, userName);

        setupWebSocketCallbacks();
        setupCanvasCallbacks();
        setupUIHandlers();
        setupCursorTracking();

        showStatus('Connected', 'success');
    } catch (error) {
        console.error('Failed to connect:', error);
        showStatus('Connection failed', 'error');
    }
}

/**
 * Setup WebSocket event callbacks
 */
function setupWebSocketCallbacks() {
    wsClient.onUserInfo = (data) => {
        document.getElementById('user-name').textContent = data.userName;
        document.getElementById('user-color').style.backgroundColor = data.color;

        // Save current user ID globally
        currentUserId = data.userId;

        // Set user ID in canvas manager for permission checks
        if (canvasManager) {
            canvasManager.setUserId(data.userId);
        }

        // Show admin panel if user is admin
        const adminPanel = document.getElementById('admin-panel');
        if (data.isAdmin) {
            adminPanel.style.display = 'flex'; // Explicitly set to flex or remove property to use CSS class
            // Ideally remove property, but explicit flex ensures override if sticky
        } else {
            adminPanel.style.display = 'none';
        }
    };

    wsClient.onOperationHistory = (history) => {
        canvasManager.loadOperationHistory(history);
    };

    wsClient.onDrawingUpdate = (operation) => {
        canvasManager.addOperation(operation);
    };

    wsClient.onUserJoined = (user) => {
        showNotification(`${user.userName} joined`);
    };

    wsClient.onUserLeft = (user) => {
        showNotification(`${user.userName} left`);
        remoteCursors.delete(user.userId);
    };

    wsClient.onUserList = (users) => {
        updateUserList(users);
    };

    wsClient.onCursorUpdate = (data) => {
        remoteCursors.set(data.userId, data);
    };

    wsClient.onUndoUpdate = (data) => {
        // Find and mark the operation as undone
        const operation = canvasManager.operations.find(op => op.id === data.operationId);
        if (operation) {
            operation.undone = true;
        }
        canvasManager.redrawCanvas();
    };

    wsClient.onRedoUpdate = (data) => {
        // Find and mark the operation as not undone
        const operation = canvasManager.operations.find(op => op.id === data.operationId);
        if (operation) {
            operation.undone = false;
        }
        canvasManager.redrawCanvas();
    };

    wsClient.onCanvasCleared = (data) => {
        // Mark all operations by this user as undone locally
        canvasManager.operations.forEach(op => {
            if (op.userId === data.userId) {
                op.undone = true;
            }
        });
        canvasManager.redrawCanvas();
    };

    wsClient.onAdminCanvasCleared = () => {
        // Admin cleared all canvas - reset all operations
        canvasManager.operations = [];
        canvasManager.activeStrokes.clear();
        canvasManager.clearCanvas();
    };

    wsClient.onKicked = (data) => {
        alert(data.message);
        // Redirect to base URL (new room) instead of reloading same room
        window.location.href = window.location.origin;
    };

    wsClient.onThemeChange = (data) => {
        // Admin changed the theme for all users
        setTheme(data.theme);
        showNotification(`Theme changed to ${data.theme}`);

        // Update button states
        const lightBtn = document.getElementById('theme-light-btn');
        const darkBtn = document.getElementById('theme-dark-btn');
        if (lightBtn && darkBtn) {
            if (data.theme === 'dark') {
                darkBtn.classList.add('active');
                lightBtn.classList.remove('active');
            } else {
                lightBtn.classList.add('active');
                darkBtn.classList.remove('active');
            }
        }
    };

    wsClient.onAdminPromoted = (data) => {
        // Show admin panel when promoted to admin
        document.getElementById('admin-panel').style.display = 'block';
        showNotification(data.message);

        // Update the isAdmin flag on wsClient
        wsClient.isAdmin = true;
    };
}

/**
 * Setup canvas drawing callbacks
 */
function setupCanvasCallbacks() {
    // Override emit methods
    let lastEmitTime = 0;
    const EMIT_DELAY = 50; // Batch points every 50ms
    let lastSentIndex = 0;

    // Handle Shape/Text Completion (optimistic update)
    canvasManager.onShapeComplete = function (operation) {
        // Add locally immediately (Optimistic UI)
        // We use the ID generated in canvas.js (tempId)
        canvasManager.addOperation(operation);

        // Send to server (use dynamic type from operation)
        wsClient.sendDrawingEvent(operation.type || 'shape', operation.data);
    };

    // Handle operation move (when user drags an image)
    canvasManager.onOperationMove = function (operation) {
        // Send updated position to server
        wsClient.sendDrawingEvent('move', {
            operationId: operation.id,
            x: operation.data.x,
            y: operation.data.y
        });
    };

    // Handle operation resize (when user resizes an image)
    canvasManager.onOperationResize = function (operation) {
        // Send updated size to server
        wsClient.sendDrawingEvent('resize', {
            operationId: operation.id,
            width: operation.data.width,
            height: operation.data.height
        });
    };

    // Send incremental drawing points in real-time while drawing
    canvasManager.emitDrawingEvent = function () {
        if (!this.isDrawing || this.currentPath.length === 0) return;

        const now = Date.now();
        if (now - lastEmitTime < EMIT_DELAY) {
            return; // Throttle to avoid overwhelming network
        }

        lastEmitTime = now;

        // Send only new points since last emit (incremental streaming)
        const newPoints = this.currentPath.slice(lastSentIndex);
        if (newPoints.length > 0) {
            wsClient.sendDrawingEvent('draw-incremental', {
                points: newPoints,
                color: this.currentColor,
                width: this.currentWidth,
                tool: this.currentTool,
                isComplete: false
            });
            lastSentIndex = this.currentPath.length;
        }
    };

    canvasManager.emitCompleteStroke = function () {
        if (this.currentPath.length > 0) {
            // Send final complete stroke to ensure all points are received
            wsClient.sendDrawingEvent('draw', {
                points: this.currentPath,
                color: this.currentColor,
                width: this.currentWidth,
                tool: this.currentTool,
                isComplete: true
            });
        }
        // Reset for next stroke
        lastSentIndex = 0;
    };

    canvasManager.emitCursorMove = function (e) {
        const pos = this.getMousePos(e);
        wsClient.sendCursorMove(pos.x, pos.y);
    };
}

/**
 * Setup Sidebar Touch Gestures (Drag to Open/Close)
 */
function setupSidebarGestures() {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebar-toggle');

    if (!sidebar || !toggleBtn) return;

    // Click/Tap Toggle (Desktop & Mobile Tap)
    toggleBtn.addEventListener('click', (e) => {
        // Prevent click if it was a drag (handled in touchend)
        if (toggleBtn.getAttribute('data-dragged') === 'true') return;
        sidebar.classList.toggle('collapsed');
    });

    // Valid swipe threshold (px)
    const DRAG_THRESHOLD = 30;

    let startX = 0;
    let startY = 0;
    let initialTranslateY = 0; // For mobile
    let isDragging = false;
    let isMobile = false;

    toggleBtn.addEventListener('touchstart', (e) => {
        isDragging = true;
        isMobile = window.innerWidth <= 900;
        toggleBtn.setAttribute('data-dragged', 'false');

        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY; // Visual viewport Y

        // Disable transition for instant follow
        sidebar.style.transition = 'none';

        // Determine starting state (Open or Collapsed)
        const isCollapsed = sidebar.classList.contains('collapsed');

        // 0% (Open) to 100% (Closed)
        initialTranslateY = isCollapsed ? 100 : 0;
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
        if (!isDragging) return;

        if (isMobile) {
            // Mobile: Drag Vertical
            const deltaY = e.touches[0].clientY - startY;

            // Sidebar height for percentage calculation
            const height = sidebar.offsetHeight;

            // Calculate drag as percentage of height
            let percentDelta = (deltaY / height) * 100;

            // Apply new position (Starts at initialTranslateY)
            let currentPercent = initialTranslateY + percentDelta;

            // Clamp between 0% (Open) and 100% (Closed)
            // Allow slight overdrag for resistance feel if desired, but clamping is safer
            currentPercent = Math.max(0, Math.min(100, currentPercent));

            // Apply Transform
            // Must preserve X centering: translate3d(-50%, Y%, 0)
            sidebar.style.transform = `translate3d(-50%, ${currentPercent}%, 0)`;

            // Flag as intentional drag if moved enough
            if (Math.abs(deltaY) > 5) {
                toggleBtn.setAttribute('data-dragged', 'true');
            }
        }
        // Desktop drag could be added here if needed
    }, { passive: false });

    window.addEventListener('touchend', (e) => {
        if (!isDragging) return;
        isDragging = false;

        // Restore properties
        sidebar.style.transition = '';
        sidebar.style.transform = ''; // Clear inline to let class take over

        // Determine final state based on drag distance
        if (isMobile && toggleBtn.getAttribute('data-dragged') === 'true') {
            const endY = e.changedTouches[0].clientY;
            const distY = endY - startY;

            const isCollapsed = sidebar.classList.contains('collapsed');

            // If dragging down (positive), we want to close
            if (distY > DRAG_THRESHOLD && !isCollapsed) {
                sidebar.classList.add('collapsed');
            }
            // If dragging up (negative), we want to open
            else if (distY < -DRAG_THRESHOLD && isCollapsed) {
                sidebar.classList.remove('collapsed');
            }
            // If not moved enough, revert to original state (handled by clearing inline transform)
        }
    });
}


/**
 * Setup UI event handlers
 */
function setupUIHandlers() {
    // Sidebar Toggle & Gestures
    setupSidebarGestures();

    // Tool selection (except Image which has special handling)
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Skip Image button - it has its own handler for file dialog
            if (btn.dataset.tool === 'image') return;

            document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            canvasManager.setTool(btn.dataset.tool);
        });
    });

    // Color selection
    document.getElementById('color-picker').addEventListener('input', (e) => {
        canvasManager.setColor(e.target.value);
    });

    // Color presets
    const presets = document.querySelectorAll('.color-preset');
    presets.forEach(preset => {
        preset.addEventListener('click', (e) => {
            const color = e.target.dataset.color;
            canvasManager.setColor(color);
            colorPicker.value = color;

            // Active state
            presets.forEach(p => p.classList.remove('active'));
            e.target.classList.add('active');

            // Note: We do NOT add presets to "Recent Colors" as per user request.
            // Only custom picker colors will go there.
        });
    });

    // Track color picker changes (when user commits/closes picker)
    document.getElementById('color-picker').addEventListener('change', (e) => {
        addRecentColor(e.target.value);
    });

    // Initialize Recent Colors
    let recentColors = [];
    const recentColorsContainer = document.getElementById('recent-colors');
    const recentColorsWrapper = document.getElementById('recent-colors-container');

    function addRecentColor(color) {
        // Remove if existing to move to top
        recentColors = recentColors.filter(c => c !== color);

        // Add to front
        recentColors.unshift(color);

        // Keep max 7
        if (recentColors.length > 7) {
            recentColors.pop();
        }

        renderRecentColors();
    }

    function renderRecentColors() {
        if (!recentColorsWrapper || !recentColorsContainer) return;

        if (recentColors.length === 0) {
            recentColorsWrapper.style.display = 'none';
            return;
        }

        recentColorsWrapper.style.display = 'block';
        recentColorsContainer.innerHTML = '';

        recentColors.forEach(color => {
            const swatch = document.createElement('div');
            swatch.className = 'recent-swatch';
            swatch.style.backgroundColor = color;
            swatch.title = color;

            swatch.addEventListener('click', () => {
                canvasManager.setColor(color);
                document.getElementById('color-picker').value = color;

                // Active state cleanup if needed
                document.querySelectorAll('.color-preset').forEach(p => p.classList.remove('active'));

                // Move this color to front again?
                addRecentColor(color);
            });

            recentColorsContainer.appendChild(swatch);
        });
    }

    // Stroke width
    document.getElementById('stroke-width').addEventListener('input', (e) => {
        canvasManager.setWidth(parseInt(e.target.value));
        document.getElementById('width-value').textContent = e.target.value;
    });

    // Undo/Redo
    document.getElementById('undo-btn').addEventListener('click', () => {
        wsClient.requestUndo();
    });

    document.getElementById('redo-btn').addEventListener('click', () => {
        wsClient.requestRedo();
    });

    // Clear canvas (user clears only their drawings)
    document.getElementById('clear-btn').addEventListener('click', () => {
        if (confirm('Clear your drawings? (Only your drawings will be removed)')) {
            wsClient.requestClearCanvas();
        }
    });

    // Admin: Clear all canvas
    const adminClearBtn = document.getElementById('admin-clear-all-btn');
    if (adminClearBtn) {
        adminClearBtn.addEventListener('click', () => {
            if (confirm('Clear ALL drawings for ALL users? This cannot be undone!')) {
                wsClient.requestAdminClearAll();
            }
        });
    }

    // Admin: Global Undo/Redo
    const adminUndoBtn = document.getElementById('admin-undo-btn');
    const adminRedoBtn = document.getElementById('admin-redo-btn');

    if (adminUndoBtn && adminRedoBtn) {
        adminUndoBtn.addEventListener('click', () => {
            wsClient.socket.emit('admin-undo');
        });

        adminRedoBtn.addEventListener('click', () => {
            wsClient.socket.emit('admin-redo');
        });
    }

    // Image Upload Handling
    const imageBtn = document.getElementById('image-btn');
    const imageUpload = document.getElementById('image-upload');
    let pendingImagePosition = null; // Store position where user clicked

    if (imageBtn && imageUpload) {
        // Click image button to trigger file input (places at center)
        imageBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            pendingImagePosition = { x: 0.5, y: 0.5 }; // Center
            imageUpload.click();
        });

        // Set up canvas click handler for image tool
        canvasManager.onImagePlacement = function (pos) {
            pendingImagePosition = pos;
            imageUpload.click();
        };

        // Handle file selection
        imageUpload.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            // Validate file type
            if (!file.type.startsWith('image/')) {
                alert('Please select an image file');
                return;
            }

            // Use pending position or default to center
            const pos = pendingImagePosition || { x: 0.5, y: 0.5 };
            pendingImagePosition = null; // Reset

            // Read file as Data URL
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    // Compress/Resize Image
                    const MAX_SIZE = 1200; // Limit max dimension to 1200px
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > MAX_SIZE) {
                            height *= MAX_SIZE / width;
                            width = MAX_SIZE;
                        }
                    } else {
                        if (height > MAX_SIZE) {
                            width *= MAX_SIZE / height;
                            height = MAX_SIZE;
                        }
                    }

                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = width;
                    tempCanvas.height = height;
                    const ctx = tempCanvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    // Convert to slightly compressed JPEG to save bandwidth
                    const compressDataUrl = tempCanvas.toDataURL('image/jpeg', 0.8);

                    // Create image operation at clicked position
                    const tempId = 'temp-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
                    const operation = {
                        type: 'image',
                        id: tempId,
                        userId: canvasManager.currentUserId, // Attach user ID for local ownership check
                        data: {
                            tempId: tempId,
                            x: pos.x,
                            y: pos.y,
                            src: compressDataUrl,
                            width: 0.3, // 30% of canvas width
                            height: 0.3, // Will be adjusted to maintain aspect ratio
                        }
                    };

                    // Add locally and send to server
                    canvasManager.addOperation(operation);
                    wsClient.sendDrawingEvent('image', operation.data);
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);

            // Reset input to allow same file selection
            imageUpload.value = '';
        });
    }

    // Theme toggle buttons
    const lightBtn = document.getElementById('theme-light-btn');
    const darkBtn = document.getElementById('theme-dark-btn');

    if (lightBtn && darkBtn) {
        lightBtn.addEventListener('click', () => {
            wsClient.setTheme('light');
            setTheme('light');
            lightBtn.classList.add('active');
            darkBtn.classList.remove('active');
        });

        darkBtn.addEventListener('click', () => {
            wsClient.setTheme('dark');
            setTheme('dark');
            darkBtn.classList.add('active');
            lightBtn.classList.remove('active');
        });
    }

    // Copy share link
    document.getElementById('copy-link-btn').addEventListener('click', () => {
        const input = document.getElementById('share-link');
        input.select();
        document.execCommand('copy');
        showNotification('Link copied!');
    });
}

/**
 * Set theme for the application
 */
function setTheme(theme) {
    document.body.classList.remove('light-theme', 'dark-theme');
    document.body.classList.add(theme + '-theme');
}

/**
 * Setup cursor tracking and rendering
 */
function setupCursorTracking() {
    // Get cursor overlay canvas
    const cursorCanvas = document.getElementById('cursor-overlay');
    const cursorCtx = cursorCanvas.getContext('2d');

    // Match overlay canvas size to main canvas
    function resizeCursorCanvas() {
        const mainCanvas = document.getElementById('canvas');
        cursorCanvas.width = mainCanvas.width;
        cursorCanvas.height = mainCanvas.height;
    }

    resizeCursorCanvas();
    window.addEventListener('resize', resizeCursorCanvas);

    // Render remote cursors periodically
    cursorUpdateInterval = setInterval(() => {
        // Clear cursor overlay
        cursorCtx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);

        // Draw all remote cursors
        remoteCursors.forEach((cursorData, userId) => {
            drawCursor(cursorCtx, cursorData);
        });
    }, 16); // ~60fps for smooth cursor movement
}

/**
 * Draw a single cursor
 */
function drawCursor(ctx, cursorData) {
    const { x, y, userColor, userName } = cursorData;

    // x, y are normalized (0-1)
    // 1. Convert to World Pixels
    // We can use canvasManager helper if available, or calc manually
    const worldX = x * canvasManager.canvas.width;
    const worldY = y * canvasManager.canvas.height;

    // 2. Convert to Screen Pixels (Apply Camera Transform)
    const { zoom, x: panX, y: panY } = canvasManager.camera;
    const screenX = worldX * zoom + panX;
    const screenY = worldY * zoom + panY;

    ctx.save();

    // Draw cursor circle
    ctx.beginPath();
    ctx.arc(screenX, screenY, 8, 0, Math.PI * 2);
    ctx.fillStyle = userColor;
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw inner dot
    ctx.beginPath();
    ctx.arc(screenX, screenY, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();

    // Draw user name label
    ctx.font = 'bold 12px Arial';
    ctx.fillStyle = userColor;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 3;

    const label = userName;
    ctx.moveTo(x, y);
    ctx.lineTo(x - 5, y + 12);
    ctx.lineTo(x + 5, y + 12);
    ctx.closePath();
    ctx.fillStyle = userColor;
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
}

/**
 * Update user list UI
 */
function updateUserList(users) {
    const userList = document.getElementById('user-list');
    userList.innerHTML = '';

    const currentUserId = wsClient.userId;
    const isCurrentUserAdmin = users.find(u => u.id === currentUserId)?.isAdmin;

    users.forEach(user => {
        const userItem = document.createElement('div');
        userItem.className = 'user-item';

        let adminBadge = '';
        if (user.isAdmin) {
            adminBadge = '<span class="admin-badge" title="Admin">👑</span>';
        }

        let adminActions = '';

        // Show admin actions if current user is admin and target is not self
        if (isCurrentUserAdmin && user.id !== currentUserId) {
            adminActions = `
                <div class="user-actions">
                    <button class="user-action-btn kick" onclick="kickUser('${user.id}')" title="Kick User">
                        <i class="fa-solid fa-user-xmark"></i>
                    </button>
                </div>
            `;
        }

        userItem.innerHTML = `
            <div class="user-color" style="background-color: ${user.color}"></div>
            <span class="user-name">${user.name}</span>
            ${adminBadge}
            ${adminActions}
        `;
        userList.appendChild(userItem);
    });

    document.getElementById('user-count').textContent = users.length;
}

/**
 * Admin: Kick user
 */
function kickUser(userId) {
    if (confirm('Remove this user from the room?')) {
        wsClient.adminKickUser(userId);
    }
}

/**
 * Admin: Transfer admin rights
 */
// Expose functions to global scope for HTML onclick handlers
window.kickUser = kickUser;

// changeUserColor function removed as individual color changing is deprecated in favor of theme toggling

/**
 * Show status message
 */
function showStatus(message, type) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = `status ${type}`;

    setTimeout(() => {
        status.className = 'status';
    }, 3000);
}

/**
 * Show notification
 */
function showNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.classList.add('show');
    }, 10);

    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 2000);
}

/**
 * Generate random room ID
 */
function generateRoomId() {
    return 'room-' + Math.random().toString(36).substr(2, 9);
}

// Initialize on page load
window.addEventListener('load', init);
