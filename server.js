const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const activeRooms = {}; 

io.on('connection', (socket) => {
    socket.emit('lobby-update', getPublicRooms());

    socket.on('request-lobby-update', () => {
        socket.emit('lobby-update', getPublicRooms());
    });

    // 1. Hosting a Room
    socket.on('create-room', (roomConfig) => {
        const roomId = `room_${Math.random().toString(36).substr(2, 9)}`;
        
        // Build an array of available seats based on room size [1, 2, 3, 4]
        let availableSeats = [];
        for(let i = 1; i <= roomConfig.maxPlayers; i++) availableSeats.push(i);

        // Host takes Seat 1
        const hostSeat = availableSeats.shift();

        activeRooms[roomId] = {
            id: roomId,
            hostId: socket.id,
            hostName: roomConfig.hostName || "Host",
            roomName: roomConfig.roomName || "Arena",
            format: roomConfig.format,
            maxPlayers: roomConfig.maxPlayers,
            currentPlayers: 1,
            spectators: 0,
            isPrivate: roomConfig.isPrivate,
            allowSpectators: roomConfig.allowSpectators,
            peers: [socket.id],
            // Track exact seat assignments
            players: { [socket.id]: { seat: hostSeat, name: roomConfig.hostName || "Host" } },
            availableSeats: availableSeats
        };

        socket.join(roomId);
        socket.emit('room-created', roomId);
        
        // Tell the host they joined successfully and give them their assigned seat
        socket.emit('room-joined', activeRooms[roomId], hostSeat);
        io.emit('lobby-update', getPublicRooms());
    });

    // 2. Joining a Room
    socket.on('join-room', (roomId, isSpectator, guestName) => {
        const room = activeRooms[roomId];
        if (!room) return socket.emit('error', 'Room not found');

        if (isSpectator) {
            room.spectators++;
            socket.join(roomId);
            socket.to(roomId).emit('spectator-joined', socket.id);
            socket.emit('room-joined', room, null);
        } else {
            if (room.currentPlayers >= room.maxPlayers) {
                return socket.emit('error', 'Room is full');
            }
            
            // Grab the lowest available seat for the new player
            const guestSeat = room.availableSeats.shift();
            
            room.currentPlayers++;
            room.peers.push(socket.id);
            room.players[socket.id] = { seat: guestSeat, name: guestName || "Player" };
            
            socket.join(roomId);
            
            // Tell others a new player joined and WHICH SEAT they are in
            socket.to(roomId).emit('player-joined', { newPlayerId: socket.id, seat: guestSeat, name: guestName });
            // Tell the new player they joined and what seat they got
            socket.emit('room-joined', room, guestSeat);
        }
        io.emit('lobby-update', getPublicRooms());
    });

    // Synchronize Layout Grid
    socket.on('sync-layout', (roomId, layoutPositions) => {
        socket.to(roomId).emit('sync-layout', layoutPositions);
    });

    // 3. Handle Leaving
    socket.on('leave-room', (roomId) => handleDisconnect(socket, roomId));

    socket.on('disconnect', () => {
        for (const roomId in activeRooms) {
            if (activeRooms[roomId].peers.includes(socket.id) || activeRooms[roomId].spectators > 0) {
                handleDisconnect(socket, roomId);
            }
        }
    });

    function handleDisconnect(socket, roomId) {
        const room = activeRooms[roomId];
        if (!room) return;

        if (room.peers.includes(socket.id)) {
            const playerData = room.players[socket.id];
            if (playerData) {
                // Return their seat to the pool and re-sort it so the lowest seat is taken next
                room.availableSeats.push(playerData.seat);
                room.availableSeats.sort((a, b) => a - b);
                
                delete room.players[socket.id];
                socket.to(roomId).emit('player-left', { socketId: socket.id, seat: playerData.seat });
            }
            
            room.peers = room.peers.filter(id => id !== socket.id);
            room.currentPlayers--;
            socket.leave(roomId);

            if (room.currentPlayers <= 0) {
                delete activeRooms[roomId];
            }
        } else if (room.spectators > 0) {
            room.spectators--;
            socket.leave(roomId);
        }
        io.emit('lobby-update', getPublicRooms());
    }

    // 4. WebRTC Signaling
    socket.on('webrtc-offer', (data) => socket.to(data.targetId).emit('webrtc-offer', { senderId: socket.id, sdp: data.sdp }));
    socket.on('webrtc-answer', (data) => socket.to(data.targetId).emit('webrtc-answer', { senderId: socket.id, sdp: data.sdp }));
    socket.on('webrtc-ice-candidate', (data) => socket.to(data.targetId).emit('webrtc-ice-candidate', { senderId: socket.id, candidate: data.candidate }));
});

function getPublicRooms() {
    return Object.values(activeRooms).filter(r => !r.isPrivate);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Battle City Matchmaker Server running on port ${PORT}`));
