let totalPlayers = 4;
let lp = { 1: 8000, 2: 8000, 3: 8000, 4: 8000, 5: 8000, 6: 8000 };
const logEl = document.getElementById('duel-log');

let localStream = null;
let isMicOn = true;
let isCamOn = true;
let isFlipped = { 1: false, 2: false, 3: false, 4: false, 5: false, 6: false }; 

let activeCalcPlayer = null;
let dmCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
let dragState = { active: false, el: null, container: null, playerNum: null, startX: 0, startY: 0, initialLeft: 0, initialTop: 0, moved: false };

let myPlayerId;
try {
    myPlayerId = localStorage.getItem('ygo_player_id');
    if (!myPlayerId) {
        myPlayerId = 'p_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('ygo_player_id', myPlayerId);
    }
} catch(e) {
    myPlayerId = 'p_' + Math.random().toString(36).substr(2, 9);
}

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};
let peerConnections = {}; 
let peerGridMap = {};     
let iceCandidateQueues = {}; 

let socket = null;
let currentRoomId = null;
const SERVER_URL = 'https://battle-city-7f80.onrender.com';

window.addEventListener('DOMContentLoaded', () => {
    
    // --- The flawless invite link logic ---
    const urlParams = new URLSearchParams(window.location.search);
    const inviteRoom = urlParams.get('room');

    if (inviteRoom) {
        const header = document.getElementById('right-panel-header');
        if (header) {
            header.innerHTML = `
                <svg class="w-10 h-10 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"></path></svg>
                JOIN INVITE
            `;
            header.classList.replace('text-cyan-400', 'text-emerald-400');
        }
        
        const hostOptions = document.getElementById('host-options');
        if (hostOptions) hostOptions.classList.add('hidden');

        const lobbyFilters = document.getElementById('lobby-filters');
        if (lobbyFilters) lobbyFilters.classList.add('hidden');

        const roomNameContainer = document.getElementById('room-name-container');
        if (roomNameContainer) roomNameContainer.classList.add('hidden');
        
        const nameConfigGrid = document.getElementById('name-config-grid');
        if (nameConfigGrid) {
            nameConfigGrid.classList.remove('md:grid-cols-2');
            nameConfigGrid.classList.add('grid-cols-1');
        }

        const leftHeader = document.querySelector('.md\\:w-7\\/12 h2');
        if (leftHeader) {
            leftHeader.innerHTML = `
                <svg class="w-6 h-6 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 19v-8.93a2 2 0 01.89-1.664l7-4.666a2 2 0 012.22 0l7 4.666A2 2 0 0121 10.07V19M3 19a2 2 0 002 2h14a2 2 0 002-2M3 19l6.75-4.5M21 19l-6.75-4.5M3 10l6.75 4.5M21 10l-6.75 4.5m0 0l-1.14.76a2 2 0 01-2.22 0l-1.14-.76"></path></svg>
                ROOM INVITATION
            `;
            leftHeader.classList.replace('text-cyan-400', 'text-emerald-400');
        }
        
        const launchBtn = document.getElementById('launch-btn');
        if (launchBtn) {
            launchBtn.textContent = 'JOIN DUEL';
            launchBtn.classList.replace('bg-cyan-700', 'bg-emerald-700');
            launchBtn.classList.replace('hover:bg-cyan-600', 'hover:bg-emerald-600');
            launchBtn.classList.replace('border-cyan-400', 'border-emerald-400');
            launchBtn.classList.replace('text-cyan-50', 'text-emerald-50');
            launchBtn.style.boxShadow = '0 0 20px rgba(16,185,129,0.4)';
            launchBtn.onclick = function() { joinServerRoom(inviteRoom, false, this); };
        }
    }

    openCalc(1);

    for (let i = 2; i <= 6; i++) {
        const camBtn = document.getElementById(`cam-btn-${i}`);
        if (camBtn) camBtn.classList.add('invisible');
        
        const lpWrapper = document.getElementById(`p${i}-lp-wrapper`);
        if (lpWrapper) {
            const innerBox = lpWrapper.firstElementChild;
            if (innerBox) {
                innerBox.classList.remove('cursor-grab', 'active:cursor-grabbing');
                innerBox.classList.add('cursor-default');
            }
        }
        
        const dmContainer = document.getElementById(`p${i}-dm-container`);
        if (dmContainer) {
            dmContainer.classList.remove('cursor-pointer', 'hover:scale-105');
            dmContainer.title = "Locked: Not your Deck Master";
        }
    }

    try {
        socket = io(SERVER_URL);
        
        socket.on('connect', () => {
            addLog('System', 'Connected to Global Matchmaking Server!', 'text-emerald-400 font-bold');
            const lobbyHeader = document.querySelector('h2.text-cyan-400');
            if (lobbyHeader && !lobbyHeader.innerHTML.includes('ONLINE')) {
                lobbyHeader.innerHTML += ' <span class="text-[10px] text-emerald-400 font-mono tracking-normal ml-3 px-1.5 py-0.5 border border-emerald-500/50 rounded bg-emerald-900/30">ONLINE</span>';
            }
        });

        socket.on('lobby-update', updateLobbyUI);

        socket.on('room-created', (roomId) => {
            currentRoomId = roomId;
            addLog('System', `Room registered on server! ID: <span class="text-cyan-300 font-mono">${roomId}</span>`, 'text-emerald-400 font-bold');
        });

        socket.on('room-joined', async (room, mySeat) => {
            currentRoomId = room.id;
            totalPlayers = room.maxPlayers;
            peerGridMap = {}; 

            window.history.pushState({}, '', '?room=' + room.id);
            const copyLinkBtn = document.getElementById('copy-link-btn');
            if (copyLinkBtn) copyLinkBtn.classList.remove('hidden');

            const setupModal = document.getElementById('setup-modal');
            if (setupModal) {
                setupModal.classList.add('hidden');
                setupModal.classList.remove('flex');
            }
            
            const grid = document.getElementById('video-grid');
            if (grid) {
                grid.className = 'flex-1 grid gap-0 min-h-0 h-full p-0 bg-black z-0';
                if (totalPlayers === 2) {
                    grid.classList.add('grid-cols-1', 'grid-rows-2', 'lg:grid-cols-2', 'lg:grid-rows-1');
                    playerGridPositions = [1, 2];
                } else if (totalPlayers <= 4) {
                    grid.classList.add('grid-cols-2', 'grid-rows-2');
                    playerGridPositions = totalPlayers === 3 ? [1, 2, 3] : [1, 2, 3, 4];
                } else {
                    grid.classList.add('grid-cols-3', 'grid-rows-2');
                    playerGridPositions = totalPlayers === 5 ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6];
                }
            }

            for(let i = 1; i <= 6; i++) {
                const item = document.getElementById(`grid-item-${i}`);
                if(item) {
                    if(i <= totalPlayers) {
                        item.classList.remove('hidden');
                        item.classList.add('flex');
                        
                        const pData = Object.values(room.players).find(p => p.seat === i);
                        
                        if (pData) {
                            if (pData.socketId !== socket.id) peerGridMap[pData.socketId] = pData.seat;
                            
                            const nameEl = document.getElementById(`p${i}-name`);
                            if (nameEl) nameEl.textContent = pData.name;
                            
                            const placeholder = document.getElementById(`p${i}-placeholder`);
                            if (placeholder) {
                                const span = placeholder.querySelector('span');
                                if (span) span.textContent = pData.isConnected ? 'Connecting...' : 'Disconnected';
                            }
                            
                            isFlipped[i] = pData.isFlipped || false;
                            lp[i] = pData.lp !== undefined ? pData.lp : 8000;
                            updateLPDisplay(i);
                            
                            dmCounts[i] = pData.dmCount || 0;
                            const counterEl = document.getElementById(`p${i}-dm-counter`);
                            if (counterEl) counterEl.textContent = dmCounts[i];
                            
                            if (pData.dmCard) {
                                const imgEl = document.getElementById(`p${i}-dm-img`);
                                const containerEl = document.getElementById(`p${i}-dm-container`);
                                if (imgEl && containerEl) {
                                    imgEl.src = `https://images.ygoprodeck.com/images/cards_cropped/${pData.dmCard.id}.jpg`;
                                    containerEl.classList.remove('hidden');
                                }
                            }
                            if (pData.isEliminated) eliminatePlayerId(i);
                        } else {
                            const nameEl = document.getElementById(`p${i}-name`);
                            if (nameEl) nameEl.textContent = `P${i}`;
                            
                            const placeholder = document.getElementById(`p${i}-placeholder`);
                            if (placeholder) {
                                const span = placeholder.querySelector('span');
                                if (span) span.textContent = `Awaiting P${i}...`;
                            }
                            
                            lp[i] = 8000;
                            updateLPDisplay(i);
                        }
                    } else {
                        item.classList.add('hidden');
                        item.classList.remove('flex');
                    }
                }
            }

            if (mySeat === 1 || mySeat) {
                const btn1 = document.getElementById(`cam-btn-1`);
                if(btn1) btn1.classList.remove('hidden');
                activeCalcPlayer = 1;
                await initWebcam();
            }

            randomizeSeats(false); 
            addLog('System', `Joined room: ${room.roomName} as P${mySeat || 'Spectator'}`, 'text-emerald-400 font-bold');
        });

        socket.on('player-joined', async (data) => {
            peerGridMap[data.newPlayerId] = data.seat;
            const nameEl = document.getElementById(`p${data.seat}-name`);
            if (nameEl) nameEl.textContent = data.name;
            
            const placeholder = document.getElementById(`p${data.seat}-placeholder`);
            if (placeholder) {
                const span = placeholder.querySelector('span');
                if (span) span.textContent = 'Connecting...';
            }

            addLog('System', `<span class="text-cyan-300">${data.name}</span> joined the room as P${data.seat}!`, 'text-cyan-400 font-bold');
            
            const pc = createPeerConnection(data.newPlayerId);
            try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                socket.emit('webrtc-offer', { targetId: data.newPlayerId, sdp: pc.localDescription });
            } catch (err) {
                console.error("Error creating WebRTC offer:", err);
            }
        });

        socket.on('player-reconnected', async (data) => {
            peerGridMap[data.newSocketId] = data.seat;
            const placeholder = document.getElementById(`p${data.seat}-placeholder`);
            if (placeholder) {
                const span = placeholder.querySelector('span');
                if (span) span.textContent = 'Reconnecting...';
            }
            addLog('System', `P${data.seat} reconnected to the room!`, 'text-emerald-400 font-bold');
            
            const pc = createPeerConnection(data.newSocketId);
            try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                socket.emit('webrtc-offer', { targetId: data.newSocketId, sdp: pc.localDescription });
            } catch (err) {}
        });

        socket.on('webrtc-offer', async (data) => {
            const { senderId, sdp } = data;
            const pc = createPeerConnection(senderId);
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(sdp));
                
                if (iceCandidateQueues[senderId]) {
                    for (let candidate of iceCandidateQueues[senderId]) {
                        pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error(e));
                    }
                    delete iceCandidateQueues[senderId];
                }

                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                socket.emit('webrtc-answer', { targetId: senderId, sdp: pc.localDescription });
            } catch (err) {}
        });

        socket.on('webrtc-answer', async (data) => {
            const pc = peerConnections[data.senderId];
            if (pc) {
                try {
                    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
                    if (iceCandidateQueues[data.senderId]) {
                        for (let candidate of iceCandidateQueues[data.senderId]) {
                            pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error(e));
                        }
                        delete iceCandidateQueues[data.senderId];
                    }
                } catch (err) {}
            }
        });

        socket.on('webrtc-ice-candidate', async (data) => {
            const pc = peerConnections[data.senderId];
            if (pc && pc.remoteDescription) {
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
                } catch (err) {}
            } else {
                if (!iceCandidateQueues[data.senderId]) iceCandidateQueues[data.senderId] = [];
                iceCandidateQueues[data.senderId].push(data.candidate);
            }
        });

        socket.on('player-dropped', (data) => {
            if (peerConnections[data.socketId]) {
                peerConnections[data.socketId].close();
                delete peerConnections[data.socketId];
            }
            freeGridSlot(data.socketId, data.seat);
        });

        socket.on('player-left', (data) => {
            if (peerConnections[data.socketId]) {
                peerConnections[data.socketId].close();
                delete peerConnections[data.socketId];
            }
            freeGridSlot(data.socketId, data.seat);
        });

        socket.on('error', (msg) => {
            console.error(`Server Error: ${msg}`);
            addLog('System', `Server Error: ${msg}`, 'text-red-500 font-bold');
            
            const launchBtn = document.getElementById('launch-btn');
            if (launchBtn) {
                launchBtn.disabled = false;
                if (launchBtn.innerText.includes('Connecting')) {
                    launchBtn.innerText = 'Join Failed';
                }
            }

            if(msg.includes('not found') || msg.includes('full')) {
                window.history.pushState({}, '', window.location.pathname);
            }
        });

        socket.on('sync-layout', (layoutPositions) => { playerGridPositions = layoutPositions; randomizeSeats(false); });
        socket.on('update-lp', (data) => { lp[data.seat] = data.lp; updateLPDisplay(data.seat); });
        socket.on('update-dm-count', (data) => {
            dmCounts[data.seat] = data.dmCount;
            const counterEl = document.getElementById(`p${data.seat}-dm-counter`);
            if (counterEl) {
                counterEl.textContent = data.dmCount;
                counterEl.classList.add('scale-125', 'bg-amber-300');
                setTimeout(() => counterEl.classList.remove('scale-125', 'bg-amber-300'), 150);
            }
        });
        socket.on('set-dm-card', (data) => {
            const imgEl = document.getElementById(`p${data.seat}-dm-img`);
            const containerEl = document.getElementById(`p${data.seat}-dm-container`);
            if (imgEl && containerEl) {
                imgEl.src = `https://images.ygoprodeck.com/images/cards_cropped/${data.card.id}.jpg`;
                containerEl.classList.remove('hidden');
                addLog(`P${data.seat}`, `set a Deck Master!`, 'text-amber-200');
            }
        });
        socket.on('eliminate-player', (data) => { eliminatePlayerId(data.seat); });
        socket.on('dice-roll', (data) => { showEffect(data.seat, 'dice', data.result); addLog(`P${data.seat}`, `rolled a 6-sided die: <span class="font-bold text-indigo-400 text-lg ml-1">${data.result}</span>`, 'text-indigo-200'); });
        socket.on('coin-flip', (data) => { showEffect(data.seat, 'coin', data.result === 'HEADS' ? 'H' : 'T'); const color = data.result === 'HEADS' ? 'text-amber-400' : 'text-zinc-400'; addLog(`P${data.seat}`, `flipped a coin: <span class="font-bold ${color} text-lg ml-1">${data.result}</span>`, 'text-amber-100'); });
        socket.on('receive-chat', (data) => { addLog(`P${data.seat}`, data.message, 'text-zinc-100 font-sans'); });
        
    } catch (e) {
        console.error("Matchmaker connection failed.");
    }
});

