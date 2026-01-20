/**
 * WebSocket Client
 * Handles WebSocket connection and event streaming
 */

class WebSocketClient {
    constructor(serverUrl) {
        this.serverUrl = serverUrl;
        this.socket = null;
        this.connected = false;
        this.roomId = null;
        this.userId = null;
        this.userName = null;
        this.userColor = null;

        // Event batching
        this.eventBatch = [];
        this.batchInterval = null;
        this.lastEmitTime = 0;
        this.BATCH_DELAY = 16; // ~60fps

        // Callbacks
        this.onUserInfo = null;
        this.onOperationHistory = null;
        this.onDrawingUpdate = null;
        this.onUserJoined = null;
        this.onUserLeft = null;
        this.onUserList = null;
        this.onCursorUpdate = null;
        this.onUndoUpdate = null;
        this.onRedoUpdate = null;
        this.onCanvasCleared = null;
        this.onAdminCanvasCleared = null;
        this.onKicked = null;
        this.onThemeChange = null;
        this.onAdminPromoted = null;
        this.onConnected = null;
        this.onDisconnected = null;
    }

    /**
     * Connect to WebSocket server
     */
    connect() {
        return new Promise((resolve, reject) => {
            try {
                this.socket = io(this.serverUrl);

                this.socket.on('connect', () => {
                    console.log('Connected to server');
                    this.connected = true;
                    if (this.onConnected) this.onConnected();
                    resolve();
                });

                this.socket.on('disconnect', () => {
                    console.log('Disconnected from server');
                    this.connected = false;
                    if (this.onDisconnected) this.onDisconnected();
                });

                this.socket.on('error', (error) => {
                    console.error('Socket error:', error);
                    reject(error);
                });

                // Setup event listeners
                this.setupEventListeners();

            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Setup event listeners for server messages
     */
    setupEventListeners() {
        // User info received
        this.socket.on('user-info', (data) => {
            this.userId = data.userId;
            this.userName = data.userName;
            this.userColor = data.color;
            this.isAdmin = data.isAdmin || false;
            console.log('User info received:', data);
            if (this.onUserInfo) this.onUserInfo(data);
        });

        // Operation history (for new users)
        this.socket.on('operation-history', (history) => {
            console.log('Operation history received:', history.operations.length, 'operations');
            if (this.onOperationHistory) this.onOperationHistory(history);
        });

        // Drawing update from other users
        this.socket.on('drawing-update', (operation) => {
            if (this.onDrawingUpdate) this.onDrawingUpdate(operation);
        });

        // User joined
        this.socket.on('user-joined', (user) => {
            console.log('User joined:', user.userName);
            if (this.onUserJoined) this.onUserJoined(user);
        });

        // User left
        this.socket.on('user-left', (user) => {
            console.log('User left:', user.userName);
            if (this.onUserLeft) this.onUserLeft(user);
        });

        // User list update
        this.socket.on('user-list', (users) => {
            if (this.onUserList) this.onUserList(users);
        });

        // Cursor update
        this.socket.on('cursor-update', (data) => {
            if (this.onCursorUpdate) this.onCursorUpdate(data);
        });

        // Undo update
        this.socket.on('undo-update', (data) => {
            if (this.onUndoUpdate) this.onUndoUpdate(data);
        });

        // Redo update
        this.socket.on('redo-update', (data) => {
            if (this.onRedoUpdate) this.onRedoUpdate(data);
        });

        // Canvas cleared
        this.socket.on('canvas-cleared', (data) => {
            if (this.onCanvasCleared) this.onCanvasCleared(data);
        });

        // Admin cleared all canvas
        this.socket.on('admin-canvas-cleared', () => {
            if (this.onAdminCanvasCleared) this.onAdminCanvasCleared();
        });

        // Kicked by admin
        this.socket.on('kicked', (data) => {
            if (this.onKicked) this.onKicked(data);
        });

        // Theme change from admin
        this.socket.on('theme-change', (data) => {
            if (this.onThemeChange) this.onThemeChange(data);
        });

        // Promoted to admin
        this.socket.on('admin-promoted', (data) => {
            if (this.onAdminPromoted) this.onAdminPromoted(data);
        });
    }

    /**
     * Join a room
     */
    joinRoom(roomId, userName) {
        this.roomId = roomId;
        this.userName = userName;

        this.socket.emit('join-room', {
            roomId: roomId,
            userName: userName
        });
    }

    /**
     * Send drawing event
     */
    sendDrawingEvent(type, data) {
        if (!this.connected) return;

        this.socket.emit('drawing-event', {
            type: type,
            data: data
        });
    }

    /**
     * Send cursor position
     * Throttled to avoid overwhelming the server
     */
    sendCursorMove(x, y) {
        if (!this.connected) return;

        const now = Date.now();
        if (now - this.lastEmitTime < this.BATCH_DELAY) {
            return; // Throttle
        }

        this.lastEmitTime = now;

        this.socket.emit('cursor-move', {
            x: x,
            y: y
        });
    }

    /**
     * Request undo
     */
    requestUndo() {
        if (!this.connected) return;
        this.socket.emit('undo-request');
    }

    /**
     * Request redo
     */
    requestRedo() {
        if (!this.connected) return;
        this.socket.emit('redo-request');
    }

    /**
     * Request canvas clear (user's own drawings)
     */
    requestClearCanvas() {
        if (!this.connected) return;
        this.socket.emit('clear-canvas');
    }

    /**
     * Admin: Request clear all canvas
     */
    requestAdminClearAll() {
        if (!this.connected) return;
        this.socket.emit('admin-clear-all');
    }

    /**
     * Admin: Kick user
     */
    adminKickUser(userId) {
        if (!this.connected) return;
        this.socket.emit('admin-kick-user', { userId });
    }

    /**
     * Admin: Set theme for all users
     */
    setTheme(theme) {
        if (!this.connected) return;
        this.socket.emit('set-theme', { theme });
    }

    /**
     * Disconnect from server
     */
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.connected = false;
        }
    }
}
