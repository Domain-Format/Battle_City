const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// Initialize Express App
const app = express();
app.use(cors()); // Allow your GitHub Pages frontend to talk to this server
app.use(express.json());

const server = http.createServer(app);

// Initialize Socket.io for Real-Time connections
const io = new Server(server, {
    cors: {
        origin: "*", // Replace with your GitHub Pages URL in production!
        methods: ["GET", "POST"]
    }
});

// In-memory database to track active duels
const activeRooms = {}; 

// Example of the structure:
// activeRooms['room_123'] = {
//     host: 'SetoKaiba',
//     format: 'Domain',
//     maxPlayers: 4,
//     currentPlayers: 1,
//     spectators: 0,
//     isPrivate: false
// }

io.on('connection', (socket) => {
    console.log(`New user connected to Lobby server: ${socket.id}`);

    // Immediately send them the list of public rooms for their Launch Screen
    socket.emit('lobby-update', getPublicRooms());

    // 1. Hosting a Room
    socket.on('create-room', (roomConfig) => {
        const roomId = `room_${Math.random().toString(36).substr(2, 9)}`;
        
        activeRooms[roomId] = {
            id: roomId,
            hostId: socket.id,
            hostName: roomConfig.hostName,
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
        
        // Broadcast the new room to everyone else's Launch Screen Lobby
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
        } else {
            if (room.currentPlayers >= room.maxPlayers) {
                return socket.emit('error', 'Room is full');
            }
            room.currentPlayers++;
            room.peers.push(socket.id);
            socket.join(roomId);
            
            // Tell the existing players to prepare their WebRTC connections
            socket.to(roomId).emit('player-joined', { newPlayerId: socket.id });
        }

        io.emit('lobby-update', getPublicRooms()); // Update lobby counts
    });

    // 3. WebRTC Signaling (The crucial part that links cameras)
    // When Player A generates a video feed, they send an 'offer' through the server to Player B
    socket.on('webrtc-offer', (data) => {
        socket.to(data.targetId).emit('webrtc-offer', {
            senderId: socket.id,
            sdp: data.sdp
        });
    });

    // Player B replies with an 'answer'
    socket.on('webrtc-answer', (data) => {
        socket.to(data.targetId).emit('webrtc-answer', {
            senderId: socket.id,
            sdp: data.sdp
        });
    });

    // Passing ICE Candidates to bypass firewalls
    socket.on('webrtc-ice-candidate', (data) => {
        socket.to(data.targetId).emit('webrtc-ice-candidate', {
            senderId: socket.id,
            candidate: data.candidate
        });
    });

    // 4. Handle Disconnects
    socket.on('disconnect', () => {
        // Cleanup logic to remove them from rooms and update the Lobby
        for (const roomId in activeRooms) {
            const room = activeRooms[roomId];
            if (room.peers.includes(socket.id)) {
                room.peers = room.peers.filter(id => id !== socket.id);
                room.currentPlayers--;
                socket.to(roomId).emit('player-left', socket.id);
                
                // Close room if empty
                if (room.currentPlayers === 0) {
                    delete activeRooms[roomId];
                }
            }
        }
        io.emit('lobby-update', getPublicRooms());
    });
});

function getPublicRooms() {
    // Return only rooms that are NOT private
    return Object.values(activeRooms).filter(r => !r.isPrivate);
}

// When you get your real Client ID and Secret from the simorg.ca developers, plug them in here!
const YUGIPASS_CLIENT_ID = process.env.YUGIPASS_CLIENT_ID || 'YOUR_CLIENT_ID';
const YUGIPASS_SECRET = process.env.YUGIPASS_SECRET || 'YOUR_SECRET';

app.get('/auth/yugipass', (req, res) => {
    // 1. Redirect the user to the real YugiPass login screen
    const redirectUri = encodeURIComponent('https://your-backend-url.onrender.com/auth/yugipass/callback');
    const authUrl = `https://simorg.ca/oauth/authorize?client_id=${YUGIPASS_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code`;
    res.redirect(authUrl);
});

app.get('/auth/yugipass/callback', async (req, res) => {
    // 2. YugiPass redirects back here with a secure 'code'. We trade it for an access token.
    const code = req.query.code;
    
    // NOTE: This is a pseudo-code implementation of an OAuth token exchange. 
    // You will need the exact endpoint URL from the simorg.ca documentation.
    /*
    try {
        const tokenResponse = await axios.post('https://simorg.ca/oauth/token', {
            client_id: YUGIPASS_CLIENT_ID,
            client_secret: YUGIPASS_SECRET,
            code: code,
            grant_type: 'authorization_code'
        });
        
        const userData = await axios.get('https://simorg.ca/api/user', {
            headers: { Authorization: `Bearer ${tokenResponse.data.access_token}` }
        });

        // Redirect back to your GitHub Pages frontend with the validated username
        res.redirect(`https://yourusername.github.io/battle-city-duel/?user=${userData.data.username}&avatar=${userData.data.avatar}`);
    } catch (err) {
        res.redirect(`https://yourusername.github.io/battle-city-duel/?error=auth_failed`);
    }
    */
   res.send("OAuth Callback endpoint ready for implementation!");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Battle City Matchmaker Server running on port ${PORT}`);
});