function createPeerConnection(targetId) {
    if (peerConnections[targetId]) return peerConnections[targetId];

    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections[targetId] = pc;
    
    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('webrtc-ice-candidate', { targetId: targetId, candidate: event.candidate });
        }
    };

    pc.ontrack = (event) => {
        const slot = peerGridMap[targetId];
        if (slot) {
            const videoEl = document.getElementById(`p${slot}-video`);
            const placeholder = document.getElementById(`p${slot}-placeholder`);
            if (videoEl) {
                if (event.streams && event.streams[0]) {
                    if (videoEl.srcObject !== event.streams[0]) {
                        videoEl.srcObject = event.streams[0];
                    }
                } else {
                    if (!videoEl.srcObject) videoEl.srcObject = new MediaStream();
                    videoEl.srcObject.addTrack(event.track);
                }
                
                videoEl.muted = false;
                videoEl.autoplay = true;
                videoEl.classList.remove('hidden');
                
                const playPromise = videoEl.play();
                if (playPromise !== undefined) {
                    playPromise.catch(e => {
                        if (e.name !== 'AbortError') {
                            console.warn("Video play blocked:", e);
                        }
                    });
                }
                
                if (placeholder) {
                    placeholder.classList.add('hidden');
                    placeholder.classList.remove('flex');
                }
                addLog('System', `Connected video feed for P${slot}.`, 'text-emerald-400');
            }
        }
    };
    return pc;
}

function freeGridSlot(socketId, seat) {
    const slot = seat || peerGridMap[socketId];
    if (slot) {
        const videoEl = document.getElementById(`p${slot}-video`);
        const placeholder = document.getElementById(`p${slot}-placeholder`);
        if (videoEl) {
            videoEl.srcObject = null;
            videoEl.classList.add('hidden');
        }
        if (placeholder) {
            placeholder.classList.remove('hidden');
            placeholder.classList.add('flex');
            const span = placeholder.querySelector('span');
            if (span) span.textContent = `Awaiting P${slot}...`;
        }
        const nameEl = document.getElementById(`p${slot}-name`);
        if (nameEl) nameEl.textContent = `P${slot}`;
        
        delete peerGridMap[socketId];
        addLog('System', `P${slot} left the room.`, 'text-red-400');
    }
}

