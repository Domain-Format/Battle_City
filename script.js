 <script>
        // --- Core State ---
        let totalPlayers = 4;
        let mySeat = null; 
        let roomPlayers = {}; 
        let lp = { 1: 8000, 2: 8000, 3: 8000, 4: 8000, 5: 8000, 6: 8000 };
        const logEl = document.getElementById('duel-log');

        let localStream = null;
        let isMicOn = true;
        let isCamOn = true;
        let hasInitializedCam = false;
        let yugiPassUser = null;
        
        let isFlipped = { 1: false, 2: false, 3: false, 4: false, 5: false, 6: false }; 
        let isEliminated = { 1: false, 2: false, 3: false, 4: false, 5: false, 6: false }; 
        let activeCalcPlayer = null;
        let dmCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
        let dragState = { active: false, el: null, container: null, playerNum: null, startX: 0, startY: 0, initialLeft: 0, initialTop: 0, moved: false };

        const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
        let peerConnections = {}; 

        let socket = null;
        let currentRoomId = null;

        window.addEventListener('DOMContentLoaded', () => {
            try {
                socket = io('https://battle-city-7f80.onrender.com');
                
                socket.on('connect', () => {
                    const lobbyHeader = document.querySelector('h2.text-cyan-400');
                    if (!lobbyHeader.innerHTML.includes('ONLINE')) {
                        lobbyHeader.innerHTML += ' <span class="text-[10px] text-emerald-400 font-mono tracking-normal ml-3 px-1.5 py-0.5 border border-emerald-500/50 rounded bg-emerald-900/30">ONLINE</span>';
                    }
                });

                socket.on('lobby-update', updateLobbyUI);

                socket.on('room-created', (roomId) => { currentRoomId = roomId; });

                socket.on('room-joined', async (room, assignedSeat) => {
                    currentRoomId = room.id;
                    mySeat = assignedSeat;
                    totalPlayers = room.maxPlayers;
                    roomPlayers = room.players;

                    document.getElementById('setup-modal').classList.add('hidden');
                    document.getElementById('setup-modal').classList.remove('flex');
                    
                    const grid = document.getElementById('video-grid');
                    grid.className = 'flex-1 grid gap-0 min-h-0 h-full p-0 bg-black z-0';
                    if (totalPlayers === 2) { grid.classList.add('grid-cols-1', 'grid-rows-2', 'lg:grid-cols-2', 'lg:grid-rows-1'); playerGridPositions = [1, 2]; }
                    else if (totalPlayers <= 4) { grid.classList.add('grid-cols-2', 'grid-rows-2'); playerGridPositions = [1, 2, 3, 4]; }
                    else { grid.classList.add('grid-cols-3', 'grid-rows-2'); playerGridPositions = [1, 2, 3, 4, 5, 6]; }

                    for(let i = 1; i <= 6; i++) {
                        const item = document.getElementById(`grid-item-${i}`);
                        if(item) {
                            if(i <= totalPlayers) {
                                item.classList.remove('hidden');
                                item.classList.add('flex');
                                
                                const pData = Object.values(roomPlayers).find(p => p.seat === i);
                                if (pData) {
                                    document.getElementById(`p${i}-name`).textContent = pData.name;
                                    document.getElementById(`p${i}-placeholder`).querySelector('span').textContent = 'Connecting...';
                                    
                                    // Apply fetched state for late-joiners
                                    isFlipped[i] = pData.isFlipped || false;
                                    const videoEl = document.getElementById(`p${i}-video`);
                                    if (videoEl) videoEl.style.transform = isFlipped[i] ? 'scaleY(-1)' : 'scaleY(1)';

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
                                            imgEl.onerror = function() { this.src = pData.dmCard.card_images[0].image_url_small; };
                                            containerEl.classList.remove('hidden');
                                        }
                                    }
                                    
                                    if (pData.isEliminated) eliminatePlayerId(i, false);
                                } else {
                                    document.getElementById(`p${i}-name`).textContent = `P${i}`;
                                    document.getElementById(`p${i}-placeholder`).querySelector('span').textContent = `Awaiting P${i}...`;
                                    lp[i] = 8000;
                                    updateLPDisplay(i);
                                }
                            } else {
                                item.classList.add('hidden');
                                item.classList.remove('flex');
                            }
                        }
                    }

                    if (mySeat) {
                        document.getElementById(`cam-btn-${mySeat}`).classList.remove('hidden');
                        activeCalcPlayer = mySeat;
                        document.getElementById('calc-target-label').textContent = `Your Life Points (P${mySeat})`;
                        
                        let pColor = 'blue-400';
                        if(mySeat === 2) pColor = 'red-500';
                        if(mySeat === 3) pColor = 'yellow-400';
                        if(mySeat === 4) pColor = 'purple-400';
                        if(mySeat === 5) pColor = 'orange-500';
                        if(mySeat === 6) pColor = 'pink-500';
                        document.getElementById('calc-target-label').className = `text-xs font-bold uppercase tracking-widest text-${pColor} drop-shadow-md`;
                        
                        await initWebcam();
                    }

                    randomizeSeats(false); 
                    addLog('System', `Joined room: ${room.roomName} as P${mySeat}`, 'text-emerald-400 font-bold');
                });

                socket.on('player-joined', async (data) => {
                    const targetId = data.newPlayerId;
                    roomPlayers[targetId] = { seat: data.seat, name: data.name };
                    
                    document.getElementById(`p${data.seat}-name`).textContent = data.name;
                    document.getElementById(`p${data.seat}-placeholder`).querySelector('span').textContent = 'Connecting...';
                    addLog('System', `<span class="text-cyan-300">${data.name}</span> joined the room as P${data.seat}!`, 'text-cyan-400 font-bold');
                    
                    const pc = createPeerConnection(targetId);
                    try {
                        const offer = await pc.createOffer();
                        await pc.setLocalDescription(offer);
                        socket.emit('webrtc-offer', { targetId: targetId, sdp: pc.localDescription });
                    } catch (err) { console.error("Error creating WebRTC offer:", err); }
                });

                socket.on('sync-layout', (layoutPositions) => { playerGridPositions = layoutPositions; randomizeSeats(false); });

                socket.on('update-lp', (data) => {
                    lp[data.seat] = data.lp;
                    updateLPDisplay(data.seat);
                    if (data.logMessage) addLog(`P${data.seat}`, data.logMessage, data.color);
                });

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
                        imgEl.onerror = function() { this.src = data.card.card_images[0].image_url_small; };
                        containerEl.classList.remove('hidden');
                        dmCounts[data.seat] = 0;
                        document.getElementById(`p${data.seat}-dm-counter`).textContent = '0';
                        
                        let pColor = 'text-blue-400';
                        if(data.seat === 2) pColor = 'text-red-500';
                        if(data.seat === 3) pColor = 'text-yellow-400';
                        if(data.seat === 4) pColor = 'text-purple-400';
                        if(data.seat === 5) pColor = 'text-orange-500';
                        if(data.seat === 6) pColor = 'text-pink-500';
                        addLog(`P${data.seat}`, `set <span class="font-bold ${pColor} drop-shadow-sm">${data.card.name}</span> as their Deck Master!`, 'text-amber-200');
                    }
                });

                socket.on('eliminate-player', (data) => { eliminatePlayerId(data.seat, false); });

                socket.on('dice-roll', (data) => {
                    addLog(`P${data.seat}`, `rolled a 6-sided die: <span class="font-bold text-indigo-400 text-lg ml-1">${data.result}</span>`, 'text-indigo-200');
                    showEffect(data.seat, 'dice', data.result);
                });

                socket.on('coin-flip', (data) => {
                    const color = data.isHeads ? 'text-amber-400' : 'text-zinc-400';
                    addLog(`P${data.seat}`, `flipped a coin: <span class="font-bold ${color} text-lg ml-1">${data.resultText}</span>`, 'text-amber-100');
                    showEffect(data.seat, 'coin', data.isHeads ? 'H' : 'T');
                });

                socket.on('receive-chat', (data) => { addLog(`P${data.seat}`, data.msg, 'text-zinc-100 font-sans'); });

                socket.on('camera-flipped', (data) => {
                    isFlipped[data.seat] = data.isFlipped;
                    const videoEl = document.getElementById(`p${data.seat}-video`);
                    if (videoEl) videoEl.style.transform = data.isFlipped ? 'scaleY(-1)' : 'scaleY(1)';
                });

                socket.on('webrtc-offer', async (data) => {
                    const { senderId, sdp } = data;
                    const pc = createPeerConnection(senderId);
                    try {
                        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
                        const answer = await pc.createAnswer();
                        await pc.setLocalDescription(answer);
                        socket.emit('webrtc-answer', { targetId: senderId, sdp: pc.localDescription });
                    } catch (err) { console.error(err); }
                });

                socket.on('webrtc-answer', async (data) => {
                    const pc = peerConnections[data.senderId];
                    if (pc) {
                        try { await pc.setRemoteDescription(new RTCSessionDescription(data.sdp)); } 
                        catch (err) { console.error(err); }
                    }
                });

                socket.on('webrtc-ice-candidate', async (data) => {
                    const pc = peerConnections[data.senderId];
                    if (pc && data.candidate) {
                        try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } 
                        catch (err) { console.error(err); }
                    }
                });

                socket.on('player-left', (data) => {
                    const { socketId, seat } = data;
                    if (peerConnections[socketId]) {
                        peerConnections[socketId].close();
                        delete peerConnections[socketId];
                    }
                    freeGridSlot(seat);
                    delete roomPlayers[socketId];
                });

                socket.on('error', (msg) => { addLog('System', `Server Error: ${msg}`, 'text-red-500 font-bold'); });
            } catch (e) { console.error("Matchmaker connection failed."); }
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
                const slot = roomPlayers[targetId]?.seat;
                if (slot) {
                    const videoEl = document.getElementById(`p${slot}-video`);
                    const placeholder = document.getElementById(`p${slot}-placeholder`);
                    if (videoEl) {
                        if (event.streams && event.streams[0]) {
                            videoEl.srcObject = event.streams[0];
                        } else {
                            if (!videoEl.srcObject) videoEl.srcObject = new MediaStream();
                            videoEl.srcObject.addTrack(event.track);
                        }
                        videoEl.muted = false;
                        videoEl.autoplay = true;
                        videoEl.classList.remove('hidden');
                        videoEl.play().catch(e => console.warn("Video play blocked:", e));
                        
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

        function freeGridSlot(seat) {
            const videoEl = document.getElementById(`p${seat}-video`);
            const placeholder = document.getElementById(`p${seat}-placeholder`);
            if (videoEl) { videoEl.srcObject = null; videoEl.classList.add('hidden'); }
            if (placeholder) {
                placeholder.classList.remove('hidden');
                placeholder.classList.add('flex');
                placeholder.querySelector('span').textContent = `Awaiting P${seat}...`;
            }
            document.getElementById(`p${seat}-name`).textContent = `P${seat}`;
            addLog('System', `P${seat} disconnected.`, 'text-red-400');
        }

        function launchRoom(btn) {
            if (btn) { btn.disabled = true; btn.innerText = 'Initializing...'; }

            const totalPlayersReq = parseInt(document.getElementById('setup-players').value);
            const format = document.getElementById('setup-format').value;
            const isPrivate = document.getElementById('setup-private').checked;
            const allowSpectators = document.getElementById('setup-spectators').checked;
            const hostName = document.getElementById('setup-name').value || 'Player';
            const roomName = document.getElementById('setup-room-name').value || "Arena";

            if (socket && socket.connected) {
                socket.emit('create-room', {
                    hostName: hostName, roomName: roomName, format: format, maxPlayers: totalPlayersReq, isPrivate: isPrivate, allowSpectators: allowSpectators
                });
            } else {
                if (btn) {
                    btn.innerText = 'Server Offline';
                    btn.classList.replace('bg-cyan-700', 'bg-red-700');
                    setTimeout(() => { btn.innerText = 'Initialize Room'; btn.classList.replace('bg-red-700', 'bg-cyan-700'); btn.disabled = false; }, 2000);
                }
            }
        }

        function joinServerRoom(roomId, isSpectator, btn) {
            if (btn) { btn.disabled = true; btn.innerText = 'Connecting...'; }
            const guestName = document.getElementById('setup-name').value || 'Player';

            if(socket && socket.connected) socket.emit('join-room', roomId, isSpectator, guestName);
            else {
                if (btn) {
                    btn.innerText = 'Server Offline';
                    btn.classList.replace('bg-cyan-700', 'bg-red-700');
                    setTimeout(() => { btn.innerText = 'Join Duel'; btn.classList.replace('bg-red-700', 'bg-cyan-700'); btn.disabled = false; }, 2000);
                }
            }
        }

        function leaveRoom() {
            if (socket && currentRoomId) { socket.emit('leave-room', currentRoomId); currentRoomId = null; }
            if (localStream) { localStream.getTracks().forEach(track => track.stop()); localStream = null; }
            if (duelActive) stopDuelTimer();
            Object.values(peerConnections).forEach(pc => pc.close());
            peerConnections = {};
            for (let i = 1; i <= 6; i++) freeGridSlot(i);
            mySeat = null; roomPlayers = {}; playerGridPositions = [1, 2, 3, 4, 5, 6];
            logEl.innerHTML = '<div class="text-zinc-500 italic">Waiting for room configuration...</div>';
            clearCalc();
            document.getElementById('setup-modal').classList.remove('hidden'); document.getElementById('setup-modal').classList.add('flex');
            for(let i=1; i<=6; i++) { const btn = document.getElementById(`cam-btn-${i}`); if (btn) btn.classList.add('hidden'); }
            if (socket) socket.emit('request-lobby-update');
            hasInitializedCam = false;
        }

        async function initWebcam() {
            if (hasInitializedCam) return;
            hasInitializedCam = true;

            const videoEl = document.getElementById(`p${mySeat}-video`);
            const placeholder = document.getElementById(`p${mySeat}-placeholder`);
            const errorOverlay = document.getElementById(`cam-error-${mySeat}`);
            const errorText = document.getElementById(`cam-error-text-${mySeat}`);

            try {
                localStream = await navigator.mediaDevices.getUserMedia({ 
                    video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 60 } }, 
                    audio: true 
                });
                
                videoEl.srcObject = localStream;
                videoEl.muted = true;
                videoEl.autoplay = true;
                videoEl.style.transform = isFlipped[mySeat] ? 'scaleY(-1)' : 'scaleY(1)'; // True Forward!
                
                videoEl.classList.remove('hidden');
                placeholder.classList.add('hidden'); placeholder.classList.remove('flex');
                errorOverlay.classList.add('hidden');
                
                isCamOn = true; isMicOn = true;
                document.getElementById('mic-icon-on').classList.remove('hidden'); document.getElementById('mic-icon-off').classList.add('hidden');
            } catch (err) {
                console.warn("Webcam access restricted:", err.message);
                let userMsg = 'Camera Blocked';
                if (err.name === 'NotAllowedError' || (err.message && err.message.toLowerCase().includes('denied'))) userMsg = 'Permission Denied';
                
                errorText.textContent = userMsg; errorOverlay.classList.remove('hidden');
                addLog('System', `Media notice: ${userMsg}. You can still use the LP calculator!`, 'text-amber-500');
                
                isCamOn = false; isMicOn = false;
                document.getElementById('mic-icon-on').classList.add('hidden'); document.getElementById('mic-icon-off').classList.remove('hidden');
            }
        }

        function toggleMic() {
            if (!localStream) return;
            const audioTracks = localStream.getAudioTracks();
            if (audioTracks.length > 0) {
                isMicOn = !isMicOn;
                audioTracks[0].enabled = isMicOn;
                document.getElementById('mic-icon-on').classList.toggle('hidden', !isMicOn);
                document.getElementById('mic-icon-off').classList.toggle('hidden', isMicOn);
            }
        }

        async function toggleCam() {
            const videoEl = document.getElementById(`p${mySeat}-video`);
            const errorOverlay = document.getElementById(`cam-error-${mySeat}`);
            if (isCamOn) {
                if (localStream) localStream.getVideoTracks().forEach(track => track.stop());
                isCamOn = false;
                document.getElementById('cam-icon-on').classList.add('hidden'); document.getElementById('cam-icon-off').classList.remove('hidden');
                addLog('System', 'Camera disabled.');
            } else {
                try {
                    const newStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 60 } } });
                    const newVideoTrack = newStream.getVideoTracks()[0];
                    if (localStream) {
                        localStream.getVideoTracks().forEach(t => localStream.removeTrack(t));
                        localStream.addTrack(newVideoTrack);
                        Object.values(peerConnections).forEach(pc => {
                            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
                            if (sender) sender.replaceTrack(newVideoTrack);
                        });
                    } else { localStream = newStream; }
                    videoEl.srcObject = null; videoEl.srcObject = localStream;
                    isCamOn = true;
                    document.getElementById('cam-icon-on').classList.remove('hidden'); document.getElementById('cam-icon-off').classList.add('hidden');
                    errorOverlay.classList.add('hidden'); 
                    addLog('System', 'Camera enabled.');
                } catch (err) {
                    let userMsg = 'Failed to restart camera.';
                    document.getElementById(`cam-error-text-${mySeat}`).textContent = userMsg;
                    errorOverlay.classList.remove('hidden');
                    addLog('System', `Media notice: ${userMsg}`, 'text-amber-500');
                }
            }
        }

        function toggleMenu(playerNum) {
            if (playerNum !== mySeat) return; 
            const menu = document.getElementById(`cam-menu-${playerNum}`);
            if (menu.classList.contains('hidden')) {
                for (let i = 1; i <= 6; i++) {
                    const otherMenu = document.getElementById(`cam-menu-${i}`);
                    if (otherMenu) { otherMenu.classList.add('hidden'); otherMenu.classList.remove('flex'); }
                }
                menu.classList.remove('hidden'); menu.classList.add('flex');
            } else { menu.classList.add('hidden'); menu.classList.remove('flex'); }
        }

        document.addEventListener('click', (e) => {
            for (let i = 1; i <= 6; i++) {
                const menu = document.getElementById(`cam-menu-${i}`);
                const btn = document.getElementById(`cam-btn-${i}`);
                if (menu && !menu.classList.contains('hidden')) {
                    if (!menu.contains(e.target) && btn && !btn.contains(e.target)) {
                        menu.classList.add('hidden'); menu.classList.remove('flex');
                    }
                }
            }
        });

        function toggleFlip(playerNum) {
            if (playerNum !== mySeat) return;
            isFlipped[playerNum] = !isFlipped[playerNum];
            const videoEl = document.getElementById(`p${playerNum}-video`);
            if (videoEl) videoEl.style.transform = isFlipped[playerNum] ? 'scaleY(-1)' : 'scaleY(1)';
            if (socket && currentRoomId) socket.emit('flip-camera', currentRoomId, isFlipped[playerNum]);
        }

        function startDrag(e, playerNum) {
            if (playerNum !== mySeat) return; 
            dragState.active = true; dragState.moved = false; dragState.playerNum = playerNum;
            dragState.el = document.getElementById(`p${playerNum}-lp-wrapper`);
            dragState.container = document.getElementById(`p${playerNum}-container`);
            dragState.startX = e.clientX || (e.touches && e.touches[0].clientX);
            dragState.startY = e.clientY || (e.touches && e.touches[0].clientY);
            const rect = dragState.el.getBoundingClientRect();
            const containerRect = dragState.container.getBoundingClientRect();
            dragState.initialLeft = rect.left - containerRect.left; dragState.initialTop = rect.top - containerRect.top;
            dragState.el.style.transition = 'none'; dragState.el.style.zIndex = '50'; 
            dragState.el.style.left = dragState.initialLeft + 'px'; dragState.el.style.top = dragState.initialTop + 'px';
            dragState.el.style.right = 'auto'; dragState.el.style.bottom = 'auto';
            dragState.el.classList.remove('top-1', 'bottom-1', 'left-1', 'right-1');
        }

        function onDrag(e) {
            if (!dragState.active) return;
            const clientX = e.clientX || (e.touches && e.touches[0].clientX) || dragState.startX;
            const clientY = e.clientY || (e.touches && e.touches[0].clientY) || dragState.startY;
            const dx = clientX - dragState.startX; const dy = clientY - dragState.startY;
            if (!dragState.moved && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) dragState.moved = true;
            if (dragState.moved) {
                if (e.cancelable) e.preventDefault();
                dragState.el.style.left = (dragState.initialLeft + dx) + 'px';
                dragState.el.style.top = (dragState.initialTop + dy) + 'px';
            }
        }

        function endDrag(e) {
            if (!dragState.active) return;
            if (!dragState.moved) openCalc(dragState.playerNum);
            snapToCorner(dragState.el, dragState.container);
            dragState.el.style.transition = ''; dragState.el.style.zIndex = '20';
            dragState.active = false; dragState.el = null;
        }

        function snapToCorner(el, container) {
            const elRect = el.getBoundingClientRect(); const cRect = container.getBoundingClientRect();
            const centerX = elRect.left + elRect.width / 2 - cRect.left; const centerY = elRect.top + elRect.height / 2 - cRect.top;
            const isLeft = centerX < cRect.width / 2; const isTop = centerY < cRect.height / 2;
            el.style.left = ''; el.style.top = ''; el.style.right = ''; el.style.bottom = '';
            el.classList.remove('top-1', 'bottom-1', 'left-1', 'right-1');
            if (isTop) el.classList.add('top-1'); else el.classList.add('bottom-1');
            if (isLeft) el.classList.add('left-1'); else el.classList.add('right-1');
        }

        document.addEventListener('pointermove', onDrag, { passive: false });
        document.addEventListener('pointerup', endDrag);
        document.addEventListener('pointercancel', endDrag);

        function openCalc(playerNum) {
            if (playerNum !== mySeat) { addLog('System', `You can only edit your own Life Points!`, 'text-amber-400 font-bold'); return; }
            if (isEliminated[playerNum]) return;
            activeCalcPlayer = playerNum;
            const input = document.getElementById('calc-input');
            input.focus();
        }

        function clearCalc() { const input = document.getElementById('calc-input'); input.value = ''; input.focus(); }
        function calcAction(actionType) {
            if (!activeCalcPlayer) activeCalcPlayer = mySeat || 1;
            const input = document.getElementById('calc-input');
            const val = parseInt(input.value);
            if (isNaN(val) || val < 0) { clearCalc(); return; }
            if (actionType === 'set') setLP(activeCalcPlayer, val);
            else if (actionType === 'dmg') changeLP(activeCalcPlayer, -val);
            else if (actionType === 'heal') changeLP(activeCalcPlayer, val);
            clearCalc();
        }

        document.getElementById('calc-input').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { calcAction('set'); e.preventDefault(); } 
            else if (e.key === '-' || e.key === 'Subtract') { calcAction('dmg'); e.preventDefault(); } 
            else if (e.key === '+' || e.key === 'Add') { calcAction('heal'); e.preventDefault(); }
        });

        function updateLPDisplay(player) {
            const currentLP = lp[player];
            document.getElementById(`p${player}-lp`).textContent = currentLP;
            const bar = document.getElementById(`p${player}-lp-bar`);
            if (bar) {
                const percentage = Math.min((currentLP / 8000) * 100, 100);
                bar.style.width = `${percentage}%`;
                if (currentLP >= 10000) { bar.style.background = 'linear-gradient(90deg, #fcd34d, #f59e0b, #b45309)'; bar.style.boxShadow = '0 0 12px rgba(245, 158, 11, 0.8)'; } 
                else { const hue = Math.max(0, Math.min((currentLP / 8000) * 120, 120)); bar.style.background = `hsl(${hue}, 80%, 50%)`; bar.style.boxShadow = `0 0 8px hsl(${hue}, 80%, 50%)`; }
            }
        }

        function changeLP(player, amount, emit = true) {
            if (isEliminated[player]) return;
            const oldLP = lp[player]; lp[player] = Math.max(0, lp[player] + amount);
            updateLPDisplay(player);
            const action = amount > 0 ? 'gained' : 'lost'; const color = amount > 0 ? 'text-emerald-400' : 'text-red-400';
            const logMsg = `${action} ${Math.abs(amount)} LP. (${oldLP} → ${lp[player]})`;
            
            if (emit) {
                addLog(`P${player}`, logMsg, color);
                if (socket && currentRoomId) socket.emit('update-lp', currentRoomId, { seat: player, lp: lp[player], logMessage: logMsg, color: color });
            }
            if (lp[player] === 0) eliminatePlayerId(player, emit);
        }

        function setLP(player, amount, emit = true) {
            if (isEliminated[player]) return;
            lp[player] = Math.max(0, amount); updateLPDisplay(player);
            const logMsg = `LP set to ${lp[player]}.`;
            if (emit) {
                addLog(`P${player}`, logMsg);
                if (socket && currentRoomId) socket.emit('update-lp', currentRoomId, { seat: player, lp: lp[player], logMessage: logMsg, color: 'text-zinc-300' });
            }
            if (lp[player] === 0) eliminatePlayerId(player, emit);
        }

        function handleDMClick(e, playerNum) {
            if (playerNum !== mySeat) return; 
            e.stopPropagation(); 
            if (e.button === 0) dmCounts[playerNum]++; else if (e.button === 2) dmCounts[playerNum] = Math.max(0, dmCounts[playerNum] - 1); 
            const counterEl = document.getElementById(`p${playerNum}-dm-counter`);
            counterEl.textContent = dmCounts[playerNum];
            counterEl.classList.add('scale-125', 'bg-amber-300'); setTimeout(() => counterEl.classList.remove('scale-125', 'bg-amber-300'), 150);
            if (socket && currentRoomId) socket.emit('update-dm-count', currentRoomId, { seat: playerNum, dmCount: dmCounts[playerNum] });
        }

        function openDMSearch(playerNum) {
            if (playerNum !== mySeat) return;
            targetDMPlayer = playerNum;
            const modal = document.getElementById('dm-modal'); modal.classList.remove('hidden'); modal.classList.add('flex');
            document.getElementById('dm-search-input').value = ''; document.getElementById('dm-search-results').innerHTML = '<div class="text-zinc-600 text-xs italic text-center py-4">Type a card name to search...</div>';
        }

        function randomizeSeats(shuffle = true) {
            if (shuffle) {
                if (mySeat !== 1) { addLog('System', 'Only the Room Host (P1) can shuffle the seats!', 'text-amber-400'); return; }
                for (let i = playerGridPositions.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [playerGridPositions[i], playerGridPositions[j]] = [playerGridPositions[j], playerGridPositions[i]];
                }
                if (socket && currentRoomId) socket.emit('sync-layout', currentRoomId, playerGridPositions);
            }
            let cols = 2; if (totalPlayers === 2) cols = 1; else if (totalPlayers > 4) cols = 3;
            playerGridPositions.forEach((playerNum, index) => {
                const gridItem = document.getElementById(`grid-item-${playerNum}`); if (gridItem) gridItem.style.order = index + 1;
                const lpWrapper = document.getElementById(`p${playerNum}-lp-wrapper`);
                if (lpWrapper) {
                    lpWrapper.style.left = ''; lpWrapper.style.top = ''; lpWrapper.style.right = ''; lpWrapper.style.bottom = '';
                    lpWrapper.classList.remove('top-1', 'bottom-1', 'left-1', 'right-1');
                    const isTopRow = index < cols; const isLeftCol = index % cols === 0; const isRightCol = index % cols === (cols - 1);
                    if (isTopRow) lpWrapper.classList.add('bottom-1'); else lpWrapper.classList.add('top-1');
                    if (isLeftCol) lpWrapper.classList.add('right-1'); else if (isRightCol) lpWrapper.classList.add('left-1'); else lpWrapper.classList.add('left-1'); 
                }
            });
            if (totalPlayers === 2) clockwiseOrder = [playerGridPositions[0], playerGridPositions[1]];
            if (totalPlayers === 3) clockwiseOrder = [playerGridPositions[0], playerGridPositions[1], playerGridPositions[2]];
            if (totalPlayers === 4) clockwiseOrder = [playerGridPositions[0], playerGridPositions[1], playerGridPositions[3], playerGridPositions[2]];
            if (totalPlayers === 5) clockwiseOrder = [playerGridPositions[0], playerGridPositions[1], playerGridPositions[2], playerGridPositions[4], playerGridPositions[3]];
            if (totalPlayers === 6) clockwiseOrder = [playerGridPositions[0], playerGridPositions[1], playerGridPositions[2], playerGridPositions[5], playerGridPositions[4], playerGridPositions[3]];
            if (shuffle) addLog('System', 'Room Host randomized the seating layout!', 'text-indigo-400 italic font-bold');
        }

        function simulateYugiPassLogin() {
            const btn = document.getElementById('yugipass-login-btn'); const originalText = btn.innerHTML;
            btn.innerHTML = '<svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Authenticating...';
            btn.disabled = true;
            setTimeout(() => {
                yugiPassUser = { username: 'YugiMuto_YGOrg', avatar: 'https://images.ygoprodeck.com/images/cards_cropped/89631139.jpg' };
                const nameInput = document.getElementById('setup-name'); nameInput.value = yugiPassUser.username; nameInput.disabled = true; nameInput.classList.add('opacity-50', 'cursor-not-allowed');
                btn.classList.add('hidden'); document.getElementById('yugipass-user-profile').classList.remove('hidden'); document.getElementById('yp-avatar').src = yugiPassUser.avatar; document.getElementById('yp-username').textContent = yugiPassUser.username;
                btn.innerHTML = originalText; btn.disabled = false;
            }, 1000);
        }

        function logoutYugiPass() {
            yugiPassUser = null; const nameInput = document.getElementById('setup-name'); nameInput.value = 'Player'; nameInput.disabled = false; nameInput.classList.remove('opacity-50', 'cursor-not-allowed');
            document.getElementById('yugipass-login-btn').classList.remove('hidden'); document.getElementById('yugipass-user-profile').classList.add('hidden');
        }

        function updateLobbyUI(rooms) {
            const lobbyList = document.getElementById('lobby-room-list');
            if (!lobbyList) return;
            lobbyList.innerHTML = '';
            if (rooms.length === 0) { lobbyList.innerHTML = '<div class="text-zinc-500 italic text-center p-4 mt-10">No public rooms available right now. Host one!</div>'; return; }
            rooms.forEach(room => {
                const roomEl = document.createElement('div');
                roomEl.className = 'room-card border border-zinc-700/80 rounded-lg p-4 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 hover:border-cyan-500/50 transition shadow-lg group';
                roomEl.dataset.format = room.format;
                let formatColor = 'text-zinc-300 bg-zinc-800 border-zinc-700';
                if(room.format === 'Domain') formatColor = 'text-indigo-300 bg-indigo-900/50 border-indigo-700/50'; else if(room.format === 'Advanced') formatColor = 'text-red-300 bg-red-900/50 border-red-700/50';
                roomEl.innerHTML = `
                    <div>
                        <div class="flex items-center gap-2 mb-1.5"><span class="${formatColor} text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider border">${room.format}</span><h3 class="text-zinc-100 font-bold text-lg leading-none group-hover:text-cyan-300 transition">${room.roomName}</h3></div>
                        <div class="text-xs text-zinc-400 flex items-center gap-4 font-mono"><span class="flex items-center gap-1.5 text-zinc-300"><svg class="w-3.5 h-3.5 text-cyan-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg> ${room.currentPlayers}/${room.maxPlayers} Duelists</span>${room.allowSpectators ? `<span class="flex items-center gap-1.5 text-zinc-400"><svg class="w-3.5 h-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg> ${room.spectators} Spectators</span>` : ''}</div>
                    </div>
                    <div class="flex items-center gap-2 w-full lg:w-auto mt-2 lg:mt-0">${room.allowSpectators ? `<button onclick="joinServerRoom('${room.id}', true, this)" class="flex-1 lg:flex-none bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-4 py-2 rounded text-sm font-bold transition border border-zinc-700">Spectate</button>` : ''}<button onclick="joinServerRoom('${room.id}', false, this)" ${room.currentPlayers >= room.maxPlayers ? 'disabled' : ''} class="flex-1 lg:flex-none bg-cyan-700 hover:bg-cyan-600 text-cyan-50 px-4 py-2 rounded text-sm font-bold shadow-[0_0_10px_rgba(6,182,212,0.3)] border border-cyan-500 transition disabled:opacity-50 disabled:cursor-not-allowed">Join Duel</button></div>
                `;
                lobbyList.appendChild(roomEl);
            });
            const activeFilterBtn = document.querySelector('.filter-btn.active'); if(activeFilterBtn) filterLobby(activeFilterBtn.textContent.trim() === 'All Formats' ? 'All' : activeFilterBtn.textContent.trim());
        }

        function filterLobby(format) {
            const buttons = document.querySelectorAll('.filter-btn');
            buttons.forEach(btn => {
                if (btn.textContent.trim() === format || (format === 'All' && btn.textContent.trim() === 'All Formats')) { btn.classList.remove('bg-zinc-900', 'border-zinc-800', 'text-zinc-500'); btn.classList.add('active', 'bg-zinc-800', 'border-cyan-500', 'text-cyan-300', 'shadow-[0_0_10px_rgba(6,182,212,0.3)]'); } 
                else { btn.classList.remove('active', 'bg-zinc-800', 'border-cyan-500', 'text-cyan-300', 'shadow-[0_0_10px_rgba(6,182,212,0.3)]'); btn.classList.add('bg-zinc-900', 'border-zinc-800', 'text-zinc-500'); }
            });
            const rooms = document.querySelectorAll('.room-card');
            rooms.forEach(room => {
                if (format === 'All' || room.dataset.format === format) { room.classList.remove('hidden'); room.classList.add('flex'); } 
                else { room.classList.add('hidden'); room.classList.remove('flex'); }
            });
        }

        function addLog(actor, message, colorClass = 'text-zinc-300') {
            const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' });
            const entry = document.createElement('div'); entry.className = `p-2 rounded bg-zinc-950/50 border border-zinc-800/50 ${colorClass}`;
            if(logEl.children.length === 1 && logEl.children[0].classList.contains('italic')) logEl.innerHTML = '';
            let prefix = '';
            if (actor === 'P1') prefix = '<span class="text-blue-400 font-bold drop-shadow-[0_0_5px_rgba(96,165,250,0.8)]">[P1]</span> ';
            else if (actor === 'P2') prefix = '<span class="text-red-500 font-bold drop-shadow-[0_0_5px_rgba(239,68,68,0.8)]">[P2]</span> ';
            else if (actor === 'P3') prefix = '<span class="text-yellow-400 font-bold drop-shadow-[0_0_5px_rgba(250,204,21,0.8)]">[P3]</span> ';
            else if (actor === 'P4') prefix = '<span class="text-purple-400 font-bold drop-shadow-[0_0_5px_rgba(192,132,252,0.8)]">[P4]</span> ';
            else if (actor === 'P5') prefix = '<span class="text-orange-500 font-bold drop-shadow-[0_0_5px_rgba(249,115,22,0.8)]">[P5]</span> ';
            else if (actor === 'P6') prefix = '<span class="text-pink-500 font-bold drop-shadow-[0_0_5px_rgba(236,72,153,0.8)]">[P6]</span> ';
            else if (actor === 'System') prefix = '<span class="text-zinc-400 font-bold">[SYS]</span> ';
            entry.innerHTML = `<span class="text-zinc-600 text-[10px] mr-1">${time}</span> ${prefix}${message}`;
            logEl.appendChild(entry); logEl.scrollTop = logEl.scrollHeight;
        }
        function clearLog(e) { if (e) e.stopPropagation(); logEl.innerHTML = '<div class="text-zinc-500 italic">Log cleared.</div>'; }
        let isLogCollapsed = true;
        function toggleLog() {
            isLogCollapsed = !isLogCollapsed;
            const panel = document.getElementById('log-panel'); const logContent = document.getElementById('duel-log'); const chevron = document.getElementById('log-chevron'); const chatInput = document.getElementById('chat-input-container');
            if (isLogCollapsed) { logContent.classList.add('hidden'); logContent.classList.remove('flex'); chatInput.classList.add('hidden'); chatInput.classList.remove('flex'); panel.classList.remove('flex-1', 'min-h-0'); chevron.style.transform = 'rotate(-90deg)'; } 
            else { logContent.classList.remove('hidden'); logContent.classList.add('flex'); chatInput.classList.remove('hidden'); chatInput.classList.add('flex'); panel.classList.add('flex-1', 'min-h-0'); chevron.style.transform = 'rotate(0deg)'; logContent.scrollTop = logContent.scrollHeight; }
        }

        function showEffect(playerNum, type, result) {
            const wrapper = document.getElementById(`p${playerNum}-lp-wrapper`); if (!wrapper) return;
            const isTop = wrapper.classList.contains('top-1'); const isRight = wrapper.classList.contains('right-1');
            let effectsContainer = document.getElementById(`effects-container-${playerNum}`);
            if (!effectsContainer) { effectsContainer = document.createElement('div'); effectsContainer.id = `effects-container-${playerNum}`; wrapper.appendChild(effectsContainer); }
            effectsContainer.className = `absolute z-50 flex gap-3 items-center pointer-events-none w-max transition-all duration-300`;
            if (isTop) { effectsContainer.style.top = '100%'; effectsContainer.style.bottom = 'auto'; effectsContainer.style.marginTop = '1rem'; effectsContainer.style.marginBottom = '0'; } 
            else { effectsContainer.style.bottom = '100%'; effectsContainer.style.top = 'auto'; effectsContainer.style.marginBottom = '1rem'; effectsContainer.style.marginTop = '0'; }
            if (isRight) { effectsContainer.style.right = '0'; effectsContainer.style.left = 'auto'; effectsContainer.style.flexDirection = 'row-reverse'; } 
            else { effectsContainer.style.left = '0'; effectsContainer.style.right = 'auto'; effectsContainer.style.flexDirection = 'row'; }

            const itemWrapper = document.createElement('div'); itemWrapper.className = `transition-opacity duration-500 shrink-0`;
            const spanId = `effect-res-${Date.now()}-${Math.floor(Math.random() * 1000)}`; const el = document.createElement('div'); el.className = 'animate-toss flex items-center justify-center font-display leading-none ';

            if (type === 'coin') el.className += 'w-16 h-16 rounded-full bg-gradient-to-tr from-amber-600 via-yellow-400 to-amber-200 border-4 border-amber-700 shadow-[0_0_20px_rgba(251,191,36,0.8)] text-amber-900 text-5xl font-bold tracking-tighter';
            else el.className += 'w-16 h-16 rounded-xl bg-gradient-to-br from-white to-zinc-200 border-2 border-zinc-400 shadow-[0_0_20px_rgba(255,255,255,0.8)] text-zinc-900 text-6xl font-bold tracking-tighter';
            el.innerHTML = `<span class="opacity-0 transition-opacity duration-200 drop-shadow-sm mt-2" id="${spanId}">${result}</span>`;

            itemWrapper.appendChild(el); effectsContainer.appendChild(itemWrapper);
            setTimeout(() => { const resSpan = document.getElementById(spanId); if (resSpan) resSpan.classList.remove('opacity-0'); }, 1200);
            setTimeout(() => { itemWrapper.style.opacity = '0'; itemWrapper.dataset.faded = 'true'; setTimeout(() => { if (effectsContainer.parentElement) { const allFaded = Array.from(effectsContainer.children).every(child => child.dataset.faded === 'true'); if (allFaded) effectsContainer.parentElement.removeChild(effectsContainer); } }, 500); }, 3500);
        }

        function rollDice() {
            const result = Math.floor(Math.random() * 6) + 1; const p = mySeat || 1;
            addLog(`P${p}`, `rolled a 6-sided die: <span class="font-bold text-indigo-400 text-lg ml-1">${result}</span>`, 'text-indigo-200');
            showEffect(p, 'dice', result);
            if (socket && currentRoomId) socket.emit('dice-roll', currentRoomId, { seat: p, result: result });
        }

        function flipCoin() {
            const isHeads = Math.random() >= 0.5; const resultText = isHeads ? 'HEADS' : 'TAILS'; const color = isHeads ? 'text-amber-400' : 'text-zinc-400'; const p = mySeat || 1;
            addLog(`P${p}`, `flipped a coin: <span class="font-bold ${color} text-lg ml-1">${resultText}</span>`, 'text-amber-100');
            showEffect(p, 'coin', isHeads ? 'H' : 'T');
            if (socket && currentRoomId) socket.emit('coin-flip', currentRoomId, { seat: p, isHeads: isHeads, resultText: resultText });
        }

        let searchTimeout; let cardHistory = []; let searchSelectedIndex = -1;
        async function searchCard(query) {
            clearTimeout(searchTimeout); const resultsBox = document.getElementById('search-results');
            if (!query || query.length < 3) { resultsBox.classList.add('hidden'); searchSelectedIndex = -1; return; }
            searchTimeout = setTimeout(async () => {
                try {
                    const res = await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(query)}&num=10&offset=0`);
                    if (!res.ok) throw new Error('No cards found'); const data = await res.json();
                    resultsBox.innerHTML = ''; searchSelectedIndex = -1;
                    data.data.slice(0, 8).forEach(card => {
                        const div = document.createElement('div'); div.className = 'search-item p-2 hover:bg-zinc-700 cursor-pointer text-xs text-zinc-200 border-b border-zinc-700/50 last:border-0 truncate font-semibold';
                        div.textContent = card.name; div.onclick = () => selectCard(card); resultsBox.appendChild(div);
                    });
                    resultsBox.classList.remove('hidden');
                } catch (err) { resultsBox.innerHTML = '<div class="p-2 text-xs text-zinc-500 italic">No matches found...</div>'; resultsBox.classList.remove('hidden'); searchSelectedIndex = -1; }
            }, 500); 
        }

        function handleSearchKey(e) {
            const resultsBox = document.getElementById('search-results'); if (resultsBox.classList.contains('hidden')) return;
            const items = resultsBox.getElementsByClassName('search-item'); if (items.length === 0) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); searchSelectedIndex++; if (searchSelectedIndex >= items.length) searchSelectedIndex = 0; updateSearchSelection(items); } 
            else if (e.key === 'ArrowUp') { e.preventDefault(); searchSelectedIndex--; if (searchSelectedIndex < 0) searchSelectedIndex = items.length - 1; updateSearchSelection(items); } 
            else if (e.key === 'Enter') { e.preventDefault(); if (searchSelectedIndex >= 0 && searchSelectedIndex < items.length) { items[searchSelectedIndex].click(); } else if (items.length > 0) { items[0].click(); } }
        }

        function updateSearchSelection(items) {
            for (let i = 0; i < items.length; i++) {
                if (i === searchSelectedIndex) { items[i].classList.add('bg-zinc-700'); items[i].scrollIntoView({ block: 'nearest' }); } else { items[i].classList.remove('bg-zinc-700'); }
            }
        }

        function selectCard(card) {
            document.getElementById('search-results').classList.add('hidden'); document.getElementById('card-search').value = ''; document.getElementById('preview-placeholder').classList.add('hidden');
            const previewContainer = document.getElementById('card-preview'); previewContainer.classList.remove('hidden'); previewContainer.classList.add('flex');
            document.getElementById('preview-img').src = card.card_images[0].image_url; document.getElementById('preview-name').textContent = card.name;
            const statsEl = document.getElementById('preview-stats'); statsEl.innerHTML = ''; statsEl.classList.remove('hidden');
            
            if (card.type && card.type.includes("Monster")) {
                let levelStr = ""; if (card.type.includes("XYZ")) levelStr = `Rank ${card.level}`; else if (card.type.includes("Link")) levelStr = `Link-${card.linkval}`; else if (card.level !== undefined) levelStr = `Level ${card.level}`;
                let atkDefStr = `ATK ${card.atk !== undefined ? card.atk : '?'}`; if (card.def !== undefined) atkDefStr += ` / DEF ${card.def}`;
                statsEl.innerHTML = `${card.attribute ? `<span class="bg-zinc-800 px-1 rounded border border-zinc-700">${card.attribute}</span>` : ''}${levelStr ? `<span class="bg-zinc-800 px-1 rounded border border-zinc-700">${levelStr}</span>` : ''}<span class="bg-zinc-800 px-1 rounded border border-zinc-700">${card.race} / ${card.type.replace(' Monster', '')}</span><span class="bg-zinc-800 px-1 rounded border border-zinc-700 font-bold text-amber-200">${atkDefStr}</span>`;
            } else if (card.type && (card.type.includes("Spell") || card.type.includes("Trap"))) {
                statsEl.innerHTML = `<span class="bg-zinc-800 px-1 rounded border border-zinc-700">${card.type}</span><span class="bg-zinc-800 px-1 rounded border border-zinc-700">${card.race}</span>`;
            } else { statsEl.classList.add('hidden'); }

            document.getElementById('preview-desc').textContent = card.desc;
            if (cardHistory.length === 0 || cardHistory[0].id !== card.id) {
                let pColor = 'text-cyan-300'; if(mySeat === 2) pColor = 'text-red-400'; if(mySeat === 3) pColor = 'text-yellow-300'; if(mySeat === 4) pColor = 'text-purple-300';
                addLog('System', `Viewed card: <span class="font-bold ${pColor}">${card.name}</span>`);
            }
            updateCardHistory(card);
        }

        function updateCardHistory(card) { cardHistory = cardHistory.filter(c => c.id !== card.id); cardHistory.unshift(card); if (cardHistory.length > 20) cardHistory.pop(); renderCardHistory(); }
        function renderCardHistory() {
            const list = document.getElementById('card-history-list'); const emptyState = document.getElementById('empty-history');
            if (cardHistory.length > 0) { emptyState.classList.add('hidden'); list.classList.remove('hidden'); } else { emptyState.classList.remove('hidden'); list.classList.add('hidden'); }
            list.innerHTML = '';
            cardHistory.forEach(c => {
                const li = document.createElement('li'); li.className = 'hover:bg-zinc-800/60 group transition cursor-pointer rounded flex items-center gap-2 p-1'; li.onclick = () => selectCard(c);
                const bullet = document.createElement('span'); bullet.className = 'text-zinc-600 text-[8px] shrink-0'; bullet.innerHTML = '&#9679;';
                const img = document.createElement('img'); img.src = `https://images.ygoprodeck.com/images/cards_cropped/${c.id}.jpg`; img.onerror = function() { this.src = c.card_images[0].image_url_small; }; img.className = 'w-9 h-9 rounded-sm object-cover shrink-0 border border-zinc-700 bg-zinc-950';
                const span = document.createElement('span'); span.className = 'truncate text-[16px] flex-1 group-hover:text-cyan-400 transition'; span.textContent = c.name;
                li.appendChild(bullet); li.appendChild(img); li.appendChild(span); list.appendChild(li);
            });
        }

        document.addEventListener('click', (e) => {
            const searchContainer = document.getElementById('search-results'); const searchInput = document.getElementById('card-search');
            if (searchContainer && !searchContainer.contains(e.target) && e.target !== searchInput) searchContainer.classList.add('hidden');
        });

        let dmSearchTimeout; let dmSelectedIndex = -1; let targetDMPlayer = null;
        async function searchDMCard(query) {
            clearTimeout(dmSearchTimeout); const resultsBox = document.getElementById('dm-search-results');
            if (!query || query.length < 3) { resultsBox.innerHTML = '<div class="text-zinc-600 text-xs italic text-center py-4">Type a card name to search...</div>'; dmSelectedIndex = -1; return; }
            dmSearchTimeout = setTimeout(async () => {
                try {
                    const res = await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(query)}&num=15&offset=0`);
                    if (!res.ok) throw new Error('No cards found'); const data = await res.json();
                    const monsters = data.data.filter(c => c.type && c.type.includes("Monster"));
                    resultsBox.innerHTML = ''; dmSelectedIndex = -1;
                    if(monsters.length === 0) { resultsBox.innerHTML = '<div class="p-2 text-xs text-zinc-500 italic">No monsters found...</div>'; return; }
                    monsters.slice(0, 10).forEach(card => {
                        const div = document.createElement('div'); div.className = 'dm-search-item flex items-center gap-2 p-2 hover:bg-zinc-800 cursor-pointer rounded transition border border-transparent'; div.onclick = () => selectDMCard(card);
                        const img = document.createElement('img'); img.src = `https://images.ygoprodeck.com/images/cards_cropped/${card.id}.jpg`; img.onerror = function() { this.src = card.card_images[0].image_url_small; }; img.className = 'w-8 h-8 rounded-full object-cover shrink-0 border border-zinc-700 bg-zinc-950';
                        const nameSpan = document.createElement('span'); nameSpan.className = 'text-sm text-zinc-200 font-semibold truncate'; nameSpan.textContent = card.name;
                        div.appendChild(img); div.appendChild(nameSpan); resultsBox.appendChild(div);
                    });
                } catch (err) { resultsBox.innerHTML = '<div class="p-2 text-xs text-zinc-500 italic">No matches found...</div>'; dmSelectedIndex = -1; }
            }, 400);
        }

        function handleDMSearchKey(e) {
            const resultsBox = document.getElementById('dm-search-results'); const items = resultsBox.getElementsByClassName('dm-search-item'); if (items.length === 0) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); dmSelectedIndex++; if (dmSelectedIndex >= items.length) dmSelectedIndex = 0; updateDMSearchSelection(items); } 
            else if (e.key === 'ArrowUp') { e.preventDefault(); dmSelectedIndex--; if (dmSelectedIndex < 0) dmSelectedIndex = items.length - 1; updateDMSearchSelection(items); } 
            else if (e.key === 'Enter') { e.preventDefault(); if (dmSelectedIndex >= 0 && dmSelectedIndex < items.length) { items[dmSelectedIndex].click(); } else if (items.length > 0) { items[0].click(); } }
        }

        function updateDMSearchSelection(items) {
            for (let i = 0; i < items.length; i++) {
                if (i === dmSelectedIndex) { items[i].classList.add('bg-zinc-800', 'border-amber-500/50'); items[i].classList.remove('border-transparent'); items[i].scrollIntoView({ block: 'nearest' }); } 
                else { items[i].classList.remove('bg-zinc-800', 'border-amber-500/50'); items[i].classList.add('border-transparent'); }
            }
        }

        function closeDMSearch() {
            const modal = document.getElementById('dm-modal');
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            targetDMPlayer = null;
        }

        function selectDMCard(card) {
            if(!targetDMPlayer) return;
            
            // 1. Update the local UI instantly
            const imgEl = document.getElementById(`p${targetDMPlayer}-dm-img`);
            const containerEl = document.getElementById(`p${targetDMPlayer}-dm-container`);
            
            if (imgEl && containerEl) {
                imgEl.src = `https://images.ygoprodeck.com/images/cards_cropped/${card.id}.jpg`;
                imgEl.onerror = function() { this.src = card.card_images[0].image_url_small; };
                containerEl.classList.remove('hidden');
                
                dmCounts[targetDMPlayer] = 0;
                document.getElementById(`p${targetDMPlayer}-dm-counter`).textContent = '0';
                
                let pColor = 'text-blue-400';
                if(targetDMPlayer === 2) pColor = 'text-red-500';
                if(targetDMPlayer === 3) pColor = 'text-yellow-400';
                if(targetDMPlayer === 4) pColor = 'text-purple-400';
                if(targetDMPlayer === 5) pColor = 'text-orange-500';
                if(targetDMPlayer === 6) pColor = 'text-pink-500';

                addLog(`P${targetDMPlayer}`, `set <span class="font-bold ${pColor} drop-shadow-sm">${card.name}</span> as their Deck Master!`, 'text-amber-200');
            }

            // 2. Tell the server to broadcast this to everyone else
            if (socket && currentRoomId) socket.emit('set-dm-card', currentRoomId, { seat: targetDMPlayer, card: card });
            
            // 3. Close the modal
            closeDMSearch();
        }

        let timerInterval = null; let duelStartTime = null; let duelActive = false; let isRouletteSpinning = false; let activePlayerTurn = null; let clockwiseOrder = [1, 2, 4, 3]; let playerGridPositions = [1, 2, 3, 4];
        function startDuelTimer() {
            if (duelActive || isRouletteSpinning) return;
            isRouletteSpinning = true;
            for (let i = 1; i <= totalPlayers; i++) {
                isEliminated[i] = false; lp[i] = 8000; updateLPDisplay(i);
                const wrapper = document.getElementById(`p${i}-lp-wrapper`);
                if(wrapper) {
                    const innerBox = wrapper.firstElementChild;
                    innerBox.classList.add('bg-zinc-900/[0.35]', 'hover:bg-zinc-900/50', 'border-zinc-700/50');
                    innerBox.classList.remove('bg-zinc-900/85', 'hover:bg-zinc-800', 'bg-red-950/90', 'bg-red-950/70', 'border-red-600', 'shadow-[0_0_15px_rgba(220,38,38,0.5)]', 'ring-2', 'ring-amber-400', 'ring-offset-2', 'ring-offset-black', 'shadow-[0_0_20px_rgba(251,191,36,0.6)]');
                    const lpText = document.getElementById(`p${i}-lp`);
                }
            }
            const btn = document.getElementById('start-duel-btn'); btn.classList.add('hidden'); btn.textContent = 'DUEL!';
            const timerEl = document.getElementById('duel-timer'); timerEl.classList.remove('text-zinc-400', 'text-amber-400', 'animate-pulse'); timerEl.classList.add('text-cyan-400'); timerEl.textContent = '00:00:00';
            addLog('System', 'Selecting who goes first...', 'text-amber-300 italic');
            let ticks = 0; const maxTicks = 10 + Math.floor(Math.random() * 10); let currentIndex = 0;
            const rouletteInterval = setInterval(() => {
                for(let i = 1; i <= totalPlayers; i++) { const w = document.getElementById(`p${i}-lp-wrapper`); if(w) w.firstElementChild.classList.remove('ring-2', 'ring-amber-400', 'ring-offset-2', 'ring-offset-black', 'shadow-[0_0_20px_rgba(251,191,36,0.6)]'); }
                const p = clockwiseOrder[currentIndex]; const innerBox = document.getElementById(`p${p}-lp-wrapper`).firstElementChild; innerBox.classList.add('ring-2', 'ring-amber-400', 'ring-offset-2', 'ring-offset-black', 'shadow-[0_0_20px_rgba(251,191,36,0.6)]');
                ticks++;
                if (ticks >= maxTicks) { clearInterval(rouletteInterval); isRouletteSpinning = false; duelActive = true; duelStartTime = Date.now(); activePlayerTurn = p; timerInterval = setInterval(updateTimer, 1000); addLog('System', `DUEL STARTED! P${p} goes first!`, 'text-cyan-400 text-lg uppercase font-bold'); } else { currentIndex = (currentIndex + 1) % totalPlayers; }
            }, 100);
        }
        function updateTimer() {
            if (!duelActive) return; const elapsed = Math.floor((Date.now() - duelStartTime) / 1000); const h = Math.floor(elapsed / 3600).toString().padStart(2, '0'); const m = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0'); const s = (elapsed % 60).toString().padStart(2, '0'); document.getElementById('duel-timer').textContent = `${h}:${m}:${s}`;
        }
        function stopDuelTimer() {
            if (!duelActive) return; duelActive = false; clearInterval(timerInterval);
            const timerEl = document.getElementById('duel-timer'); timerEl.classList.remove('text-cyan-400'); timerEl.classList.add('text-amber-400', 'animate-pulse');
            const btn = document.getElementById('start-duel-btn'); btn.classList.remove('hidden'); btn.textContent = 'NEW DUEL!';
            if (activePlayerTurn) { const innerBox = document.getElementById(`p${activePlayerTurn}-lp-wrapper`).firstElementChild; innerBox.classList.remove('ring-2', 'ring-amber-400', 'ring-offset-2', 'ring-offset-black', 'shadow-[0_0_20px_rgba(251,191,36,0.6)]'); activePlayerTurn = null; }
        }
        function checkWinCondition() {
            if (!duelActive) return; let activeCount = 0; let winner = null;
            for (let i = 1; i <= totalPlayers; i++) { if (!isEliminated[i]) { activeCount++; winner = i; } }
            if (activeCount <= 1) { stopDuelTimer(); if (activeCount === 1) addLog('System', `DUEL CONCLUDED! P${winner} WINS!`, 'text-amber-400 font-bold text-xl uppercase'); else addLog('System', 'DUEL CONCLUDED! DRAW!', 'text-amber-400 font-bold text-xl uppercase'); }
        }
        function passTurn(forcePassFrom = null) {
            let currentPlayer = forcePassFrom || activePlayerTurn; if (!currentPlayer) return;
            let currentIndex = clockwiseOrder.indexOf(currentPlayer); let nextPlayer = null;
            for (let i = 1; i <= totalPlayers - 1; i++) { let checkIndex = (currentIndex + i) % totalPlayers; let checkPlayer = clockwiseOrder[checkIndex]; if (!isEliminated[checkPlayer]) { nextPlayer = checkPlayer; break; } }
            if (!forcePassFrom && activePlayerTurn) { const oldBox = document.getElementById(`p${activePlayerTurn}-lp-wrapper`).firstElementChild; oldBox.classList.remove('ring-2', 'ring-amber-400', 'ring-offset-2', 'ring-offset-black', 'shadow-[0_0_20px_rgba(251,191,36,0.6)]'); }
            if (nextPlayer) { activePlayerTurn = nextPlayer; const newBox = document.getElementById(`p${activePlayerTurn}-lp-wrapper`).firstElementChild; newBox.classList.add('ring-2', 'ring-amber-400', 'ring-offset-2', 'ring-offset-black', 'shadow-[0_0_20px_rgba(251,191,36,0.6)]'); addLog('System', `Turn passed to P${activePlayerTurn}`, 'text-amber-200'); } else { activePlayerTurn = null; }
        }
        function eliminatePlayerId(playerNum, emit = true) {
            if (isEliminated[playerNum]) return;
            isEliminated[playerNum] = true; lp[playerNum] = 0; updateLPDisplay(playerNum);
            const wrapper = document.getElementById(`p${playerNum}-lp-wrapper`);
            const innerBox = wrapper.firstElementChild;
            innerBox.classList.remove('bg-zinc-900/85', 'bg-zinc-900/50', 'bg-zinc-900/[0.35]', 'hover:bg-zinc-800', 'hover:bg-zinc-900/70', 'hover:bg-zinc-900/50', 'border-zinc-700/50', 'ring-2', 'ring-amber-400', 'ring-offset-2', 'ring-offset-black', 'shadow-[0_0_20px_rgba(251,191,36,0.6)]');
            innerBox.classList.add('bg-red-950/70', 'border-red-600', 'shadow-[0_0_15px_rgba(220,38,38,0.5)]');
            const lpText = document.getElementById(`p${playerNum}-lp`);
            lpText.className = 'font-display text-5xl leading-none tracking-wider drop-shadow-md line-through text-red-600 opacity-70';
        }
        function eliminateActivePlayer() { if (!activeCalcPlayer) return; eliminatePlayerId(activeCalcPlayer); clearCalc(); }

        document.addEventListener('keydown', function(e) {
            if (e.code === 'Space' && duelActive && !isRouletteSpinning) {
                if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;
                e.preventDefault(); passTurn();
            }
        });
        
        function handleChatKey(e) { if (e.key === 'Enter') sendChat(); }
        function sendChat() {
            const input = document.getElementById('chat-input'); const msg = input.value.trim(); if (!msg) return;
            const escapedMsg = msg.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            addLog(`P${mySeat || 1}`, escapedMsg, 'text-zinc-100 font-sans'); 
            if (socket && currentRoomId) socket.emit('send-chat', currentRoomId, { seat: mySeat || 1, msg: escapedMsg });
            input.value = ''; input.focus();
        }
    </script>
