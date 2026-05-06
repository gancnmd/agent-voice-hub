/* ═══════════════════════════════════════════════════
   AgentVoiceHub — Frontend Application
   ═══════════════════════════════════════════════════ */

(() => {
    'use strict';

    // ── Configuration ──────────────────────────────
    const DEFAULT_CONFIG = {
        wsUrl: 'ws://localhost:8765/ws',
        voice: '',
        voiceRate: 1.0,
        voicePitch: 1.0,
        language: 'en-US',
        autoSpeak: true,
        continuousListening: false,
        particleEffects: true,
        soundEffects: true,
        selectedAgent: 'openclaw',
    };

    // ── State ──────────────────────────────────────
    let config = { ...DEFAULT_CONFIG };
    let ws = null;
    let recognition = null;
    let isRecording = false;
    let isSpeaking = false;
    let reconnectAttempts = 0;
    let reconnectTimer = null;
    let messages = [];
    let latencyStart = 0;
    let audioContext = null;
    let analyser = null;
    let mediaStream = null;
    let animationFrameId = null;

    // ── DOM Elements ───────────────────────────────
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const els = {
        particleCanvas: $('#particleCanvas'),
        chatMessages: $('#chatMessages'),
        chatArea: $('#chatArea'),
        welcomeScreen: $('#welcomeScreen'),
        textInput: $('#textInput'),
        sendBtn: $('#sendBtn'),
        micBtn: $('#micBtn'),
        voiceSelect: $('#voiceSelect'),
        statusIndicator: $('#statusIndicator'),
        statusText: $('.status-text'),
        settingsBtn: $('#settingsBtn'),
        settingsPanel: $('#settingsPanel'),
        settingsOverlay: $('#settingsOverlay'),
        settingsCloseBtn: $('#settingsCloseBtn'),
        voiceVizContainer: $('#voiceVizContainer'),
        voiceVizCanvas: $('#voiceVizCanvas'),
        latencyValue: $('#latencyValue'),
        toastContainer: $('#toastContainer'),
        // Settings fields
        wsUrl: $('#wsUrl'),
        settingsVoice: $('#settingsVoice'),
        voiceRate: $('#voiceRate'),
        voiceRateValue: $('#voiceRateValue'),
        voicePitch: $('#voicePitch'),
        voicePitchValue: $('#voicePitchValue'),
        autoSpeak: $('#autoSpeak'),
        recognitionLang: $('#recognitionLang'),
        continuousListening: $('#continuousListening'),
        particleEffects: $('#particleEffects'),
        soundEffects: $('#soundEffects'),
        clearChatBtn: $('#clearChatBtn'),
        exportChatBtn: $('#exportChatBtn'),
    };

    // ── Utilities ──────────────────────────────────
    function formatTime(date) {
        return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Simple markdown-like formatting
    function formatMessage(text) {
        let html = escapeHtml(text);
        // Code blocks
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        // Bold
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        // Italic
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        // Links
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:var(--accent)">$1</a>');
        // Line breaks
        html = html.replace(/\n/g, '<br>');
        return html;
    }

    // ── Toast Notifications ────────────────────────
    function showToast(message, type = 'info', duration = 3000) {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `<span>${escapeHtml(message)}</span>`;
        els.toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('removing');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    // ── Settings Management ────────────────────────
    function loadSettings() {
        try {
            const saved = localStorage.getItem('agentvoicehub_config');
            if (saved) {
                config = { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
            }
        } catch (e) {
            console.warn('Failed to load settings:', e);
        }
        applySettings();
    }

    function saveSettings() {
        try {
            localStorage.setItem('agentvoicehub_config', JSON.stringify(config));
        } catch (e) {
            console.warn('Failed to save settings:', e);
        }
    }

    function applySettings() {
        // Sync UI with config
        els.wsUrl.value = config.wsUrl;
        els.voiceRate.value = config.voiceRate;
        els.voiceRateValue.textContent = config.voiceRate.toFixed(1) + 'x';
        els.voicePitch.value = config.voicePitch;
        els.voicePitchValue.textContent = config.voicePitch.toFixed(1);
        els.autoSpeak.checked = config.autoSpeak;
        els.recognitionLang.value = config.language;
        els.continuousListening.checked = config.continuousListening;
        els.particleEffects.checked = config.particleEffects;
        els.soundEffects.checked = config.soundEffects;

        // Agent selector
        $$('.agent-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.agent === config.selectedAgent);
        });
    }

    function bindSettings() {
        els.wsUrl.addEventListener('change', () => {
            config.wsUrl = els.wsUrl.value.trim();
            saveSettings();
            connectWebSocket();
        });

        els.voiceRate.addEventListener('input', () => {
            config.voiceRate = parseFloat(els.voiceRate.value);
            els.voiceRateValue.textContent = config.voiceRate.toFixed(1) + 'x';
            saveSettings();
        });

        els.voicePitch.addEventListener('input', () => {
            config.voicePitch = parseFloat(els.voicePitch.value);
            els.voicePitchValue.textContent = config.voicePitch.toFixed(1);
            saveSettings();
        });

        els.autoSpeak.addEventListener('change', () => {
            config.autoSpeak = els.autoSpeak.checked;
            saveSettings();
        });

        els.recognitionLang.addEventListener('change', () => {
            config.language = els.recognitionLang.value;
            saveSettings();
            initSpeechRecognition();
        });

        els.continuousListening.addEventListener('change', () => {
            config.continuousListening = els.continuousListening.checked;
            saveSettings();
        });

        els.particleEffects.addEventListener('change', () => {
            config.particleEffects = els.particleEffects.checked;
            saveSettings();
        });

        els.soundEffects.addEventListener('change', () => {
            config.soundEffects = els.soundEffects.checked;
            saveSettings();
        });

        els.clearChatBtn.addEventListener('click', () => {
            messages = [];
            els.chatMessages.innerHTML = '';
            els.chatMessages.appendChild(els.welcomeScreen);
            els.welcomeScreen.classList.remove('hidden');
            localStorage.removeItem('agentvoicehub_messages');
            showToast('Chat history cleared', 'success');
        });

        els.exportChatBtn.addEventListener('click', () => {
            const text = messages.map(m =>
                `[${formatTime(m.timestamp)}] ${m.role}: ${m.content}`
            ).join('\n\n');
            const blob = new Blob([text], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `agentvoicehub-chat-${new Date().toISOString().slice(0, 10)}.txt`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('Chat exported', 'success');
        });
    }

    // ── Settings Panel Toggle ──────────────────────
    function openSettings() {
        els.settingsPanel.classList.add('open');
        els.settingsOverlay.classList.add('open');
    }

    function closeSettings() {
        els.settingsPanel.classList.remove('open');
        els.settingsOverlay.classList.remove('open');
    }

    // ── WebSocket ──────────────────────────────────
    function connectWebSocket() {
        if (ws) {
            ws.close();
            ws = null;
        }

        updateStatus('connecting');

        try {
            ws = new WebSocket(config.wsUrl);
        } catch (e) {
            updateStatus('disconnected');
            scheduleReconnect();
            return;
        }

        ws.onopen = () => {
            reconnectAttempts = 0;
            updateStatus('connected');
            showToast('Connected to server', 'success');
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleServerMessage(data);
            } catch (e) {
                console.warn('Invalid message:', event.data);
            }
        };

        ws.onerror = (e) => {
            console.error('WebSocket error:', e);
        };

        ws.onclose = (event) => {
            ws = null;
            updateStatus('disconnected');
            if (!event.wasClean) {
                scheduleReconnect();
            }
        };
    }

    function scheduleReconnect() {
        if (reconnectTimer) return;
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 30000);
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connectWebSocket();
        }, delay);
    }

    function sendMessage(payload) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            showToast('Not connected to server', 'error');
            return false;
        }
        latencyStart = performance.now();
        ws.send(JSON.stringify(payload));
        return true;
    }

    function updateStatus(state) {
        els.statusIndicator.className = 'status-indicator ' + state;
        const labels = {
            connecting: 'Connecting...',
            connected: 'Connected',
            disconnected: 'Disconnected',
        };
        els.statusText.textContent = labels[state] || state;
    }

    // ── Server Message Handler ─────────────────────
    function handleServerMessage(data) {
        switch (data.type) {
            case 'response':
            case 'message':
                removeTypingIndicator();
                const latency = Math.round(performance.now() - latencyStart);
                if (latencyStart > 0 && latency < 30000) {
                    els.latencyValue.textContent = latency + 'ms';
                }
                addMessage('assistant', data.content || data.text || data.message || '');
                if (config.autoSpeak && (data.content || data.text || data.message)) {
                    speak(data.content || data.text || data.message);
                }
                break;

            case 'audio':
                playAudioData(data.audio || data.data);
                break;

            case 'error':
                removeTypingIndicator();
                showToast(data.message || 'Server error', 'error');
                addMessage('system', '⚠ Error: ' + (data.message || 'Unknown error'));
                break;

            case 'status':
                if (data.message) {
                    showToast(data.message, 'info');
                }
                break;

            case 'transcript':
                // Partial transcription from server
                if (data.text) {
                    els.textInput.value = data.text;
                }
                break;

            default:
                console.log('Unknown message type:', data.type, data);
        }
    }

    // ── Chat Messages ──────────────────────────────
    function addMessage(role, content) {
        if (!content.trim()) return;

        // Hide welcome screen
        if (els.welcomeScreen) {
            els.welcomeScreen.classList.add('hidden');
        }

        const msg = {
            id: generateId(),
            role,
            content,
            timestamp: Date.now(),
        };
        messages.push(msg);
        saveMessages();

        const div = document.createElement('div');
        div.className = `message ${role}`;
        div.dataset.id = msg.id;

        let avatarContent = '';
        if (role === 'user') {
            avatarContent = '👤';
        } else if (role === 'assistant') {
            avatarContent = '🤖';
        }

        if (role === 'system') {
            div.innerHTML = `
                <div class="message-bubble">${formatMessage(content)}</div>
            `;
        } else {
            div.innerHTML = `
                <div class="message-avatar">${avatarContent}</div>
                <div class="message-content">
                    <div class="message-bubble">${formatMessage(content)}</div>
                    <div class="message-time">${formatTime(msg.timestamp)}</div>
                </div>
            `;
        }

        els.chatMessages.appendChild(div);
        scrollToBottom();
    }

    function showTypingIndicator() {
        if (document.getElementById('typingIndicator')) return;

        const div = document.createElement('div');
        div.className = 'typing-indicator';
        div.id = 'typingIndicator';
        div.innerHTML = `
            <div class="message-avatar">🤖</div>
            <div class="typing-dots">
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
            </div>
        `;
        els.chatMessages.appendChild(div);
        scrollToBottom();
    }

    function removeTypingIndicator() {
        const el = document.getElementById('typingIndicator');
        if (el) el.remove();
    }

    function scrollToBottom() {
        requestAnimationFrame(() => {
            els.chatArea.scrollTop = els.chatArea.scrollHeight;
        });
    }

    function saveMessages() {
        try {
            // Keep last 100 messages
            const toSave = messages.slice(-100);
            localStorage.setItem('agentvoicehub_messages', JSON.stringify(toSave));
        } catch (e) { /* quota exceeded */ }
    }

    function loadMessages() {
        try {
            const saved = localStorage.getItem('agentvoicehub_messages');
            if (saved) {
                messages = JSON.parse(saved);
                if (messages.length > 0) {
                    els.welcomeScreen.classList.add('hidden');
                    messages.forEach(msg => {
                        const div = document.createElement('div');
                        div.className = `message ${msg.role}`;
                        let avatarContent = msg.role === 'user' ? '👤' : msg.role === 'assistant' ? '🤖' : '';
                        if (msg.role === 'system') {
                            div.innerHTML = `<div class="message-bubble">${formatMessage(msg.content)}</div>`;
                        } else {
                            div.innerHTML = `
                                <div class="message-avatar">${avatarContent}</div>
                                <div class="message-content">
                                    <div class="message-bubble">${formatMessage(msg.content)}</div>
                                    <div class="message-time">${formatTime(msg.timestamp)}</div>
                                </div>
                            `;
                        }
                        els.chatMessages.appendChild(div);
                    });
                    scrollToBottom();
                }
            }
        } catch (e) {
            messages = [];
        }
    }

    // ── Send User Message ──────────────────────────
    function sendUserMessage(text) {
        if (!text.trim()) return;

        addMessage('user', text);
        showTypingIndicator();

        sendMessage({
            type: 'message',
            content: text,
            agent: config.selectedAgent,
        });

        els.textInput.value = '';
    }

    // ── Speech Recognition (STT) ───────────────────
    function initSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn('Speech Recognition not supported');
            return;
        }

        if (recognition) {
            recognition.abort();
        }

        recognition = new SpeechRecognition();
        recognition.lang = config.language;
        recognition.interimResults = true;
        recognition.continuous = config.continuousListening;
        recognition.maxAlternatives = 1;

        recognition.onresult = (event) => {
            let transcript = '';
            let isFinal = false;

            for (let i = event.resultIndex; i < event.results.length; i++) {
                transcript += event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    isFinal = true;
                }
            }

            els.textInput.value = transcript;

            if (isFinal) {
                sendUserMessage(transcript.trim());
                if (!config.continuousListening) {
                    stopRecording();
                }
            }
        };

        recognition.onerror = (event) => {
            console.warn('Speech recognition error:', event.error);
            if (event.error === 'not-allowed') {
                showToast('Microphone access denied. Please allow microphone permissions.', 'error', 5000);
            } else if (event.error !== 'aborted' && event.error !== 'no-speech') {
                showToast('Speech recognition error: ' + event.error, 'error');
            }
            stopRecording();
        };

        recognition.onend = () => {
            if (isRecording && config.continuousListening) {
                try {
                    recognition.start();
                } catch (e) { /* already started */ }
            } else {
                stopRecording();
            }
        };
    }

    function startRecording() {
        if (isRecording) return;
        if (!recognition) {
            showToast('Speech recognition not available', 'error');
            return;
        }

        isRecording = true;
        els.micBtn.classList.add('recording');
        els.voiceVizContainer.classList.add('active');
        els.textInput.placeholder = 'Listening...';

        // Start audio visualization
        startAudioVisualization();

        try {
            recognition.start();
        } catch (e) {
            console.warn('Recognition start error:', e);
        }

        playSound('start');
    }

    function stopRecording() {
        if (!isRecording) return;

        isRecording = false;
        els.micBtn.classList.remove('recording');
        els.voiceVizContainer.classList.remove('active');
        els.textInput.placeholder = 'Type a message or press Space to talk...';

        stopAudioVisualization();

        if (recognition) {
            try {
                recognition.stop();
            } catch (e) { /* already stopped */ }
        }

        playSound('stop');
    }

    function toggleRecording() {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    }

    // ── Audio Visualization ────────────────────────
    async function startAudioVisualization() {
        try {
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const source = audioContext.createMediaStreamSource(mediaStream);
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);

            drawWaveform();
        } catch (e) {
            console.warn('Audio visualization error:', e);
        }
    }

    function stopAudioVisualization() {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        if (mediaStream) {
            mediaStream.getTracks().forEach(t => t.stop());
            mediaStream = null;
        }
        // Clear canvas
        const ctx = els.voiceVizCanvas.getContext('2d');
        ctx.clearRect(0, 0, els.voiceVizCanvas.width, els.voiceVizCanvas.height);
    }

    function drawWaveform() {
        if (!analyser) return;

        const canvas = els.voiceVizCanvas;
        const ctx = canvas.getContext('2d');
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        function draw() {
            if (!isRecording) return;
            animationFrameId = requestAnimationFrame(draw);

            analyser.getByteFrequencyData(dataArray);

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const barWidth = (canvas.width / bufferLength) * 2.5;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                const barHeight = (dataArray[i] / 255) * canvas.height * 0.8;

                const hue = 190 + (i / bufferLength) * 30;
                const alpha = 0.4 + (dataArray[i] / 255) * 0.6;

                ctx.fillStyle = `hsla(${hue}, 100%, 60%, ${alpha})`;
                ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);

                // Mirror
                ctx.fillStyle = `hsla(${hue}, 100%, 60%, ${alpha * 0.3})`;
                ctx.fillRect(x, 0, barWidth - 1, barHeight * 0.3);

                x += barWidth;
            }
        }

        draw();
    }

    // ── TTS (Text-to-Speech) ───────────────────────
    function speak(text) {
        if (!('speechSynthesis' in window)) return;

        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = config.voiceRate;
        utterance.pitch = config.voicePitch;
        utterance.lang = config.language;

        // Find selected voice
        if (config.voice) {
            const voices = window.speechSynthesis.getVoices();
            const selected = voices.find(v => v.name === config.voice);
            if (selected) utterance.voice = selected;
        }

        utterance.onstart = () => {
            isSpeaking = true;
        };

        utterance.onend = () => {
            isSpeaking = false;
        };

        utterance.onerror = () => {
            isSpeaking = false;
        };

        window.speechSynthesis.speak(utterance);
    }

    // ── Audio Playback ─────────────────────────────
    function playAudioData(base64Audio) {
        try {
            const audioBytes = atob(base64Audio);
            const arrayBuffer = new ArrayBuffer(audioBytes.length);
            const view = new Uint8Array(arrayBuffer);
            for (let i = 0; i < audioBytes.length; i++) {
                view[i] = audioBytes.charCodeAt(i);
            }

            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            audioCtx.decodeAudioData(arrayBuffer, (buffer) => {
                const source = audioCtx.createBufferSource();
                source.buffer = buffer;
                source.connect(audioCtx.destination);
                source.start(0);
            }, (err) => {
                console.warn('Audio decode error:', err);
                // Fallback: try playing as element
                const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
                const url = URL.createObjectURL(blob);
                const audio = new Audio(url);
                audio.play().catch(() => {});
                audio.onended = () => URL.revokeObjectURL(url);
            });
        } catch (e) {
            console.warn('Audio playback error:', e);
        }
    }

    // ── Sound Effects ──────────────────────────────
    function playSound(type) {
        if (!config.soundEffects) return;

        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.connect(gain);
            gain.connect(ctx.destination);

            if (type === 'start') {
                osc.frequency.setValueAtTime(800, ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
                gain.gain.setValueAtTime(0.08, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.15);
            } else if (type === 'stop') {
                osc.frequency.setValueAtTime(1200, ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.1);
                gain.gain.setValueAtTime(0.08, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.15);
            } else if (type === 'send') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(1000, ctx.currentTime);
                gain.gain.setValueAtTime(0.04, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.08);
            }
        } catch (e) { /* ignore */ }
    }

    // ── Voice List ─────────────────────────────────
    function populateVoices() {
        const voices = window.speechSynthesis.getVoices();

        [els.voiceSelect, els.settingsVoice].forEach(select => {
            const currentVal = select.value;
            select.innerHTML = '<option value="">Default Voice</option>';
            voices.forEach(voice => {
                const opt = document.createElement('option');
                opt.value = voice.name;
                opt.textContent = `${voice.name} (${voice.lang})`;
                if (voice.name === config.voice) opt.selected = true;
                select.appendChild(opt);
            });
            if (currentVal) select.value = currentVal;
        });
    }

    // ── Agent Selector ─────────────────────────────
    function initAgentSelector() {
        $$('.agent-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                $$('.agent-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                config.selectedAgent = btn.dataset.agent;
                saveSettings();
                showToast(`Switched to ${btn.textContent}`, 'info');
            });
        });
    }

    // ── Particle Background ────────────────────────
    function initParticles() {
        const canvas = els.particleCanvas;
        const ctx = canvas.getContext('2d');
        let particles = [];
        let w, h;

        function resize() {
            w = canvas.width = window.innerWidth;
            h = canvas.height = window.innerHeight;
        }

        class Particle {
            constructor() {
                this.reset();
            }
            reset() {
                this.x = Math.random() * w;
                this.y = Math.random() * h;
                this.vx = (Math.random() - 0.5) * 0.3;
                this.vy = (Math.random() - 0.5) * 0.3;
                this.radius = Math.random() * 1.5 + 0.5;
                this.alpha = Math.random() * 0.4 + 0.1;
            }
            update() {
                this.x += this.vx;
                this.y += this.vy;
                if (this.x < 0 || this.x > w) this.vx *= -1;
                if (this.y < 0 || this.y > h) this.vy *= -1;
            }
            draw() {
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(0, 212, 255, ${this.alpha})`;
                ctx.fill();
            }
        }

        function init() {
            resize();
            particles = [];
            const count = Math.min(Math.floor((w * h) / 12000), 120);
            for (let i = 0; i < count; i++) {
                particles.push(new Particle());
            }
        }

        function drawConnections() {
            for (let i = 0; i < particles.length; i++) {
                for (let j = i + 1; j < particles.length; j++) {
                    const dx = particles[i].x - particles[j].x;
                    const dy = particles[i].y - particles[j].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 120) {
                        const alpha = (1 - dist / 120) * 0.08;
                        ctx.beginPath();
                        ctx.moveTo(particles[i].x, particles[i].y);
                        ctx.lineTo(particles[j].x, particles[j].y);
                        ctx.strokeStyle = `rgba(0, 212, 255, ${alpha})`;
                        ctx.lineWidth = 0.5;
                        ctx.stroke();
                    }
                }
            }
        }

        function animate() {
            if (!config.particleEffects) {
                ctx.clearRect(0, 0, w, h);
                requestAnimationFrame(animate);
                return;
            }

            ctx.clearRect(0, 0, w, h);
            particles.forEach(p => {
                p.update();
                p.draw();
            });
            drawConnections();
            requestAnimationFrame(animate);
        }

        window.addEventListener('resize', () => {
            resize();
        });

        init();
        animate();
    }

    // ── Keyboard Shortcuts ─────────────────────────
    function initKeyboard() {
        let spaceDown = false;

        document.addEventListener('keydown', (e) => {
            // Don't trigger shortcuts when typing in input
            const isTyping = document.activeElement === els.textInput ||
                             document.activeElement.tagName === 'INPUT' ||
                             document.activeElement.tagName === 'TEXTAREA' ||
                             document.activeElement.tagName === 'SELECT';

            // Space to talk (only when not typing)
            if (e.code === 'Space' && !isTyping && !spaceDown) {
                e.preventDefault();
                spaceDown = true;
                startRecording();
                return;
            }

            // Ctrl+, to open settings
            if (e.ctrlKey && e.key === ',') {
                e.preventDefault();
                openSettings();
                return;
            }

            // Ctrl+K for quick command focus
            if (e.ctrlKey && e.key === 'k') {
                e.preventDefault();
                els.textInput.focus();
                return;
            }

            // Escape to stop
            if (e.key === 'Escape') {
                if (isRecording) stopRecording();
                if (isSpeaking) window.speechSynthesis.cancel();
                closeSettings();
                els.textInput.blur();
                return;
            }

            // Enter to send (when typing)
            if (e.key === 'Enter' && !e.shiftKey && isTyping && document.activeElement === els.textInput) {
                e.preventDefault();
                sendUserMessage(els.textInput.value);
                return;
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.code === 'Space' && spaceDown) {
                spaceDown = false;
                stopRecording();
            }
        });
    }

    // ── Event Bindings ─────────────────────────────
    function initEvents() {
        // Mic button
        els.micBtn.addEventListener('click', toggleRecording);

        // Send button
        els.sendBtn.addEventListener('click', () => {
            sendUserMessage(els.textInput.value);
        });

        // Text input
        els.textInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendUserMessage(els.textInput.value);
            }
        });

        // Voice select in main area
        els.voiceSelect.addEventListener('change', () => {
            config.voice = els.voiceSelect.value;
            els.settingsVoice.value = config.voice;
            saveSettings();
        });

        // Settings voice select
        els.settingsVoice.addEventListener('change', () => {
            config.voice = els.settingsVoice.value;
            els.voiceSelect.value = config.voice;
            saveSettings();
        });

        // Settings panel
        els.settingsBtn.addEventListener('click', openSettings);
        els.settingsCloseBtn.addEventListener('click', closeSettings);
        els.settingsOverlay.addEventListener('click', closeSettings);

        // Voices loaded
        if ('speechSynthesis' in window) {
            speechSynthesis.onvoiceschanged = populateVoices;
            populateVoices();
        }
    }

    // ── Initialize ─────────────────────────────────
    function init() {
        loadSettings();
        loadMessages();
        initParticles();
        initSpeechRecognition();
        initAgentSelector();
        initKeyboard();
        initEvents();
        bindSettings();
        connectWebSocket();

        // Focus text input
        setTimeout(() => els.textInput.focus(), 300);
    }

    // Start when DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