function copyInviteLink() {
    const url = window.location.href; 
    
    const tempInput = document.createElement('input');
    tempInput.value = url;
    document.body.appendChild(tempInput);
    tempInput.select();
    
    try {
        document.execCommand('copy'); 
        addLog('System', 'Invite link copied to clipboard!', 'text-emerald-400 font-bold');
        
        const btn = document.getElementById('copy-link-btn');
        if (btn) {
            const originalHTML = btn.innerHTML;
            btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> COPIED!`;
            btn.classList.replace('bg-emerald-900/80', 'bg-emerald-600');
            
            setTimeout(() => {
                btn.innerHTML = originalHTML;
                btn.classList.replace('bg-emerald-600', 'bg-emerald-900/80');
            }, 2000);
        }
    } catch (err) {
        addLog('System', 'Failed to copy link. Please manually copy the URL.', 'text-red-400');
    }
    
    document.body.removeChild(tempInput);
}

function updateLobbyUI(rooms) {
    const lobbyList = document.getElementById('lobby-room-list');
    if (!lobbyList) return;
    
    lobbyList.innerHTML = '';
    
    const urlParams = new URLSearchParams(window.location.search);
    const inviteRoom = urlParams.get('room');

    if (inviteRoom) {
        const targetRoom = rooms.find(r => r.id === inviteRoom);
        if (targetRoom) {
            lobbyList.innerHTML = `
                <div class="flex flex-col items-center justify-center p-8 mt-10 border border-emerald-900/50 bg-emerald-950/20 rounded-lg shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                    <div class="flex items-center gap-2 mb-3">
                        <span class="text-emerald-300 bg-emerald-900/50 border border-emerald-700/50 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">${targetRoom.format} Format</span>
                    </div>
                    <div class="text-emerald-400 font-display text-4xl mb-1 tracking-widest uppercase">${targetRoom.roomName}</div>
                    <div class="text-zinc-400 text-sm text-center mb-6">Hosted by <span class="text-white font-bold">${targetRoom.hostName}</span></div>
                    <div class="flex gap-6 text-sm text-zinc-300 font-mono mb-4">
                        <span class="flex items-center gap-2"><svg class="w-4 h-4 text-cyan-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg> ${targetRoom.currentPlayers}/${targetRoom.maxPlayers} Duelists</span>
                        ${targetRoom.allowSpectators ? `<span class="flex items-center gap-2"><svg class="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg> Spectating Allowed</span>` : ''}
                    </div>
                </div>
            `;
        } else {
            lobbyList.innerHTML = `
                <div class="flex flex-col items-center justify-center p-8 mt-10 border border-emerald-900/50 bg-emerald-950/20 rounded-lg shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                    <svg class="w-12 h-12 text-emerald-500 mb-3 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4"></path></svg>
                    <div class="text-emerald-400 font-bold text-lg mb-1 tracking-widest uppercase">Private Room Invite</div>
                    <div class="text-zinc-400 text-xs text-center">You have been invited to a private match.<br>Enter your name on the right and connect!</div>
                </div>
            `;
        }
        return;
    }

    if (rooms.length === 0) {
        lobbyList.innerHTML = '<div class="text-zinc-500 italic text-center p-4 mt-10">No public rooms available right now. Host one!</div>';
        return;
    }

    rooms.forEach(room => {
        const roomEl = document.createElement('div');
        roomEl.className = 'room-card border border-zinc-700/80 rounded-lg p-4 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 hover:border-cyan-500/50 transition shadow-lg group';
        roomEl.dataset.format = room.format;
        
        let formatColor = 'text-zinc-300 bg-zinc-800 border-zinc-700';
        if(room.format === 'Domain') formatColor = 'text-indigo-300 bg-indigo-900/50 border-indigo-700/50';
        else if(room.format === 'Advanced') formatColor = 'text-red-300 bg-red-900/50 border-red-700/50';

        roomEl.innerHTML = `
            <div>
                <div class="flex items-center gap-2 mb-1.5">
                    <span class="${formatColor} text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider border">${room.format}</span>
                    <h3 class="text-zinc-100 font-bold text-lg leading-none group-hover:text-cyan-300 transition">${room.roomName}</h3>
                </div>
                <div class="text-xs text-zinc-400 flex items-center gap-4 font-mono">
                    <span class="flex items-center gap-1.5 text-zinc-300"><svg class="w-3.5 h-3.5 text-cyan-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg> ${room.currentPlayers}/${room.maxPlayers} Duelists</span>
                    ${room.allowSpectators ? `<span class="flex items-center gap-1.5 text-zinc-400"><svg class="w-3.5 h-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg> ${room.spectators} Spectators</span>` : ''}
                </div>
            </div>
            <div class="flex items-center gap-2 w-full lg:w-auto mt-2 lg:mt-0">
                ${room.allowSpectators ? `<button onclick="joinServerRoom('${room.id}', true, this)" class="flex-1 lg:flex-none bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-4 py-2 rounded text-sm font-bold transition border border-zinc-700">Spectate</button>` : ''}
                <button onclick="joinServerRoom('${room.id}', false, this)" ${room.currentPlayers >= room.maxPlayers ? 'disabled' : ''} class="flex-1 lg:flex-none bg-cyan-700 hover:bg-cyan-600 text-cyan-50 px-4 py-2 rounded text-sm font-bold shadow-[0_0_10px_rgba(6,182,212,0.3)] border border-cyan-500 transition disabled:opacity-50 disabled:cursor-not-allowed">Join Duel</button>
            </div>
        `;
        lobbyList.appendChild(roomEl);
    });
    
    const activeFilterBtn = document.querySelector('.filter-btn.active');
    if(activeFilterBtn) {
        filterLobby(activeFilterBtn.textContent.trim() === 'All Formats' ? 'All' : activeFilterBtn.textContent.trim());
    }
}

function filterLobby(format) {
    const buttons = document.querySelectorAll('.filter-btn');
    buttons.forEach(btn => {
        if (btn.textContent.trim() === format || (format === 'All' && btn.textContent.trim() === 'All Formats')) {
            btn.classList.remove('bg-zinc-900', 'border-zinc-800', 'text-zinc-500');
            btn.classList.add('active', 'bg-zinc-800', 'border-cyan-500', 'text-cyan-300', 'shadow-[0_0_10px_rgba(6,182,212,0.3)]');
        } else {
            btn.classList.remove('active', 'bg-zinc-800', 'border-cyan-500', 'text-cyan-300', 'shadow-[0_0_10px_rgba(6,182,212,0.3)]');
            btn.classList.add('bg-zinc-900', 'border-zinc-800', 'text-zinc-500');
        }
    });

    const rooms = document.querySelectorAll('.room-card');
    rooms.forEach(room => {
        if (format === 'All' || room.dataset.format === format) {
            room.classList.remove('hidden');
            room.classList.add('flex');
        } else {
            room.classList.add('hidden');
            room.classList.remove('flex');
        }
    });
}

function simulateYugiPassLogin() {
    const btn = document.getElementById('yugipass-login-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Authenticating...';
    btn.disabled = true;

    setTimeout(() => {
        const yugiPassUser = {
            username: 'YugiMuto_YGOrg',
            avatar: 'https://images.ygoprodeck.com/images/cards_cropped/89631139.jpg' 
        };
        
        const nameInput = document.getElementById('setup-name');
        nameInput.value = yugiPassUser.username;
        nameInput.disabled = true; 
        nameInput.classList.add('opacity-50', 'cursor-not-allowed');

        btn.classList.add('hidden');
        document.getElementById('yugipass-user-profile').classList.remove('hidden');
        
        document.getElementById('yp-avatar').src = yugiPassUser.avatar;
        document.getElementById('yp-username').textContent = yugiPassUser.username;

        btn.innerHTML = originalText;
        btn.disabled = false;
    }, 1000);
}

function logoutYugiPass() {
    const nameInput = document.getElementById('setup-name');
    nameInput.value = 'Player 1';
    nameInput.disabled = false;
    nameInput.classList.remove('opacity-50', 'cursor-not-allowed');
    
    document.getElementById('yugipass-login-btn').classList.remove('hidden');
    document.getElementById('yugipass-user-profile').classList.add('hidden');
}

async function launchRoom(btn) {
    if (btn) {
        btn.disabled = true;
        btn.innerText = 'Initializing...';
    }

    totalPlayers = parseInt(document.getElementById('setup-players').value);
    const format = document.getElementById('setup-format').value;
    const isPrivate = document.getElementById('setup-private').checked;
    const allowSpectators = document.getElementById('setup-spectators').checked;
    const hostName = document.getElementById('setup-name').value || 'Player 1';
    const roomName = document.getElementById('setup-room-name') ? document.getElementById('setup-room-name').value : "Arena";

    if (socket && socket.connected) {
        socket.emit('create-room', {
            hostName: hostName,
            roomName: roomName,
            format: format,
            maxPlayers: totalPlayers,
            isPrivate: isPrivate,
            allowSpectators: allowSpectators,
            playerId: myPlayerId
        });
    }

    const modal = document.getElementById('setup-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    
    const grid = document.getElementById('video-grid');
    if (grid) {
        grid.className = 'flex-1 grid gap-0 min-h-0 h-full p-0 bg-black';
        
        if (totalPlayers === 2) {
            grid.classList.add('grid-cols-1', 'grid-rows-2');
            playerGridPositions = [1, 2];
        } else if (totalPlayers <= 4) {
            grid.classList.add('grid-cols-2', 'grid-rows-2');
            playerGridPositions = totalPlayers === 3 ? [1, 2, 3] : [1, 2, 3, 4];
        } else {
            grid.classList.add('grid-cols-3', 'grid-rows-2');
            playerGridPositions = totalPlayers === 5 ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6];
        }
    }

    for(let i = 1; i <= 6; i++) {
        const item = document.getElementById(`grid-item-${i}`);
        if(item) {
            if(i <= totalPlayers) {
                item.classList.remove('hidden');
                item.classList.add('flex');
                updateLPDisplay(i);
            } else {
                item.classList.add('hidden');
                item.classList.remove('flex');
            }
        }
    }
    
    addLog('System', `Room initialized. Host: <span class="text-white">${hostName}</span>. Format: <span class="text-white">${format}</span>.`, 'text-cyan-400 font-bold');
    
    await initWebcam();
    randomizeSeats(false); 

    if (btn) {
        btn.disabled = false;
        btn.innerText = 'Initialize Room';
    }
}

async function joinServerRoom(roomId, isSpectator, btn) {
    if (btn) {
        btn.disabled = true;
        btn.innerText = 'Connecting...';
    }

    const guestName = document.getElementById('setup-name').value || 'Player';

    if(socket && socket.connected) {
        const modal = document.getElementById('setup-modal');
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
        
        if (!isSpectator) {
            await initWebcam();
        }

        socket.emit('join-room', roomId, isSpectator, guestName, myPlayerId);
        currentRoomId = roomId;

        addLog('System', `Connecting to room: ${roomId}...`, 'text-emerald-400 font-bold');
    } else {
        if (btn) {
            btn.innerText = 'Server Offline';
            btn.classList.replace('bg-cyan-700', 'bg-red-700');
            setTimeout(() => {
                btn.innerText = 'Join Duel';
                btn.classList.replace('bg-red-700', 'bg-cyan-700');
                btn.disabled = false;
            }, 2000);
        }
    }
}

function leaveRoom() {
    if (socket && currentRoomId) {
        socket.emit('leave-room', currentRoomId);
        currentRoomId = null;
    }

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (duelActive) stopDuelTimer();
    
    Object.values(peerConnections).forEach(pc => pc.close());
    peerConnections = {};
    
    for (const socketId in peerGridMap) freeGridSlot(socketId);
    
    logEl.innerHTML = '<div class="text-zinc-500 italic">Waiting for room configuration...</div>';
    clearCalc();
    
    window.history.pushState({}, '', window.location.pathname);
    
    const copyBtn = document.getElementById('copy-link-btn');
    if (copyBtn) copyBtn.classList.add('hidden');

    const rightPanelHeader = document.getElementById('right-panel-header');
    if (rightPanelHeader) {
        rightPanelHeader.innerHTML = `
            <svg class="w-10 h-10 text-cyan-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1v1H9V7zm5 0h1v1h-1V7zm-5 4h1v1H9v-1zm5 0h1v1h-1v-1zm-5 4h1v1H9v-1zm5 0h1v1h-1v-1z"/></svg>
            HOST ROOM
        `;
        rightPanelHeader.className = "font-display text-5xl tracking-wider text-cyan-400 uppercase drop-shadow-lg leading-none flex items-center justify-center gap-3";
    }
    
    const hostOptions = document.getElementById('host-options');
    if (hostOptions) hostOptions.classList.remove('hidden');
    
    const launchBtn = document.getElementById('launch-btn');
    if (launchBtn) {
        launchBtn.textContent = 'Initialize Room';
        launchBtn.className = "w-full bg-cyan-700 hover:bg-cyan-600 border border-cyan-400 text-cyan-50 font-bold py-3 px-8 rounded-lg shadow-[0_0_20px_rgba(6,182,212,0.4)] transition text-sm tracking-widest uppercase hover:scale-105 transform";
        launchBtn.onclick = function() { launchRoom(this); };
    }

    const modal = document.getElementById('setup-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
    
    hasInitializedCam = false;
    isCamOn = false;
    isMicOn = false;
}

function toggleMenu(playerNum) {
    if (playerNum !== 1) return;

    const menu = document.getElementById(`cam-menu-${playerNum}`);
    if (menu.classList.contains('hidden')) {
        for (let i = 1; i <= 6; i++) {
            const otherMenu = document.getElementById(`cam-menu-${i}`);
            if (otherMenu) {
                otherMenu.classList.add('hidden');
                otherMenu.classList.remove('flex');
            }
        }
        menu.classList.remove('hidden');
        menu.classList.add('flex');
    } else {
        menu.classList.add('hidden');
        menu.classList.remove('flex');
    }
}

document.addEventListener('click', (e) => {
    for (let i = 1; i <= 6; i++) {
        const menu = document.getElementById(`cam-menu-${i}`);
        const btn = document.getElementById(`cam-btn-${i}`);
        if (menu && !menu.classList.contains('hidden')) {
            if (!menu.contains(e.target) && btn && !btn.contains(e.target)) {
                menu.classList.add('hidden');
                menu.classList.remove('flex');
            }
        }
    }
});

function toggleFlip(playerNum) {
    isFlipped[playerNum] = !isFlipped[playerNum];
    const transformValue = isFlipped[playerNum] ? 'scaleY(-1)' : 'scaleY(1)';
    
    if (playerNum === 1) {
        const videoEl = document.getElementById('local-video');
        if (videoEl) videoEl.style.transform = isFlipped[playerNum] ? 'scaleX(-1) scaleY(-1)' : 'scaleX(-1)';
    } else {
        const videoEl = document.getElementById(`p${playerNum}-video`);
        if (videoEl) videoEl.style.transform = transformValue;
        
        const placeholder = document.getElementById(`p${playerNum}-placeholder`);
        if (placeholder) placeholder.style.transform = transformValue;
    }

    randomizeSeats(false); 
}

function changeBoxOpacity(playerNum, value) {
    const wrapper = document.getElementById(`p${playerNum}-lp-wrapper`);
    if (wrapper) {
        wrapper.style.opacity = value;
    }
}

let timerInterval = null;
let duelStartTime = null;
let duelActive = false;
let isEliminated = { 1: false, 2: false, 3: false, 4: false, 5: false, 6: false };
let isRouletteSpinning = false;
let activePlayerTurn = null;
let clockwiseOrder = [1, 2, 4, 3];
let playerGridPositions = [1, 2, 3, 4];

function randomizeSeats(shuffle = true) {
    if (shuffle) {
        for (let i = playerGridPositions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [playerGridPositions[i], playerGridPositions[j]] = [playerGridPositions[j], playerGridPositions[i]];
        }
    }

    let cols = 2;
    if (totalPlayers === 2) cols = 1;
    else if (totalPlayers > 4) cols = 3;

    playerGridPositions.forEach((playerNum, index) => {
        const gridItem = document.getElementById(`grid-item-${playerNum}`);
        if (gridItem) gridItem.style.order = index + 1;

        const lpWrapper = document.getElementById(`p${playerNum}-lp-wrapper`);
        const isTopRow = index < cols;
        const isLeftCol = index % cols === 0;
        const isRightCol = index % cols === (cols - 1);

        if (lpWrapper) {
            lpWrapper.style.left = '';
            lpWrapper.style.top = '';
            lpWrapper.style.right = '';
            lpWrapper.style.bottom = '';
            lpWrapper.classList.remove('top-1', 'bottom-1', 'left-1', 'right-1');
            
            if (isTopRow) lpWrapper.classList.add('bottom-1');
            else lpWrapper.classList.add('top-1');
            
            if (isLeftCol) lpWrapper.classList.add('right-1');
            else if (isRightCol) lpWrapper.classList.add('left-1');
            else lpWrapper.classList.add('left-1'); 
        }

        // Inner Corner Video Snapping Logic
        let xPos = isLeftCol ? 'right' : (isRightCol ? 'left' : 'center');
        let yPos = isTopRow ? 'bottom' : 'top';
        if (cols === 1) xPos = 'center';

        if (playerNum === 1 && cols !== 1) {
            xPos = (xPos === 'right') ? 'left' : (xPos === 'left' ? 'right' : 'center');
        }

        if (isFlipped[playerNum]) {
            yPos = (yPos === 'top') ? 'bottom' : 'top';
        }
        
        const videoEl = document.getElementById(playerNum === 1 ? 'local-video' : `p${playerNum}-video`);
        if (videoEl) {
            videoEl.style.objectPosition = `${xPos} ${yPos}`;
            videoEl.style.transition = 'object-position 0.5s ease-out, transform 0.3s';
        }
    });

    if (totalPlayers === 2) clockwiseOrder = [playerGridPositions[0], playerGridPositions[1]];
    if (totalPlayers === 3) clockwiseOrder = [playerGridPositions[0], playerGridPositions[1], playerGridPositions[2]];
    if (totalPlayers === 4) clockwiseOrder = [playerGridPositions[0], playerGridPositions[1], playerGridPositions[3], playerGridPositions[2]];
    if (totalPlayers === 5) clockwiseOrder = [playerGridPositions[0], playerGridPositions[1], playerGridPositions[2], playerGridPositions[4], playerGridPositions[3]];
    if (totalPlayers === 6) clockwiseOrder = [playerGridPositions[0], playerGridPositions[1], playerGridPositions[2], playerGridPositions[5], playerGridPositions[4], playerGridPositions[3]];

    if (shuffle) addLog('System', 'Room seating has been randomized!', 'text-indigo-400 italic font-bold');
}

function startDuelTimer() {
    if (duelActive || isRouletteSpinning) return;
    isRouletteSpinning = true;
    
    for (let i = 1; i <= totalPlayers; i++) {
        isEliminated[i] = false;
        lp[i] = 8000;
        updateLPDisplay(i);
        
        const wrapper = document.getElementById(`p${i}-lp-wrapper`);
        if(wrapper) {
            const innerBox = wrapper.firstElementChild;
            
            innerBox.classList.add('bg-zinc-900/35', 'hover:bg-zinc-800', 'border-zinc-700/50');
            innerBox.classList.remove('bg-red-950/90', 'border-red-600', 'shadow-[0_0_15px_rgba(220,38,38,0.5)]', 'ring-2', 'ring-amber-400', 'ring-offset-2', 'ring-offset-black', 'shadow-[0_0_20px_rgba(251,191,36,0.6)]');
            
            const lpText = document.getElementById(`p${i}-lp`);
            let pColor = 'text-blue-400 drop-shadow-[0_0_10px_rgba(96,165,250,0.8)]';
            if(i === 2) pColor = 'text-red-500 drop-shadow-[0_0_10px_rgba(239,68,68,0.8)]';
            if(i === 3) pColor = 'text-yellow-400 drop-shadow-[0_0_10px_rgba(250,204,21,0.8)]';
            if(i === 4) pColor = 'text-purple-400 drop-shadow-[0_0_10px_rgba(192,132,252,0.8)]';
            if(i === 5) pColor = 'text-orange-500 drop-shadow-[0_0_10px_rgba(249,115,22,0.8)]';
            if(i === 6) pColor = 'text-pink-500 drop-shadow-[0_0_10px_rgba(236,72,153,0.8)]';
            if(lpText) lpText.className = `font-display text-5xl leading-none tracking-wider pointer-events-none ${pColor}`;
        }
    }

    const btn = document.getElementById('start-duel-btn');
    btn.classList.add('hidden');
    btn.textContent = 'DUEL!';
    
    const timerEl = document.getElementById('duel-timer');
    timerEl.classList.remove('text-zinc-400', 'text-amber-400', 'animate-pulse');
    timerEl.classList.add('text-cyan-400');
    timerEl.textContent = '00:00:00';
    
    addLog('System', 'Selecting who goes first...', 'text-amber-300 italic');
    
    let ticks = 0;
    const maxTicks = 10 + Math.floor(Math.random() * 10);
    let currentIndex = 0;

    const rouletteInterval = setInterval(() => {
        for(let i = 1; i <= totalPlayers; i++) {
            const w = document.getElementById(`p${i}-lp-wrapper`);
            if(w) w.firstElementChild.classList.remove('ring-2', 'ring-amber-400', 'ring-offset-2', 'ring-offset-black', 'shadow-[0_0_20px_rgba(251,191,36,0.6)]');
        }
        
        const p = clockwiseOrder[currentIndex];
        const wrapper = document.getElementById(`p${p}-lp-wrapper`);
        if(wrapper) {
            const innerBox = wrapper.firstElementChild;
            innerBox.classList.add('ring-2', 'ring-amber-400', 'ring-offset-2', 'ring-offset-black', 'shadow-[0_0_20px_rgba(251,191,36,0.6)]');
        }

        ticks++;
        
        if (ticks >= maxTicks) {
            clearInterval(rouletteInterval);
            isRouletteSpinning = false;
            
            duelActive = true;
            duelStartTime = Date.now();
            activePlayerTurn = p;
            
            timerInterval = setInterval(updateTimer, 1000);
            addLog('System', `DUEL STARTED! P${p} goes first!`, 'text-cyan-400 text-lg uppercase font-bold');
        } else {
            currentIndex = (currentIndex + 1) % totalPlayers;
        }
    }, 100);
}

function updateTimer() {
    if (!duelActive) return;
    const elapsed = Math.floor((Date.now() - duelStartTime) / 1000);
    const h = Math.floor(elapsed / 3600).toString().padStart(2, '0');
    const m = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
    const s = (elapsed % 60).toString().padStart(2, '0');
    const timerEl = document.getElementById('duel-timer');
    if(timerEl) timerEl.textContent = `${h}:${m}:${s}`;
}

function stopDuelTimer() {
    if (!duelActive) return;
    duelActive = false;
    clearInterval(timerInterval);
    const timerEl = document.getElementById('duel-timer');
    if (timerEl) {
        timerEl.classList.remove('text-cyan-400');
        timerEl.classList.add('text-amber-400', 'animate-pulse');
    }
    
    const btn = document.getElementById('start-duel-btn');
    if (btn) {
        btn.classList.remove('hidden');
        btn.textContent = 'NEW DUEL!';
    }

    if (activePlayerTurn) {
        const wrapper = document.getElementById(`p${activePlayerTurn}-lp-wrapper`);
        if (wrapper) wrapper.firstElementChild.classList.remove('ring-2', 'ring-amber-400', 'ring-offset-2', 'ring-offset-black', 'shadow-[0_0_20px_rgba(251,191,36,0.6)]');
        activePlayerTurn = null;
    }
}

function checkWinCondition() {
    if (!duelActive) return;
    let activeCount = 0;
    let winner = null;
    for (let i = 1; i <= totalPlayers; i++) {
        if (!isEliminated[i]) {
            activeCount++;
            winner = i;
        }
    }
    if (activeCount <= 1) {
        stopDuelTimer();
        if (activeCount === 1) {
            addLog('System', `DUEL CONCLUDED! P${winner} WINS!`, 'text-amber-400 font-bold text-xl uppercase');
        } else {
            addLog('System', 'DUEL CONCLUDED! DRAW!', 'text-amber-400 font-bold text-xl uppercase');
        }
    }
}

function passTurn(forcePassFrom = null) {
    let currentPlayer = forcePassFrom || activePlayerTurn;
    if (!currentPlayer) return;
    
    let currentIndex = clockwiseOrder.indexOf(currentPlayer);
    let nextPlayer = null;
    
    for (let i = 1; i <= totalPlayers - 1; i++) {
        let checkIndex = (currentIndex + i) % totalPlayers;
        let checkPlayer = clockwiseOrder[checkIndex];
        if (!isEliminated[checkPlayer]) {
            nextPlayer = checkPlayer;
            break;
        }
    }
    
    if (!forcePassFrom && activePlayerTurn) {
        const wrapper = document.getElementById(`p${activePlayerTurn}-lp-wrapper`);
        if (wrapper) wrapper.firstElementChild.classList.remove('ring-2', 'ring-amber-400', 'ring-offset-2', 'ring-offset-black', 'shadow-[0_0_20px_rgba(251,191,36,0.6)]');
    }
    
    if (nextPlayer) {
        activePlayerTurn = nextPlayer;
        const wrapper = document.getElementById(`p${activePlayerTurn}-lp-wrapper`);
        if (wrapper) wrapper.firstElementChild.classList.add('ring-2', 'ring-amber-400', 'ring-offset-2', 'ring-offset-black', 'shadow-[0_0_20px_rgba(251,191,36,0.6)]');
        addLog('System', `Turn passed to P${activePlayerTurn}`, 'text-amber-200');
    } else {
        activePlayerTurn = null; 
    }
}

function eliminatePlayerId(playerNum) {
    if (isEliminated[playerNum]) return;
    isEliminated[playerNum] = true;
    lp[playerNum] = 0;
    updateLPDisplay(playerNum);
    
    const wrapper = document.getElementById(`p${playerNum}-lp-wrapper`);
    if(wrapper) {
        const innerBox = wrapper.firstElementChild;
        innerBox.classList.remove('bg-zinc-900/35', 'hover:bg-zinc-800', 'border-zinc-700/50', 'ring-2', 'ring-amber-400', 'ring-offset-2', 'ring-offset-black', 'shadow-[0_0_20px_rgba(251,191,36,0.6)]');
        innerBox.classList.add('bg-red-950/90', 'border-red-600', 'shadow-[0_0_15px_rgba(220,38,38,0.5)]');
    }
    
    const lpText = document.getElementById(`p${playerNum}-lp`);
    if(lpText) lpText.className = 'font-display text-5xl leading-none tracking-wider drop-shadow-md line-through text-red-600 opacity-70';
    
    addLog(`P${playerNum}`, 'has been ELIMINATED!', 'text-red-500 font-bold uppercase');
    
    if (activePlayerTurn === playerNum) {
        activePlayerTurn = null;
        passTurn(playerNum);
    }
    checkWinCondition();
}

function eliminateActivePlayer() {
    if (!activeCalcPlayer) return;
    eliminatePlayerId(activeCalcPlayer);
    clearCalc();
}

let hasInitializedCam = false;

async function initWebcam() {
    if (hasInitializedCam) return;
    hasInitializedCam = true;

    const videoEl = document.getElementById('local-video');
    const errorOverlay = document.getElementById('cam-error-message');
    const errorText = document.getElementById('cam-error-text');

    localStream = new MediaStream();

    try {
        const vidStream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 60 } } 
        });
        vidStream.getVideoTracks().forEach(track => localStream.addTrack(track));
        isCamOn = true;
        document.getElementById('cam-icon-on').classList.remove('hidden');
        document.getElementById('cam-icon-off').classList.add('hidden');
        if (errorOverlay) errorOverlay.classList.add('hidden');
    } catch (err) {
        console.warn("Camera access restricted:", err.message);
        isCamOn = false;
        document.getElementById('cam-icon-on').classList.add('hidden');
        document.getElementById('cam-icon-off').classList.remove('hidden');
        if (errorText) errorText.textContent = 'Camera Blocked/Unavailable';
        if (errorOverlay) errorOverlay.classList.remove('hidden');
        addLog('System', `Media notice: Camera unavailable.`, 'text-amber-500');
    }

    try {
        const audStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audStream.getAudioTracks().forEach(track => localStream.addTrack(track));
        isMicOn = true;
        document.getElementById('mic-icon-on').classList.remove('hidden');
        document.getElementById('mic-icon-off').classList.add('hidden');
    } catch (err) {
        console.warn("Mic access restricted:", err.message);
        isMicOn = false;
        document.getElementById('mic-icon-on').classList.add('hidden');
        document.getElementById('mic-icon-off').classList.remove('hidden');
        addLog('System', `Media notice: Mic unavailable.`, 'text-amber-500');
    }

    if (videoEl && localStream.getTracks().length > 0) {
        videoEl.srcObject = localStream;
    }
}

async function toggleMic() {
    if (isMicOn) {
        if (localStream) {
            localStream.getAudioTracks().forEach(track => {
                track.stop();
                localStream.removeTrack(track);
            });
        }
        isMicOn = false;
        document.getElementById('mic-icon-on').classList.add('hidden');
        document.getElementById('mic-icon-off').classList.remove('hidden');
        addLog('System', 'Microphone disabled.');
    } else {
        try {
            const newStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const newAudioTrack = newStream.getAudioTracks()[0];
            
            if (!localStream) localStream = new MediaStream();
            localStream.addTrack(newAudioTrack);
            
            Object.values(peerConnections).forEach(pc => {
                const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
                if (sender) sender.replaceTrack(newAudioTrack);
                else pc.addTrack(newAudioTrack, localStream);
            });
            
            isMicOn = true;
            document.getElementById('mic-icon-on').classList.remove('hidden');
            document.getElementById('mic-icon-off').classList.add('hidden');
            addLog('System', 'Microphone enabled.');
        } catch (err) {
            addLog('System', `Mic notice: Denied or unavailable.`, 'text-amber-500');
        }
    }
}

async function toggleCam() {
    const videoEl = document.getElementById('local-video');
    const errorOverlay = document.getElementById('cam-error-message');
    
    if (isCamOn) {
        if (localStream) {
            localStream.getVideoTracks().forEach(track => {
                track.stop();
                localStream.removeTrack(track);
            });
        }
        isCamOn = false;
        document.getElementById('cam-icon-on').classList.add('hidden');
        document.getElementById('cam-icon-off').classList.remove('hidden');
        if (errorOverlay) errorOverlay.classList.remove('hidden');
        const errText = document.getElementById('cam-error-text');
        if (errText) errText.textContent = 'Camera Off';
        addLog('System', 'Camera disabled.');
    } else {
        try {
            const newStream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 60 } }
            });
            const newVideoTrack = newStream.getVideoTracks()[0];
            
            if (!localStream) localStream = new MediaStream();
            localStream.addTrack(newVideoTrack);
            
            Object.values(peerConnections).forEach(pc => {
                const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) sender.replaceTrack(newVideoTrack);
                else pc.addTrack(newVideoTrack, localStream);
            });
            
            if (videoEl) {
                videoEl.srcObject = null;
                videoEl.srcObject = localStream;
            }
            isCamOn = true;
            
            document.getElementById('cam-icon-on').classList.remove('hidden');
            document.getElementById('cam-icon-off').classList.add('hidden');
            if (errorOverlay) errorOverlay.classList.add('hidden'); 
            addLog('System', 'Camera enabled.');
        } catch (err) {
            const errText = document.getElementById('cam-error-text');
            if (errText) errText.textContent = 'Permission Denied';
            if (errorOverlay) errorOverlay.classList.remove('hidden');
            addLog('System', `Media notice: Camera Denied.`, 'text-amber-500');
        }
    }
}

function addLog(actor, message, colorClass = 'text-zinc-300') {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' });
    const entry = document.createElement('div');
    entry.className = `p-2 rounded bg-zinc-950/50 border border-zinc-800/50 ${colorClass}`;
    
    if(logEl.children.length === 1 && logEl.children[0].classList.contains('italic')) {
        logEl.innerHTML = '';
    }

    let prefix = '';
    if (actor === 'P1') prefix = '<span class="text-blue-400 font-bold drop-shadow-[0_0_5px_rgba(96,165,250,0.8)]">[P1]</span> ';
    else if (actor === 'P2') prefix = '<span class="text-red-500 font-bold drop-shadow-[0_0_5px_rgba(239,68,68,0.8)]">[P2]</span> ';
    else if (actor === 'P3') prefix = '<span class="text-yellow-400 font-bold drop-shadow-[0_0_5px_rgba(250,204,21,0.8)]">[P3]</span> ';
    else if (actor === 'P4') prefix = '<span class="text-purple-400 font-bold drop-shadow-[0_0_5px_rgba(192,132,252,0.8)]">[P4]</span> ';
    else if (actor === 'P5') prefix = '<span class="text-orange-500 font-bold drop-shadow-[0_0_5px_rgba(249,115,22,0.8)]">[P5]</span> ';
    else if (actor === 'P6') prefix = '<span class="text-pink-500 font-bold drop-shadow-[0_0_5px_rgba(236,72,153,0.8)]">[P6]</span> ';
    else if (actor === 'System') prefix = '<span class="text-zinc-400 font-bold">[SYS]</span> ';

    entry.innerHTML = `<span class="text-zinc-600 text-[10px] mr-1">${time}</span> ${prefix}${message}`;
    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;
}

function clearLog(e) {
    if (e) e.stopPropagation();
    logEl.innerHTML = '<div class="text-zinc-500 italic">Log cleared.</div>';
}

let isLogCollapsed = true;
function toggleLog() {
    isLogCollapsed = !isLogCollapsed;
    const panel = document.getElementById('log-panel');
    const logContent = document.getElementById('duel-log');
    const chevron = document.getElementById('log-chevron');
    const chatInput = document.getElementById('chat-input-container');

    if (isLogCollapsed) {
        logContent.classList.add('hidden');
        logContent.classList.remove('flex');
        chatInput.classList.add('hidden');
        chatInput.classList.remove('flex');
        panel.classList.remove('flex-1', 'min-h-0');
        chevron.style.transform = 'rotate(-90deg)';
    } else {
        logContent.classList.remove('hidden');
        logContent.classList.add('flex');
        chatInput.classList.remove('hidden');
        chatInput.classList.add('flex');
        panel.classList.add('flex-1', 'min-h-0');
        chevron.style.transform = 'rotate(0deg)';
        logContent.scrollTop = logContent.scrollHeight;
    }
}

function handleChatKey(e) {
    if (e.key === 'Enter') sendChat();
}

function sendChat() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg) return;

    const escapedMsg = msg.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    addLog('P1', escapedMsg, 'text-zinc-100 font-sans'); 
    
    if (socket && currentRoomId) {
        socket.emit('send-chat', currentRoomId, { seat: peerGridMap[socket.id] || 1, message: escapedMsg });
    }

    input.value = '';
    input.focus();
}

function openCalc(playerNum) {
    if (playerNum !== 1) {
        addLog('System', `You can only edit your own Life Points!`, 'text-amber-400 font-bold');
        return;
    }

    if (isEliminated[playerNum]) {
        addLog('System', `P${playerNum} is already eliminated.`, 'text-red-400');
        return;
    }
    
    activeCalcPlayer = playerNum;
    const label = document.getElementById('calc-target-label');
    
    let pColor = 'blue-400';
    if(playerNum === 2) pColor = 'red-500';
    if(playerNum === 3) pColor = 'yellow-400';
    if(playerNum === 4) pColor = 'purple-400';
    if(playerNum === 5) pColor = 'orange-500';
    if(playerNum === 6) pColor = 'pink-500';

    if (label) {
        label.className = `text-xs font-bold uppercase tracking-widest text-${pColor} drop-shadow-md`;
        label.textContent = playerNum === 1 ? `Your Life Points (P1)` : `P${playerNum} Life Points`;
    }
    
    const input = document.getElementById('calc-input');
    if (input) input.focus();
}

function clearCalc() {
    const input = document.getElementById('calc-input');
    if (input) {
        input.value = '';
        input.focus();
    }
}

function calcType(val) {
    const input = document.getElementById('calc-input');
    if (input) {
        input.value += val;
        input.focus();
    }
}

function calcBksp() {
    const input = document.getElementById('calc-input');
    if (input) {
        input.value = input.value.slice(0, -1);
        input.focus();
    }
}

function calcAction(actionType) {
    if (!activeCalcPlayer) activeCalcPlayer = 1;
    
    const input = document.getElementById('calc-input');
    if (!input) return;

    const val = parseInt(input.value);
    if (isNaN(val) || val < 0) {
        clearCalc();
        return;
    }

    if (actionType === 'set') setLP(activeCalcPlayer, val);
    else if (actionType === 'dmg') changeLP(activeCalcPlayer, -val);
    else if (actionType === 'heal') changeLP(activeCalcPlayer, val);
    
    clearCalc();
}

const calcInputBox = document.getElementById('calc-input');
if (calcInputBox) {
    calcInputBox.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            calcAction('set');
            e.preventDefault();
        } else if (e.key === '-' || e.key === 'Subtract') {
            calcAction('dmg');
            e.preventDefault();
        } else if (e.key === '+' || e.key === 'Add') {
            calcAction('heal');
            e.preventDefault();
        }
    });
}

function updateLPDisplay(player) {
    const currentLP = lp[player];
    const lpEl = document.getElementById(`p${player}-lp`);
    if (lpEl) lpEl.textContent = currentLP;
    
    const bar = document.getElementById(`p${player}-lp-bar`);
    if (bar) {
        const percentage = Math.min((currentLP / 8000) * 100, 100);
        bar.style.width = `${percentage}%`;
        
        if (currentLP >= 10000) {
            bar.style.background = 'linear-gradient(90deg, #fcd34d, #f59e0b, #b45309)';
            bar.style.boxShadow = '0 0 12px rgba(245, 158, 11, 0.8)';
        } else {
            const hue = Math.max(0, Math.min((currentLP / 8000) * 120, 120));
            bar.style.background = `hsl(${hue}, 80%, 50%)`;
            bar.style.boxShadow = `0 0 8px hsl(${hue}, 80%, 50%)`;
        }
    }
}

function changeLP(player, amount) {
    if (isEliminated[player]) return;
    
    const oldLP = lp[player];
    lp[player] = Math.max(0, lp[player] + amount);
    updateLPDisplay(player);
    
    const action = amount > 0 ? 'gained' : 'lost';
    const absAmount = Math.abs(amount);
    const pStr = `P${player}`;
    const color = amount > 0 ? 'text-emerald-400' : 'text-red-400';
    
    addLog(pStr, `${action} ${absAmount} LP. (${oldLP} → ${lp[player]})`, color);
    
    if (socket && currentRoomId) socket.emit('update-lp', currentRoomId, { seat: player, lp: lp[player] });
    if (lp[player] === 0) eliminatePlayerId(player);
}

function setLP(player, amount) {
    if (isEliminated[player]) return;
    
    lp[player] = Math.max(0, amount);
    updateLPDisplay(player);
    const pStr = `P${player}`;
    addLog(pStr, `LP set to ${lp[player]}.`);
    
    if (socket && currentRoomId) socket.emit('update-lp', currentRoomId, { seat: player, lp: lp[player] });
    if (lp[player] === 0) eliminatePlayerId(player);
}

function showEffect(playerNum, type, result) {
    const wrapper = document.getElementById(`p${playerNum}-lp-wrapper`);
    if (!wrapper) return;

    const isTop = wrapper.classList.contains('top-1');
    const isRight = wrapper.classList.contains('right-1');
    
    let effectsContainer = document.getElementById(`effects-container-${playerNum}`);
    if (!effectsContainer) {
        effectsContainer = document.createElement('div');
        effectsContainer.id = `effects-container-${playerNum}`;
        wrapper.appendChild(effectsContainer);
    }
    
    effectsContainer.className = `absolute z-50 flex gap-3 items-center pointer-events-none w-max transition-all duration-300`;
    
    if (isTop) {
        effectsContainer.style.top = '100%';
        effectsContainer.style.bottom = 'auto';
        effectsContainer.style.marginTop = '1rem';
        effectsContainer.style.marginBottom = '0';
    } else {
        effectsContainer.style.bottom = '100%';
        effectsContainer.style.top = 'auto';
        effectsContainer.style.marginBottom = '1rem';
        effectsContainer.style.marginTop = '0';
    }

    if (isRight) {
        effectsContainer.style.right = '0';
        effectsContainer.style.left = 'auto';
        effectsContainer.style.flexDirection = 'row-reverse';
    } else {
        effectsContainer.style.left = '0';
        effectsContainer.style.right = 'auto';
        effectsContainer.style.flexDirection = 'row'; 
    }

    const itemWrapper = document.createElement('div');
    itemWrapper.className = `transition-opacity duration-500 shrink-0`;

    const spanId = `effect-res-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const el = document.createElement('div');
    el.className = 'animate-toss flex items-center justify-center font-display leading-none ';

    if (type === 'coin') {
        el.className += 'w-16 h-16 rounded-full bg-gradient-to-tr from-amber-600 via-yellow-400 to-amber-200 border-4 border-amber-700 shadow-[0_0_20px_rgba(251,191,36,0.8)] text-amber-900 text-5xl font-bold tracking-tighter';
        el.innerHTML = `<span class="opacity-0 transition-opacity duration-200 drop-shadow-sm mt-2" id="${spanId}">${result}</span>`;
    } else {
        el.className += 'w-16 h-16 rounded-xl bg-gradient-to-br from-white to-zinc-200 border-2 border-zinc-400 shadow-[0_0_20px_rgba(255,255,255,0.8)] text-zinc-900 text-6xl font-bold tracking-tighter';
        el.innerHTML = `<span class="opacity-0 transition-opacity duration-200 drop-shadow-sm mt-2" id="${spanId}">${result}</span>`;
    }

    itemWrapper.appendChild(el);
    effectsContainer.appendChild(itemWrapper);

    setTimeout(() => {
        const resSpan = document.getElementById(spanId);
        if (resSpan) resSpan.classList.remove('opacity-0');
    }, 1200);

    setTimeout(() => {
        itemWrapper.style.opacity = '0';
        itemWrapper.dataset.faded = 'true'; 
        
        setTimeout(() => {
            if (effectsContainer.parentElement) {
                const allChildren = Array.from(effectsContainer.children);
                const allFaded = allChildren.every(child => child.dataset.faded === 'true');
                
                if (allFaded) effectsContainer.parentElement.removeChild(effectsContainer);
            }
        }, 500);
    }, 3500);
}

function rollDice() {
    const result = Math.floor(Math.random() * 6) + 1;
    const p = activeCalcPlayer || 1;
    addLog(`P${p}`, `rolled a 6-sided die: <span class="font-bold text-indigo-400 text-lg ml-1">${result}</span>`, 'text-indigo-200');
    showEffect(p, 'dice', result);
    if (socket && currentRoomId) socket.emit('dice-roll', currentRoomId, { seat: p, result: result });
}

function flipCoin() {
    const isHeads = Math.random() >= 0.5;
    const result = isHeads ? 'HEADS' : 'TAILS';
    const color = isHeads ? 'text-amber-400' : 'text-zinc-400';
    const p = activeCalcPlayer || 1;
    addLog(`P${p}`, `flipped a coin: <span class="font-bold ${color} text-lg ml-1">${result}</span>`, 'text-amber-100');
    showEffect(p, 'coin', isHeads ? 'H' : 'T');
    if (socket && currentRoomId) socket.emit('coin-flip', currentRoomId, { seat: p, result: result });
}

let searchTimeout;
let cardHistory = [];
let searchSelectedIndex = -1;

async function searchCard(query) {
    clearTimeout(searchTimeout);
    const resultsBox = document.getElementById('search-results');
    if (!resultsBox) return;
    
    if (!query || query.length < 3) {
        resultsBox.classList.add('hidden');
        searchSelectedIndex = -1;
        return;
    }
    
    searchTimeout = setTimeout(async () => {
        try {
            const res = await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(query)}&num=10&offset=0`);
            if (!res.ok) throw new Error('No cards found');
            const data = await res.json();
            
            resultsBox.innerHTML = '';
            searchSelectedIndex = -1;
            data.data.slice(0, 8).forEach(card => {
                const div = document.createElement('div');
                div.className = 'search-item p-2 hover:bg-zinc-700 cursor-pointer text-xs text-zinc-200 border-b border-zinc-700/50 last:border-0 truncate font-semibold';
                div.textContent = card.name;
                div.onclick = () => selectCard(card);
                resultsBox.appendChild(div);
            });
            resultsBox.classList.remove('hidden');
        } catch (err) {
            resultsBox.innerHTML = '<div class="p-2 text-xs text-zinc-500 italic">No matches found...</div>';
            resultsBox.classList.remove('hidden');
            searchSelectedIndex = -1;
        }
    }, 500); 
}

function handleSearchKey(e) {
    const resultsBox = document.getElementById('search-results');
    if (!resultsBox || resultsBox.classList.contains('hidden')) return;

    const items = resultsBox.getElementsByClassName('search-item');
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        searchSelectedIndex++;
        if (searchSelectedIndex >= items.length) searchSelectedIndex = 0;
        updateSearchSelection(items);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        searchSelectedIndex--;
        if (searchSelectedIndex < 0) searchSelectedIndex = items.length - 1;
        updateSearchSelection(items);
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (searchSelectedIndex >= 0 && searchSelectedIndex < items.length) {
            items[searchSelectedIndex].click();
        } else if (items.length > 0) {
            items[0].click();
        }
    }
}

function updateSearchSelection(items) {
    for (let i = 0; i < items.length; i++) {
        if (i === searchSelectedIndex) {
            items[i].classList.add('bg-zinc-700');
            items[i].scrollIntoView({ block: 'nearest' });
        } else {
            items[i].classList.remove('bg-zinc-700');
        }
    }
}

function selectCard(card) {
    const searchResults = document.getElementById('search-results');
    if(searchResults) searchResults.classList.add('hidden');
    
    const cardSearch = document.getElementById('card-search');
    if(cardSearch) cardSearch.value = '';
    
    const placeholder = document.getElementById('preview-placeholder');
    if(placeholder) placeholder.classList.add('hidden');
    
    const previewContainer = document.getElementById('card-preview');
    if(previewContainer) {
        previewContainer.classList.remove('hidden');
        previewContainer.classList.add('flex');
    }
    
    const previewImg = document.getElementById('preview-img');
    if(previewImg) previewImg.src = card.card_images[0].image_url;
    
    const previewName = document.getElementById('preview-name');
    if(previewName) previewName.textContent = card.name;
    
    const statsEl = document.getElementById('preview-stats');
    if(statsEl) {
        statsEl.innerHTML = '';
        statsEl.classList.remove('hidden');
        
        if (card.type && card.type.includes("Monster")) {
            let levelStr = "";
            if (card.type.includes("XYZ")) levelStr = `Rank ${card.level}`;
            else if (card.type.includes("Link")) levelStr = `Link-${card.linkval}`;
            else if (card.level !== undefined) levelStr = `Level ${card.level}`;

            let atkDefStr = `ATK ${card.atk !== undefined ? card.atk : '?'}`;
            if (card.def !== undefined) atkDefStr += ` / DEF ${card.def}`;

            statsEl.innerHTML = `
                ${card.attribute ? `<span class="bg-zinc-800 px-1 rounded border border-zinc-700">${card.attribute}</span>` : ''}
                ${levelStr ? `<span class="bg-zinc-800 px-1 rounded border border-zinc-700">${levelStr}</span>` : ''}
                <span class="bg-zinc-800 px-1 rounded border border-zinc-700">${card.race} / ${card.type.replace(' Monster', '')}</span>
                <span class="bg-zinc-800 px-1 rounded border border-zinc-700 font-bold text-amber-200">${atkDefStr}</span>
            `;
        } else if (card.type && (card.type.includes("Spell") || card.type.includes("Trap"))) {
            statsEl.innerHTML = `
                <span class="bg-zinc-800 px-1 rounded border border-zinc-700">${card.type}</span>
                <span class="bg-zinc-800 px-1 rounded border border-zinc-700">${card.race}</span>
            `;
        } else {
            statsEl.classList.add('hidden');
        }
    }

    const previewDesc = document.getElementById('preview-desc');
    if(previewDesc) previewDesc.textContent = card.desc;
    
    if (cardHistory.length === 0 || cardHistory[0].id !== card.id) {
        addLog('System', `Viewed card: <span class="font-bold text-cyan-300">${card.name}</span>`);
    }
    
    updateCardHistory(card);
}

function updateCardHistory(card) {
    cardHistory = cardHistory.filter(c => c.id !== card.id);
    cardHistory.unshift(card); 
    if (cardHistory.length > 20) cardHistory.pop();
    renderCardHistory();
}

function renderCardHistory() {
    const list = document.getElementById('card-history-list');
    const emptyState = document.getElementById('empty-history');
    if(!list || !emptyState) return;
    
    if (cardHistory.length > 0) {
        emptyState.classList.add('hidden');
        list.classList.remove('hidden');
    } else {
        emptyState.classList.remove('hidden');
        list.classList.add('hidden');
    }
    
    list.innerHTML = '';
    cardHistory.forEach(c => {
        const li = document.createElement('li');
        li.className = 'hover:bg-zinc-800/60 group transition cursor-pointer rounded flex items-center gap-2 p-1';
        li.onclick = () => selectCard(c);
        
        const bullet = document.createElement('span');
        bullet.className = 'text-zinc-600 text-[8px] shrink-0';
        bullet.innerHTML = '&#9679;';
        
        const img = document.createElement('img');
        img.src = `https://images.ygoprodeck.com/images/cards_cropped/${c.id}.jpg`;
        img.onerror = function() { this.src = c.card_images[0].image_url_small; };
        img.className = 'w-9 h-9 rounded-sm object-cover shrink-0 border border-zinc-700 bg-zinc-950';
        
        const span = document.createElement('span');
        span.className = 'truncate text-[16px] flex-1 group-hover:text-cyan-400 transition';
        span.textContent = c.name;
        
        li.appendChild(bullet);
        li.appendChild(img);
        li.appendChild(span);
        list.appendChild(li);
    });
}

document.addEventListener('click', (e) => {
    const searchContainer = document.getElementById('search-results');
    const searchInput = document.getElementById('card-search');
    if (searchContainer && !searchContainer.contains(e.target) && e.target !== searchInput) {
        searchContainer.classList.add('hidden');
    }
});

function startDrag(e, playerNum) {
    if (playerNum !== 1) return;

    dragState.active = true;
    dragState.moved = false;
    dragState.playerNum = playerNum;
    dragState.el = document.getElementById(`p${playerNum}-lp-wrapper`);
    dragState.container = document.getElementById(`p${playerNum}-container`);
    
    dragState.startX = e.clientX || (e.touches && e.touches[0].clientX);
    dragState.startY = e.clientY || (e.touches && e.touches[0].clientY);
    
    const rect = dragState.el.getBoundingClientRect();
    const containerRect = dragState.container.getBoundingClientRect();
    
    dragState.initialLeft = rect.left - containerRect.left;
    dragState.initialTop = rect.top - containerRect.top;

    dragState.el.style.transition = 'none';
    dragState.el.style.zIndex = '50'; 
    
    dragState.el.style.left = dragState.initialLeft + 'px';
    dragState.el.style.top = dragState.initialTop + 'px';
    dragState.el.style.right = 'auto';
    dragState.el.style.bottom = 'auto';
    
    dragState.el.classList.remove('top-1', 'bottom-1', 'left-1', 'right-1');
}

function onDrag(e) {
    if (!dragState.active) return;
    
    const clientX = e.clientX || (e.touches && e.touches[0].clientX) || dragState.startX;
    const clientY = e.clientY || (e.touches && e.touches[0].clientY) || dragState.startY;
    
    const dx = clientX - dragState.startX;
    const dy = clientY - dragState.startY;
    
    if (!dragState.moved && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        dragState.moved = true;
    }
    
    if (dragState.moved) {
        if (e.cancelable) e.preventDefault();
        dragState.el.style.left = (dragState.initialLeft + dx) + 'px';
        dragState.el.style.top = (dragState.initialTop + dy) + 'px';
    }
}

function endDrag(e) {
    if (!dragState.active) return;
    
    if (!dragState.moved) {
        openCalc(dragState.playerNum);
    }
    
    snapToCorner(dragState.el, dragState.container);
    
    dragState.el.style.transition = '';
    dragState.el.style.zIndex = '20';
    
    dragState.active = false;
    dragState.el = null;
}

function snapToCorner(el, container) {
    const elRect = el.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    
    const centerX = elRect.left + elRect.width / 2 - cRect.left;
    const centerY = elRect.top + elRect.height / 2 - cRect.top;
    
    const isLeft = centerX < cRect.width / 2;
    const isTop = centerY < cRect.height / 2;
    
    el.style.left = '';
    el.style.top = '';
    el.style.right = '';
    el.style.bottom = '';
    
    el.classList.remove('top-1', 'bottom-1', 'left-1', 'right-1');
    
    if (isTop) el.classList.add('top-1');
    else el.classList.add('bottom-1');
    
    if (isLeft) el.classList.add('left-1');
    else el.classList.add('right-1');
}

document.addEventListener('pointermove', onDrag, { passive: false });
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

document.addEventListener('keydown', function(e) {
    if (e.code === 'Space' && duelActive && !isRouletteSpinning) {
        if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
            return;
        }
        e.preventDefault(); 
        passTurn();
    }
});

let targetDMPlayer = null;
let dmSearchTimeout;
let dmSelectedIndex = -1;

function openDMSearch(playerNum) {
    if (playerNum !== 1) return;
    
    targetDMPlayer = playerNum;
    const modal = document.getElementById('dm-modal');
    if(modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
    
    const input = document.getElementById('dm-search-input');
    if(input) {
        input.value = '';
        input.focus();
    }
    
    const dmResults = document.getElementById('dm-search-results');
    if(dmResults) dmResults.innerHTML = '<div class="text-zinc-600 text-xs italic text-center py-4">Type a card name to search...</div>';
}

function closeDMSearch() {
    const modal = document.getElementById('dm-modal');
    if(modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    targetDMPlayer = null;
}

async function searchDMCard(query) {
    clearTimeout(dmSearchTimeout);
    const resultsBox = document.getElementById('dm-search-results');
    if(!resultsBox) return;
    
    if (!query || query.length < 3) {
        resultsBox.innerHTML = '<div class="text-zinc-600 text-xs italic text-center py-4">Type a card name to search...</div>';
        dmSelectedIndex = -1;
        return;
    }
    
    dmSearchTimeout = setTimeout(async () => {
        try {
            const res = await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(query)}&num=15&offset=0`);
            if (!res.ok) throw new Error('No cards found');
            const data = await res.json();
            
            const monsters = data.data.filter(c => c.type && c.type.includes("Monster"));
            
            resultsBox.innerHTML = '';
            dmSelectedIndex = -1;
            
            if(monsters.length === 0) {
                resultsBox.innerHTML = '<div class="p-2 text-xs text-zinc-500 italic">No monsters found...</div>';
                return;
            }

            monsters.slice(0, 10).forEach(card => {
                const div = document.createElement('div');
                div.className = 'dm-search-item flex items-center gap-2 p-2 hover:bg-zinc-800 cursor-pointer rounded transition border border-transparent';
                div.onclick = () => selectDMCard(card);
                
                const img = document.createElement('img');
                img.src = `https://images.ygoprodeck.com/images/cards_cropped/${card.id}.jpg`;
                img.onerror = function() { this.src = card.card_images[0].image_url_small; }; 
                img.className = 'w-8 h-8 rounded-full object-cover shrink-0 border border-zinc-700 bg-zinc-950';
                
                const nameSpan = document.createElement('span');
                nameSpan.className = 'text-sm text-zinc-200 font-semibold truncate';
                nameSpan.textContent = card.name;
                
                div.appendChild(img);
                div.appendChild(nameSpan);
                resultsBox.appendChild(div);
            });
        } catch (err) {
            resultsBox.innerHTML = '<div class="p-2 text-xs text-zinc-500 italic">No matches found...</div>';
            dmSelectedIndex = -1;
        }
    }, 400);
}

