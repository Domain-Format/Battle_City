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
        let availableSeats = [];
        for(let i = 1; i <= roomConfig.maxPlayers; i++) availableSeats.push(i);
        const hostSeat = availableSeats.shift();

        // Bind the player to their unique browser ID instead of a temporary connection ID
        const playerId = roomConfig.playerId || socket.id;

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
            sockets: { [socket.id]: playerId },
            players: { 
                [playerId]: { 
                    socketId: socket.id,
                    seat: hostSeat, 
                    name: roomConfig.hostName || "Host", 
                    isFlipped: false,
                    lp: 8000,
                    dmCount: 0,
                    dmCard: null,
                    isEliminated: false,
                    isConnected: true
                } 
            },
            availableSeats: availableSeats
        };

        socket.join(roomId);
        socket.emit('room-created', roomId);
        socket.emit('room-joined', activeRooms[roomId], hostSeat);
        io.emit('lobby-update', getPublicRooms());
    });

    // 2. Joining a Room
    socket.on('join-room', (roomId, isSpectator, guestName, guestPlayerId) => {
        const room = activeRooms[roomId];
        if (!room) return socket.emit('error', 'Room not found');

        if (isSpectator) {
            room.spectators++;
            socket.join(roomId);
            socket.to(roomId).emit('spectator-joined', socket.id);
            socket.emit('room-joined', room, null);
            return;
        }

        const playerId = guestPlayerId || socket.id;

        // RECONNECTION LOGIC: If they are already in the room, give them their seat back!
        if (room.players[playerId]) {
            const p = room.players[playerId];
            const oldSocketId = p.socketId;

            // Map the new connection to the old player profile
            if (oldSocketId && room.sockets[oldSocketId]) {
                delete room.sockets[oldSocketId];
            }
            room.sockets[socket.id] = playerId;
            p.socketId = socket.id;
            p.isConnected = true;

            room.peers = room.peers.filter(id => id !== oldSocketId);
            room.peers.push(socket.id);

            socket.join(roomId);
            socket.emit('room-joined', room, p.seat);
            socket.to(roomId).emit('player-reconnected', { newSocketId: socket.id, seat: p.seat, name: p.name });
            return;
        }

        if (room.currentPlayers >= room.maxPlayers) return socket.emit('error', 'Room is full');
        
        const guestSeat = room.availableSeats.shift();
        room.currentPlayers++;
        room.peers.push(socket.id);
        room.sockets[socket.id] = playerId;

        room.players[playerId] = { 
            socketId: socket.id,
            seat: guestSeat, 
            name: guestName || "Player", 
            isFlipped: false,
            lp: 8000,
            dmCount: 0,
            dmCard: null,
            isEliminated: false,
            isConnected: true
        };
        
        socket.join(roomId);
        socket.to(roomId).emit('player-joined', { newPlayerId: socket.id, seat: guestSeat, name: guestName });
        socket.emit('room-joined', room, guestSeat);
        
        io.emit('lobby-update', getPublicRooms());
    });

    // --- GAME STATE SYNCHRONIZATION ---
    socket.on('update-lp', (roomId, data) => {
        const room = activeRooms[roomId];
        if (room) {
            const p = Object.values(room.players).find(p => p.seat === data.seat);
            if (p) p.lp = data.lp;
            socket.to(roomId).emit('update-lp', data);
        }
    });

    socket.on('update-dm-count', (roomId, data) => {
        const room = activeRooms[roomId];
        if (room) {
            const p = Object.values(room.players).find(p => p.seat === data.seat);
            if (p) p.dmCount = data.dmCount;
            socket.to(roomId).emit('update-dm-count', data);
        }
    });

    socket.on('set-dm-card', (roomId, data) => {
        const room = activeRooms[roomId];
        if (room) {
            const p = Object.values(room.players).find(p => p.seat === data.seat);
            if (p) p.dmCard = data.card;
            socket.to(roomId).emit('set-dm-card', data);
        }
    });

    socket.on('eliminate-player', (roomId, data) => {
        const room = activeRooms[roomId];
        if (room) {
            const p = Object.values(room.players).find(p => p.seat === data.seat);
            if (p) { p.isEliminated = true; p.lp = 0; }
            socket.to(roomId).emit('eliminate-player', data);
        }
    });

    socket.on('dice-roll', (roomId, data) => socket.to(roomId).emit('dice-roll', data));
    socket.on('coin-flip', (roomId, data) => socket.to(roomId).emit('coin-flip', data));
    socket.on('send-chat', (roomId, data) => socket.to(roomId).emit('receive-chat', data));
    
    socket.on('sync-layout', (roomId, layoutPositions) => socket.to(roomId).emit('sync-layout', layoutPositions));
    
    socket.on('flip-camera', (roomId, isFlippedState) => {
        const room = activeRooms[roomId];
        if (room) {
            const playerId = room.sockets[socket.id];
            if (playerId && room.players[playerId]) {
                room.players[playerId].isFlipped = isFlippedState;
                socket.to(roomId).emit('camera-flipped', { seat: room.players[playerId].seat, isFlipped: isFlippedState });
            }
        }
    });

    // 3. Handle Leaving
    socket.on('leave-room', (roomId) => handleDisconnect(socket, roomId, true));

    socket.on('disconnect', () => {
        for (const roomId in activeRooms) {
            if (activeRooms[roomId].peers.includes(socket.id) || activeRooms[roomId].spectators > 0) {
                handleDisconnect(socket, roomId, false);
            }
        }
    });

    function handleDisconnect(socket, roomId, isExplicit) {
        const room = activeRooms[roomId];
        if (!room) return;

        if (room.peers.includes(socket.id)) {
            const playerId = room.sockets[socket.id];
            const playerData = room.players[playerId];

            if (isExplicit) {
                if (playerData) {
                    room.availableSeats.push(playerData.seat);
                    room.availableSeats.sort((a, b) => a - b);
                    socket.to(roomId).emit('player-left', { socketId: socket.id, seat: playerData.seat });
                }
                if (playerId) delete room.players[playerId];
                delete room.sockets[socket.id];
                room.peers = room.peers.filter(id => id !== socket.id);
                room.currentPlayers--;
                socket.leave(roomId);

                if (room.currentPlayers <= 0) delete activeRooms[roomId];
            } else {
                if (playerData) {
                    playerData.isConnected = false;
                    socket.to(roomId).emit('player-dropped', { socketId: socket.id, seat: playerData.seat });
                }
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
