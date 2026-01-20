# Collaborative Drawing Canvas

A real-time multi-user drawing application where multiple people can draw simultaneously on the same canvas with instant synchronization.

## Features

- **Real-time Drawing**: See other users' drawings as they draw, not after completion
- **Drawing Tools**: Brush and eraser with customizable colors and stroke widths
- **Global Undo/Redo**: Any user can undo/redo any operation across the entire canvas
- **User Presence**: See who's online with color-coded indicators
- **Cursor Tracking**: View where other users are drawing in real-time
- **Room-based**: Multiple isolated drawing sessions via unique room IDs
- **Smooth Drawing**: Optimized path rendering using quadratic curves
- **Responsive Design**: Works on desktop and mobile devices

## Setup Instructions

### Prerequisites

- Node.js (v14 or higher)
- npm (comes with Node.js)

### Installation

1. **Navigate to the project directory**:
   ```bash
   cd collaborative-canvas
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the server**:
   ```bash
   npm start
   ```

4. **Open in browser**:
   - Navigate to `http://localhost:3000`
   - The application will automatically create a room or you can join an existing one

## Testing with Multiple Users

### Option 1: Multiple Browser Windows
1. Open the application in your browser
2. Copy the room URL from the "Share" section
3. Open the URL in another browser window or tab
4. Start drawing in both windows to see real-time synchronization

### Option 2: Multiple Devices
1. Start the server on your computer
2. Find your local IP address (e.g., `192.168.1.100`)
3. On another device on the same network, navigate to `http://YOUR_IP:3000`
4. Both devices will share the same canvas

### Option 3: Incognito/Private Windows
1. Open the application in a normal browser window
2. Copy the room URL
3. Open an incognito/private window and paste the URL
4. Draw in both windows to test synchronization

## How to Use

1. **Enter Your Name**: When you first join, enter your name
2. **Select Tool**: Choose between brush and eraser
3. **Pick Color**: Use the color picker or preset colors
4. **Adjust Width**: Use the slider to change stroke width
5. **Draw**: Click and drag on the canvas to draw
6. **Undo/Redo**: Use the undo/redo buttons to modify history
7. **Share**: Copy the room link to invite others
8. **Clear**: Clear the entire canvas (affects all users)

## Known Limitations

- **Cursor Indicators**: Remote cursor positions are tracked but not visually rendered to avoid interfering with drawing operations
- **Canvas Size**: Canvas is fixed to the container size; resizing may cause slight distortion
- **Network Latency**: Drawing may appear slightly delayed on slow connections
- **No Persistence**: Canvas state is lost when all users disconnect (no database storage)
- **Limited Tools**: Currently only supports brush and eraser (no shapes, text, etc.)
- **No Authentication**: Anyone with the room link can join and draw

## Known Bugs

- **Resize Issue**: Resizing the browser window may cause canvas content to shift slightly
- **Mobile Touch**: Touch events work but may not be as smooth as mouse input
- **Undo Limit**: No limit on undo history, which could cause memory issues in very long sessions

## Time Spent

- **Planning & Architecture**: 30 minutes
- **Server Implementation**: 45 minutes
- **Client Canvas Logic**: 1 hour
- **WebSocket Integration**: 30 minutes
- **UI/UX Design**: 45 minutes
- **Testing & Debugging**: 30 minutes
- **Documentation**: 30 minutes
- **Total**: ~4.5 hours

## Project Structure

```
collaborative-canvas/
├── client/
│   ├── index.html          # Main HTML structure
│   ├── style.css           # Styling and layout
│   ├── canvas.js           # Canvas drawing logic
│   ├── websocket.js        # WebSocket client
│   └── main.js             # App initialization
├── server/
│   ├── server.js           # Express + WebSocket server
│   ├── rooms.js            # Room management
│   └── drawing-state.js    # Canvas state management
├── package.json
├── README.md
└── ARCHITECTURE.md
```

## Technologies Used

- **Frontend**: Vanilla JavaScript, HTML5 Canvas
- **Backend**: Node.js, Express
- **Real-time**: Socket.io
- **Styling**: CSS3 with modern features

## License

MIT
