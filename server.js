const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// Initialize Express App
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

// Initialize Socket.io for Real-Time connections
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// In-memory database to track active duels
const activeRooms = {}; 

io.on('connection', (socket) => {
    console.log(`New user connected to Lobby server: ${socket.id}`);

    // Immediately send them the list of public rooms for their Launch Screen
    socket.emit('lobby-update', getPublicRooms());

    // FIX: Listen for manual refresh requests from the client!
    socket.on('request-lobby-update', () => {
        socket.emit('lobby-update', getPublicRooms());
    });

    // 1. Hosting a Room
    socket.on('create-room', (roomConfig) => {
        const roomId = `room_${Math.random().toString(36).substr(2, 9)}`;
        
        activeRooms[roomId] = {
            id: roomId,
            hostId: socket.id,
            roomName: roomConfig.roomName || "Arena",
            format: roomConfig.format,
            maxPlayers: roomConfig.maxPlayers,
            currentPlayers: 1,
            spectators: 0,
            isPrivate: roomConfig.isPrivate,
            allowSpectators: roomConfig.allowSpectators,
            peers: [socket.id] // Tracking WebRTC endpoints
        };

        socket.join(roomId);
        socket.emit('room-created', roomId);
        io.emit('lobby-update', getPublicRooms());
    });

    // 2. Joining a Room
    socket.on('join-room', (roomId, isSpectator = false) => {
        const room = activeRooms[roomId];
        if (!room) return socket.emit('error', 'Room not found');

        if (isSpectator) {
            room.spectators++;
            socket.join(roomId);
            socket.to(roomId).emit('spectator-joined', socket.id);
            socket.emit('room-joined', room);
        } else {
            if (room.currentPlayers >= room.maxPlayers) {
                return socket.emit('error', 'Room is full');
            }
            room.currentPlayers++;
            room.peers.push(socket.id);
            socket.join(roomId);
            
            socket.to(roomId).emit('player-joined', { newPlayerId: socket.id });
            socket.emit('room-joined', room);
        }

        io.emit('lobby-update', getPublicRooms());
    });

    // 3. Handle Manual "Leave Room" Button Clicks
    socket.on('leave-room', (roomId) => {
        const room = activeRooms[roomId];
        if (room) {
            if (room.peers.includes(socket.id)) {
                // Remove player
                room.peers = room.peers.filter(id => id !== socket.id);
                room.currentPlayers--;
                socket.to(roomId).emit('player-left', socket.id);
            } else if (room.spectators > 0) {
                // Remove spectator
                room.spectators--;
            }
            
            socket.leave(roomId);
            
            // Close room if empty
            if (room.currentPlayers <= 0) {
                delete activeRooms[roomId];
            }
            io.emit('lobby-update', getPublicRooms());
        }
    });

    // 4. WebRTC Signaling
    socket.on('webrtc-offer', (data) => {
        socket.to(data.targetId).emit('webrtc-offer', { senderId: socket.id, sdp: data.sdp });
    });

    socket.on('webrtc-answer', (data) => {
        socket.to(data.targetId).emit('webrtc-answer', { senderId: socket.id, sdp: data.sdp });
    });

    socket.on('webrtc-ice-candidate', (data) => {
        socket.to(data.targetId).emit('webrtc-ice-candidate', { senderId: socket.id, candidate: data.candidate });
    });

    // 5. Handle Disconnects (Closed tab, refreshed page, etc)
    socket.on('disconnect', () => {
        for (const roomId in activeRooms) {
            const room = activeRooms[roomId];
            if (room.peers.includes(socket.id)) {
                room.peers = room.peers.filter(id => id !== socket.id);
                room.currentPlayers--;
                socket.to(roomId).emit('player-left', socket.id);
                
                if (room.currentPlayers <= 0) {
                    delete activeRooms[roomId];
                }
            }
        }
        io.emit('lobby-update', getPublicRooms());
    });
});

function getPublicRooms() {
    return Object.values(activeRooms).filter(r => !r.isPrivate);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Battle City Matchmaker Server running on port ${PORT}`);
});