function handleDMSearchKey(e) {
    const resultsBox = document.getElementById('dm-search-results');
    if(!resultsBox) return;
    
    const items = resultsBox.getElementsByClassName('dm-search-item');
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        dmSelectedIndex++;
        if (dmSelectedIndex >= items.length) dmSelectedIndex = 0;
        updateDMSearchSelection(items);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        dmSelectedIndex--;
        if (dmSelectedIndex < 0) dmSelectedIndex = items.length - 1;
        updateDMSearchSelection(items);
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (dmSelectedIndex >= 0 && dmSelectedIndex < items.length) {
            items[dmSelectedIndex].click();
        } else if (items.length > 0) {
            items[0].click();
        }
    }
}

function updateDMSearchSelection(items) {
    for (let i = 0; i < items.length; i++) {
        if (i === dmSelectedIndex) {
            items[i].classList.add('bg-zinc-800', 'border-amber-500/50');
            items[i].classList.remove('border-transparent');
            items[i].scrollIntoView({ block: 'nearest' });
        } else {
            items[i].classList.remove('bg-zinc-800', 'border-amber-500/50');
            items[i].classList.add('border-transparent');
        }
    }
}

function selectDMCard(card) {
    if(!targetDMPlayer) return;
    
    const imgEl = document.getElementById(`p${targetDMPlayer}-dm-img`);
    const containerEl = document.getElementById(`p${targetDMPlayer}-dm-container`);
    
    if(imgEl) {
        imgEl.src = `https://images.ygoprodeck.com/images/cards_cropped/${card.id}.jpg`;
        imgEl.onerror = function() { this.src = card.card_images[0].image_url_small; };
    }
    if(containerEl) containerEl.classList.remove('hidden');
    
    dmCounts[targetDMPlayer] = 0;
    const dmCounter = document.getElementById(`p${targetDMPlayer}-dm-counter`);
    if(dmCounter) dmCounter.textContent = '0';
    
    let pColor = 'text-blue-400';
    if(targetDMPlayer === 2) pColor = 'text-red-500';
    if(targetDMPlayer === 3) pColor = 'text-yellow-400';
    if(targetDMPlayer === 4) pColor = 'text-purple-400';
    if(targetDMPlayer === 5) pColor = 'text-orange-500';
    if(targetDMPlayer === 6) pColor = 'text-pink-500';

    addLog(`P${targetDMPlayer}`, `set <span class="font-bold ${pColor} drop-shadow-sm">${card.name}</span> as their Deck Master!`, 'text-amber-200');
    
    if (socket && currentRoomId) {
        socket.emit('set-dm-card', currentRoomId, { seat: targetDMPlayer, card: card });
    }
    
    closeDMSearch();
}

function handleDMClick(e, playerNum) {
    if (playerNum !== 1) return;
    e.stopPropagation(); 
    
    if (e.button === 0) { 
        dmCounts[playerNum]++;
    } else if (e.button === 2) { 
        dmCounts[playerNum] = Math.max(0, dmCounts[playerNum] - 1); 
    }
    
    const counterEl = document.getElementById(`p${playerNum}-dm-counter`);
    if(counterEl) {
        counterEl.textContent = dmCounts[playerNum];
        counterEl.classList.add('scale-125', 'bg-amber-300');
        setTimeout(() => {
            counterEl.classList.remove('scale-125', 'bg-amber-300');
        }, 150);
    }

    if (socket && currentRoomId) {
        socket.emit('update-dm-count', currentRoomId, { seat: playerNum, dmCount: dmCounts[playerNum] });
    }
}
