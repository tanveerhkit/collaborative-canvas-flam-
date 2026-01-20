# Architecture Documentation

## Overview

This document describes the technical architecture of the real-time collaborative drawing canvas application, including data flow, WebSocket protocol, state management, and performance optimizations.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Client Browser                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Canvas.js  │  │ WebSocket.js │  │   Main.js    │      │
│  │  (Drawing)   │◄─┤  (Network)   │◄─┤    (UI)      │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│         │                  │                                 │
└─────────┼──────────────────┼─────────────────────────────────┘
          │                  │
          │                  │ Socket.io
          │                  │
┌─────────┼──────────────────┼─────────────────────────────────┐
│         │                  ▼                                  │
│         │         ┌──────────────┐                           │
│         │         │  Server.js   │                           │
│         │         │ (WebSocket)  │                           │
│         │         └──────────────┘                           │
│         │                  │                                  │
│         │         ┌────────┴────────┐                        │
│         │         │                 │                        │
│         │    ┌────▼─────┐    ┌─────▼──────┐                │
│         │    │ Rooms.js │    │ Drawing    │                │
│         │    │ (Users)  │    │ State.js   │                │
│         │    └──────────┘    └────────────┘                │
│         │                                                    │
│         └────────────────────────────────────────────────────┤
│                      Node.js Server                          │
└──────────────────────────────────────────────────────────────┘
```

## Data Flow Diagram

### Drawing Event Flow

```
User draws on canvas
        │
        ▼
┌───────────────────┐
│  Canvas Manager   │ Collect points, draw locally
│  (canvas.js)      │ (Client-side prediction)
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  WebSocket Client │ Serialize & send drawing data
│  (websocket.js)   │ (Throttled to 60fps)
└────────┬──────────┘
         │
         │ Socket.io
         ▼
┌───────────────────┐
│  Server           │ Receive drawing event
│  (server.js)      │
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  Drawing State    │ Add to operation history
│  (drawing-state)  │ Assign operation ID
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  Broadcast        │ Send to all clients in room
│  (Socket.io)      │ (including sender)
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  All Clients      │ Receive & render operation
│  (canvas.js)      │
└───────────────────┘
```

## WebSocket Protocol

### Events: Client → Server

#### `join-room`
```javascript
{
  roomId: string,      // Room identifier
  userName: string     // User's display name
}
```

#### `drawing-event`
```javascript
{
  type: 'draw',        // Event type
  data: {
    points: [{x, y}],  // Array of drawing points
    color: string,     // Hex color code
    width: number,     // Stroke width
    tool: string       // 'brush' or 'eraser'
  }
}
```

#### `cursor-move`
```javascript
{
  x: number,           // Canvas X coordinate
  y: number            // Canvas Y coordinate
}
```

#### `undo-request`
No payload - requests undo of last operation

#### `redo-request`
No payload - requests redo of next operation

#### `clear-canvas`
No payload - requests canvas clear

### Events: Server → Client

#### `user-info`
```javascript
{
  userId: string,      // Unique user ID
  userName: string,    // User's display name
  color: string        // Assigned color
}
```

#### `operation-history`
```javascript
{
  operations: [        // Array of all operations
    {
      id: string,
      type: string,
      userId: string,
      userName: string,
      userColor: string,
      timestamp: number,
      data: {...},
      undone: boolean
    }
  ],
  currentIndex: number // Current position in history
}
```

#### `drawing-update`
```javascript
{
  id: string,          // Operation ID
  type: string,        // 'draw'
  userId: string,      // User who drew
  userName: string,
  userColor: string,
  timestamp: number,
  data: {
    points: [{x, y}],
    color: string,
    width: number,
    tool: string
  },
  undone: boolean
}
```

#### `user-joined`
```javascript
{
  userId: string,
  userName: string,
  color: string
}
```

#### `user-left`
```javascript
{
  userId: string,
  userName: string
}
```

#### `user-list`
```javascript
[
  {
    id: string,
    name: string,
    color: string,
    socketId: string,
    joinedAt: number
  }
]
```

#### `cursor-update`
```javascript
{
  userId: string,
  userName: string,
  userColor: string,
  x: number,
  y: number
}
```

#### `undo-update`
```javascript
{
  operationId: string  // ID of operation that was undone
}
```

#### `redo-update`
```javascript
{
  operationId: string  // ID of operation that was redone
}
```

#### `canvas-cleared`
No payload - signals canvas was cleared

## Undo/Redo Strategy

### Global Operation History

The application implements a **global undo/redo system** where any user can undo any operation:

1. **Operation Storage**: All drawing operations are stored in a linear history array on the server
2. **Current Index**: Server maintains a pointer to the current position in history
3. **Undo Mechanism**: 
   - Decrements current index
   - Marks operation as "undone"
   - Does NOT delete the operation
4. **Redo Mechanism**:
   - Increments current index
   - Marks operation as "not undone"
5. **New Operations**:
   - Truncate history after current index
   - Add new operation
   - Increment current index

### State Reconstruction

When a new user joins:
1. Server sends complete operation history
2. Client replays all non-undone operations
3. Canvas is reconstructed to current state

### Conflict Resolution

**Timestamp-based Ordering**:
- All operations have timestamps
- Server is the source of truth
- Operations are ordered by server receipt time
- No client-side operation reordering

**Simultaneous Drawing**:
- Multiple users can draw simultaneously
- Each operation is independent
- No conflicts - operations are additive
- Canvas renders operations in order received

**Undo Conflicts**:
- Any user can undo any operation
- Undo broadcasts to all clients
- All clients redraw canvas from history
- Ensures consistency across all users

## Canvas Drawing Implementation

### Smooth Path Rendering

```javascript
// Collect points during mouse move
currentPath.push({x, y});

