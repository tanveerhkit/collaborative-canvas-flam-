

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const roomManager = require('./rooms');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    maxHttpBufferSize: 1e7, // 10 MB limit for image uploads
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Serve static files from client directory
app.use(express.static(path.join(__dirname, '../client')));


io.on('connection', (socket) => {
    console.log(`New connection: ${socket.id}`);

    let currentUser = null;
    let currentRoom = null;

    /**
     * User joins a room
     */
    socket.on('join-room', ({ roomId, userName }) => {
        try {
            // Generate user ID
            const userId = uuidv4();

            // Add user to room
            const user = roomManager.addUser(roomId, userId, userName, socket.id);
            currentUser = user;
            currentRoom = roomId;

            // Join socket.io room
            socket.join(roomId);

            // Send user info back to client
            socket.emit('user-info', {
                userId: user.id,
                userName: user.name,
                color: user.color,
                isAdmin: user.isAdmin
            });

            // Get current drawing state
            const drawingState = roomManager.getDrawingState(roomId);
            const history = drawingState.getOperationHistory();

            // Send operation history to new user
            socket.emit('operation-history', history);

            // Notify all users in room about new user
            io.to(roomId).emit('user-joined', {
                userId: user.id,
                userName: user.name,
                color: user.color
            });

            // Send updated user list to all clients
            const users = roomManager.getRoomUsers(roomId);
            io.to(roomId).emit('user-list', users);

            console.log(`User ${userName} (${userId}) joined room ${roomId}`);
        } catch (error) {
            console.error('Error joining room:', error);
            socket.emit('error', { message: 'Failed to join room' });
        }
    });

    /**
     * Drawing event from client
     */
    socket.on('drawing-event', (data) => {
        try {
            if (!currentRoom || !currentUser) return;

            const drawingState = roomManager.getDrawingState(currentRoom);

            // Add operation to history
            const operation = {
                id: uuidv4(),
                type: data.type,
                userId: currentUser.id,
                userName: currentUser.name,
                userColor: currentUser.color,
                timestamp: Date.now(),
                data: data.data
            };

            // Only add complete strokes/shapes/images to history for undo/redo
            // Incremental updates are just broadcast for real-time rendering
            if (data.type === 'draw' || data.type === 'shape' || data.type === 'text' || data.type === 'image' || data.data.isComplete) {
                drawingState.addOperation(operation);
            }

            // Handle move operations - update existing operation position
            if (data.type === 'move' && data.data.operationId) {
                const existingOp = drawingState.operations.find(op => op.id === data.data.operationId);
                if (existingOp && existingOp.data) {
                    existingOp.data.x = data.data.x;
                    existingOp.data.y = data.data.y;
                }
            }

            // Handle resize operations - update existing operation size
            if (data.type === 'resize' && data.data.operationId) {
                const existingOp = drawingState.operations.find(op => op.id === data.data.operationId);
                if (existingOp && existingOp.data) {
                    existingOp.data.width = data.data.width;
                    existingOp.data.height = data.data.height;
                }
            }

            // Broadcast to all users in room (including sender for confirmation)
            io.to(currentRoom).emit('drawing-update', operation);

        } catch (error) {
            console.error('Error handling drawing event:', error);
        }
    });

    /**
     * Cursor movement
     */
    socket.on('cursor-move', (data) => {
        try {
            if (!currentRoom || !currentUser) return;

            // Broadcast cursor position to other users (not sender)
            socket.to(currentRoom).emit('cursor-update', {
                userId: currentUser.id,
                userName: currentUser.name,
                userColor: currentUser.color,
                x: data.x,
                y: data.y
            });
        } catch (error) {
            console.error('Error handling cursor move:', error);
        }
    });

    /**
     * Undo request
     */
    socket.on('undo-request', () => {
        try {
            if (!currentRoom || !currentUser) return;

            const drawingState = roomManager.getDrawingState(currentRoom);
            const undoneOperation = drawingState.undo(currentUser.id);

            if (undoneOperation) {
                // Broadcast undo to all users
                io.to(currentRoom).emit('undo-update', {
                    operationId: undoneOperation.id
                });

                console.log(`User ${currentUser.name} undid operation ${undoneOperation.id}`);
            }
        } catch (error) {
            console.error('Error handling undo:', error);
        }
    });

    /**
     * Redo request
     */
    socket.on('redo-request', () => {
        try {
            if (!currentRoom || !currentUser) return;

            const drawingState = roomManager.getDrawingState(currentRoom);
            const redoneOperation = drawingState.redo(currentUser.id);

            if (redoneOperation) {
                // Broadcast redo to all users
                io.to(currentRoom).emit('redo-update', {
                    operationId: redoneOperation.id
                });

                console.log(`User ${currentUser.name} redid operation ${redoneOperation.id}`);
            }
        } catch (error) {
            console.error('Error handling redo:', error);
        }
    });

    /**
     * Admin: Global Undo request
     */
    socket.on('admin-undo', () => {
        try {
            if (!currentRoom || !currentUser) return;

            // Check if user is admin
            if (!currentUser.isAdmin) {
                socket.emit('error', { message: 'Only admin can use global undo' });
                return;
            }

            const drawingState = roomManager.getDrawingState(currentRoom);
            const undoneOperation = drawingState.globalUndo();

            if (undoneOperation) {
                // Broadcast undo to all users
                io.to(currentRoom).emit('undo-update', {
                    operationId: undoneOperation.id
                });

                console.log(`Admin ${currentUser.name} performed GLOBAL UNDO on operation ${undoneOperation.id}`);
            }
        } catch (error) {
            console.error('Error handling admin-undo:', error);
        }
    });

    /**
     * Admin: Global Redo request
     */
    socket.on('admin-redo', () => {
        try {
            if (!currentRoom || !currentUser) return;

            // Check if user is admin
            if (!currentUser.isAdmin) {
                socket.emit('error', { message: 'Only admin can use global redo' });
                return;
            }

            const drawingState = roomManager.getDrawingState(currentRoom);
            const redoneOperation = drawingState.globalRedo();

            if (redoneOperation) {
                // Broadcast redo to all users
                io.to(currentRoom).emit('redo-update', {
                    operationId: redoneOperation.id
                });

                console.log(`Admin ${currentUser.name} performed GLOBAL REDO on operation ${redoneOperation.id}`);
            }
        } catch (error) {
            console.error('Error handling admin-redo:', error);
        }
    });

    /**
     * Clear canvas request (user clears only their drawings)
     */
    socket.on('clear-canvas', () => {
        try {
            if (!currentRoom || !currentUser) return;

            const drawingState = roomManager.getDrawingState(currentRoom);

            // Mark all operations by this user as undone
            drawingState.operations.forEach(op => {
                if (op.userId === currentUser.id) {
                    op.undone = true;
                }
            });

            // Broadcast to all users to redraw
            io.to(currentRoom).emit('canvas-cleared', { userId: currentUser.id });

            console.log(`User ${currentUser.name} cleared their drawings in room ${currentRoom}`);
        } catch (error) {
            console.error('Error clearing canvas:', error);
        }
    });

    /**
     * Admin: Clear all canvas
     */
    socket.on('admin-clear-all', () => {
        try {
            if (!currentRoom || !currentUser) return;

            // Check if user is admin
            if (!currentUser.isAdmin) {
                socket.emit('error', { message: 'Only admin can clear all' });
                return;
            }

            const drawingState = roomManager.getDrawingState(currentRoom);
            drawingState.clear();

            // Broadcast clear to all users
            io.to(currentRoom).emit('admin-canvas-cleared');

            console.log(`Admin ${currentUser.name} cleared all canvas in room ${currentRoom}`);
        } catch (error) {
            console.error('Error clearing canvas:', error);
        }
    });

    /**
     * Admin: Kick user
     */
    socket.on('admin-kick-user', (data) => {
        try {
            if (!currentRoom || !currentUser) return;

            // Check if user is admin
            if (!currentUser.isAdmin) {
                socket.emit('error', { message: 'Only admin can kick users' });
                return;
            }

            const targetUserId = data.userId;
            const targetUser = roomManager.getRoom(currentRoom).users.get(targetUserId);

            if (targetUser) {
                // Notify the kicked user
                io.to(targetUser.socketId).emit('kicked', {
                    message: 'You have been removed from the room by admin'
                });

                // Force disconnect
                const targetSocket = io.sockets.sockets.get(targetUser.socketId);
                if (targetSocket) {
                    targetSocket.disconnect(true);
                }

                console.log(`Admin ${currentUser.name} kicked ${targetUser.name}`);
            }
        } catch (error) {
            console.error('Error kicking user:', error);
        }
    });

    /**
     * Admin: Set theme for all users
     */
    socket.on('set-theme', (data) => {
        try {
            if (!currentRoom || !currentUser) return;

            // Check if user is admin
            if (!currentUser.isAdmin) {
                socket.emit('error', { message: 'Only admin can change theme' });
                return;
            }

            // Broadcast theme change to all users
            io.to(currentRoom).emit('theme-change', {
                theme: data.theme
            });

            console.log(`Admin ${currentUser.name} changed theme to ${data.theme}`);
        } catch (error) {
            console.error('Error changing theme:', error);
        }
    });

    /**
     * Admin: Transfer admin rights
     */
    socket.on('admin-transfer', (data) => {
        try {
            if (!currentRoom || !currentUser) return;

            // Check if user is admin
            if (!currentUser.isAdmin) {
                socket.emit('error', { message: 'Only admin can transfer rights' });
                return;
            }

            const newAdminId = data.userId;
            const result = roomManager.setAdmin(currentRoom, newAdminId);

            if (result) {
                // Determine socket ID of new admin
                const newAdminSocketId = result.newAdmin.socketId;

                // Notify new admin
                io.to(newAdminSocketId).emit('admin-promoted', {
                    message: 'You have been promoted to Admin by ' + currentUser.name
                });

                // Notify old admin (current user) - update their local state if needed
                // But the user-list update below will handle the UI flags

                // Broadcast updated user list to everyone
                const users = roomManager.getRoomUsers(currentRoom);
                io.to(currentRoom).emit('user-list', users);

                console.log(`Admin ${currentUser.name} transferred rights to ${result.newAdmin.name}`);
            }
        } catch (error) {
            console.error('Error transferring admin rights:', error);
        }
    });

    /**
     * User disconnection
     */
    socket.on('disconnect', () => {
        try {
            if (currentUser && currentRoom) {
                const wasAdmin = currentUser.isAdmin;

                // Remove user from room (this may transfer admin)
                roomManager.removeUser(currentRoom, currentUser.id);

                // Notify other users
                socket.to(currentRoom).emit('user-left', {
                    userId: currentUser.id,
                    userName: currentUser.name
                });

                // Check if admin was transferred
                const room = roomManager.getRoom(currentRoom);
                if (wasAdmin && room && room.adminId) {
                    const newAdmin = room.users.get(room.adminId);
                    if (newAdmin) {
                        // Notify new admin that they are now admin
                        io.to(newAdmin.socketId).emit('admin-promoted', {
                            message: 'You are now the room admin!'
                        });
                    }
                }

                // Send updated user list (includes isAdmin flags)
                const users = roomManager.getRoomUsers(currentRoom);
                io.to(currentRoom).emit('user-list', users);

                console.log(`User ${currentUser.name} (${currentUser.id}) left room ${currentRoom}`);
            }
        } catch (error) {
            console.error('Error handling disconnect:', error);
        }

        console.log(`Connection closed: ${socket.id}`);
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`WebSocket server ready for connections`);
});
