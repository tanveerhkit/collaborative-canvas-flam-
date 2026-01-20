/**
 * Room Management
 * Handles user tracking, color assignment, and room state
 */

const DrawingState = require('./drawing-state');

class RoomManager {
    constructor() {
        this.rooms = new Map(); // roomId -> Room
    }

    /**
     * Get or create a room
     */
    getRoom(roomId) {
        if (!this.rooms.has(roomId)) {
            this.rooms.set(roomId, {
                id: roomId,
                users: new Map(), // userId -> User
                drawingState: new DrawingState(roomId),
                adminId: null, // First user becomes admin
                createdAt: Date.now()
            });
        }
        return this.rooms.get(roomId);
    }

    /**
     * Add a user to a room
     */
    addUser(roomId, userId, userName, socketId) {
        const room = this.getRoom(roomId);

        // First user becomes admin
        const isAdmin = room.users.size === 0;
        if (isAdmin) {
            room.adminId = userId;
        }

        // Assign a color to the user
        const color = this.assignColor(room);

        const user = {
            id: userId,
            name: userName,
            color: color,
            socketId: socketId,
            isAdmin: isAdmin,
            joinedAt: Date.now()
        };

        room.users.set(userId, user);

        return user;
    }

    /**
     * Remove a user from a room
     */
    removeUser(roomId, userId) {
        const room = this.rooms.get(roomId);
        if (!room) return null;

        const user = room.users.get(userId);
        room.users.delete(userId);

        // If admin left, assign new admin
        if (userId === room.adminId && room.users.size > 0) {
            const newAdmin = Array.from(room.users.values())[0];
            room.adminId = newAdmin.id;
            newAdmin.isAdmin = true;
        }

        // Clean up empty rooms
        if (room.users.size === 0) {
            this.rooms.delete(roomId);
        }

        return user;
    }



    /**
     * Get all users in a room
     */
    getRoomUsers(roomId) {
        const room = this.rooms.get(roomId);
        if (!room) return [];

        return Array.from(room.users.values());
    }

    /**
     * Get user by socket ID
     */
    getUserBySocketId(socketId) {
        for (const room of this.rooms.values()) {
            for (const user of room.users.values()) {
                if (user.socketId === socketId) {
                    return { user, roomId: room.id };
                }
            }
        }
        return null;
    }

    /**
     * Assign a color to a new user
     * Uses a predefined palette to ensure distinct colors
     */
    assignColor(room) {
        const colorPalette = [
            '#FF6B6B', // Red
            '#4ECDC4', // Teal
            '#45B7D1', // Blue
            '#FFA07A', // Light Salmon
            '#98D8C8', // Mint
            '#F7DC6F', // Yellow
            '#BB8FCE', // Purple
            '#85C1E2', // Sky Blue
            '#F8B739', // Orange
            '#52B788'  // Green
        ];

        const usedColors = new Set(
            Array.from(room.users.values()).map(u => u.color)
        );

        // Find first unused color
        for (const color of colorPalette) {
            if (!usedColors.has(color)) {
                return color;
            }
        }

        // If all colors used, return a random one
        return colorPalette[Math.floor(Math.random() * colorPalette.length)];
    }

    /**
     * Get drawing state for a room
     */
    getDrawingState(roomId) {
        const room = this.rooms.get(roomId);
        return room ? room.drawingState : null;
    }

    /**
     * Get room statistics
     */
    getRoomStats(roomId) {
        const room = this.rooms.get(roomId);
        if (!room) return null;

        return {
            id: room.id,
            userCount: room.users.size,
            users: Array.from(room.users.values()).map(u => ({
                id: u.id,
                name: u.name,
                color: u.color
            })),
            drawingStats: room.drawingState.getStats(),
            createdAt: room.createdAt
        };
    }
}

module.exports = new RoomManager();