// Draw using quadratic curves for smoothness
ctx.quadraticCurveTo(
  controlPoint.x, controlPoint.y,
  midPoint.x, midPoint.y
);
```

**Benefits**:
- Smooth curves instead of jagged lines
- Reduces visual artifacts
- Better user experience

### Efficient Redrawing

**Strategy**:
1. Maintain operation history
2. On undo/redo, clear canvas
3. Replay all non-undone operations
4. Use `requestAnimationFrame` for smooth rendering

**Optimization**:
- Only redraw when necessary (undo/redo/new user)
- Local drawing is immediate (no redraw)
- Remote drawings are added incrementally

### Layer Management

**Current Implementation**:
- Single canvas layer
- All operations drawn directly
- Clear and redraw for undo/redo

**Future Enhancement**:
- Separate overlay canvas for current stroke
- Base canvas for completed strokes
- Merge on stroke completion

## Performance Decisions

### Event Throttling

**Cursor Movement**: Throttled to 60fps (16ms)
```javascript
const BATCH_DELAY = 16; // ~60fps
if (now - lastEmitTime < BATCH_DELAY) return;
```

**Drawing Events**: Sent on stroke completion
- Collect all points during drawing
- Send complete stroke on mouse up
- Reduces network traffic

### Client-Side Prediction

**Immediate Local Rendering**:
- User sees their drawing instantly
- No waiting for server confirmation
- Server broadcast confirms to other users

**Benefits**:
- Zero perceived latency for drawer
- Smooth drawing experience
- Server still maintains truth

### Network Optimization

**Point Simplification** (Future):
- Douglas-Peucker algorithm
- Reduce point count while maintaining shape
- Smaller payload size

**Batching** (Current):
- Send complete strokes, not individual points
- Reduces WebSocket message count
- Better network efficiency

## State Synchronization

### New User Join Flow

```
1. User connects to server
2. Server assigns user ID and color
3. User joins room
4. Server sends operation history
5. Client reconstructs canvas
6. User sees current state
7. Server broadcasts user joined
8. All users see new user in list
```

### Consistency Guarantees

- **Server is source of truth**: All operations stored on server
- **Ordered delivery**: Socket.io guarantees message order
- **Atomic operations**: Each drawing is a complete operation
- **Idempotent rendering**: Replaying history always produces same result

## Scalability Considerations

### Current Limitations

- **In-memory storage**: State lost when server restarts
- **Single server**: No horizontal scaling
- **No persistence**: No database

### Future Improvements

1. **Redis for state**: Store operation history in Redis
2. **Database persistence**: Save canvas state to database
3. **Load balancing**: Use Socket.io Redis adapter
4. **Compression**: Compress operation data
5. **Pagination**: Limit history size, paginate old operations

## Security Considerations

### Current Implementation

- No authentication
- No authorization
- Anyone with room ID can join
- No rate limiting

### Recommended Enhancements

1. **Authentication**: User login system
2. **Room permissions**: Owner controls access
3. **Rate limiting**: Prevent spam/abuse
4. **Input validation**: Sanitize all client data
5. **HTTPS**: Secure WebSocket connections

## Technology Choices

### Why Socket.io?

- **Reliability**: Automatic reconnection
- **Fallbacks**: WebSocket with polling fallback
- **Room support**: Built-in room management
- **Ease of use**: Simple API

### Why Vanilla JavaScript?

- **No build step**: Faster development
- **Direct control**: Full control over canvas
- **Learning**: Demonstrates core concepts
- **Performance**: No framework overhead

### Why Canvas API?

- **Performance**: Hardware-accelerated
- **Flexibility**: Full drawing control
- **Compatibility**: Wide browser support
- **Efficiency**: Bitmap-based rendering

## Testing Strategy

### Manual Testing

1. **Multi-user**: Open multiple browser windows
2. **Drawing**: Test all tools and colors
3. **Undo/Redo**: Verify history management
4. **Network**: Test on slow connections
5. **Reconnection**: Test disconnect/reconnect

### Automated Testing (Future)

- Unit tests for state management
- Integration tests for WebSocket events
- E2E tests with Playwright/Puppeteer
- Performance tests for large canvases

## Conclusion

This architecture provides a solid foundation for real-time collaborative drawing with:

- **Real-time synchronization** via WebSocket
- **Global undo/redo** with operation history
- **Smooth drawing** with optimized rendering
- **Scalable design** with clear upgrade paths
- **Simple codebase** for easy understanding

The implementation prioritizes simplicity and clarity while maintaining good performance and user experience.
