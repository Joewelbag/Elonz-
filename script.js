// Pingu AI Core - Version 2.1 (FIXED)
class PinguAI {
    constructor() {
        // Core properties
        this.config = null;
        this.memory = null;
        this.recognition = null;
        this.synthesis = window.speechSynthesis;
        this.initialized = false;
        
        // State management - SINGLE SOURCE OF TRUTH
        this.state = {
            mode: 'IDLE',           // 'IDLE', 'LISTENING', 'DUPLEX'
            isSpeaking: false,
            isInitialized: false,
            permissionGranted: false
        };
        
        // Speech queue system
        this.speechQueue = [];
        this.isProcessingQueue = false;
        
        // Context memory (fixed size)
        this.contextMemory = [];
        this.maxContextSize = 10;
        
        // Long press timer
        this.longPressTimer = null;
        this.LONG_PRESS_DURATION = 500; // ms
        
        // Error recovery counters
        this.errorCount = 0;
        this.maxErrors = 3;
        
        // Bind methods to maintain 'this' context
        this.handleMicClick = this.handleMicClick.bind(this);
        this.handleMicLongPressStart = this.handleMicLongPressStart.bind(this);
        this.handleMicLongPressEnd = this.handleMicLongPressEnd.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
        
        // Start initialization when DOM is ready
        document.addEventListener('DOMContentLoaded', () => this.init());
    }

    async init() {
        console.log('🐧 Pingu initializing...');
        
        try {
            // Load configuration first
            await this.loadConfig();
            
            // Load memory data
            await this.loadMemory();
            
            // Check microphone hardware and permissions
            await this.checkMicrophoneAvailability();
            
            // Setup voice systems
            this.setupVoiceRecognition();
            this.setupVoiceSynthesis();
            
            // Setup event listeners (only after DOM is ready)
            this.setupEventListeners();
            
            // Mark as initialized
            this.state.isInitialized = true;
            this.updateUIState();
            
            console.log('✅ Pingu initialized successfully');
            
            // Welcome user (voice only)
            setTimeout(() => {
                this.speak(this.memory.bot_profile.greeting, () => {
                    setTimeout(() => {
                        this.speak(this.memory.bot_profile.welcome_message);
                    }, 1500);
                });
            }, 1000);
            
        } catch (error) {
            console.error('❌ Initialization failed:', error);
            this.showError('Failed to initialize. Please refresh.');
        }
    }

    async loadConfig() {
        try {
            const response = await fetch('config.json');
            if (!response.ok) throw new Error('Config not found');
            this.config = await response.json();
            console.log('✅ Config loaded');
        } catch (error) {
            console.warn('Using default config:', error);
            this.config = {
                voice: {
                    output: { rate: 0.95, pitch: 1.0 },
                    full_duplex: { long_press_ms: 500 }
                },
                ai: {
                    matching: { fuzzy_threshold: 0.75 },
                    responses: { think_time_ms: 800 }
                }
            };
        }
    }

    async loadMemory() {
        try {
            const response = await fetch('memory.json');
            if (!response.ok) throw new Error('Memory not found');
            this.memory = await response.json();
            console.log('✅ Memory loaded:', this.memory.bot_profile.name);
            this.buildSearchIndex();
        } catch (error) {
            console.error('❌ Failed to load memory:', error);
            this.showError('Memory data missing');
        }
    }

    buildSearchIndex() {
        // Create quick lookup maps for faster searching
        this.factMap = new Map();
        if (this.memory?.specific_facts) {
            this.memory.specific_facts.forEach(fact => {
                fact.keywords.forEach(keyword => {
                    if (!this.factMap.has(keyword)) {
                        this.factMap.set(keyword, []);
                    }
                    this.factMap.get(keyword).push(fact);
                });
            });
        }
    }

    async checkMicrophoneAvailability() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            this.updateStatus('microphone not supported');
            return false;
        }

        try {
            // Test if microphone is available and get permission
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            // Stop all tracks immediately (we just needed permission)
            stream.getTracks().forEach(track => track.stop());
            this.state.permissionGranted = true;
            console.log('✅ Microphone permission granted');
            return true;
        } catch (error) {
            console.warn('❌ Microphone permission denied:', error);
            this.updateStatus('microphone access needed');
            this.state.permissionGranted = false;
            return false;
        }
    }

    setupVoiceRecognition() {
        // Check browser support
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            this.updateStatus('voice not supported');
            return;
        }

        // Initialize recognition
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = this.config?.voice?.input?.language || 'en-US';
        this.recognition.maxAlternatives = 1;

        // Set up event handlers
        this.recognition.onstart = () => {
            console.log('🎤 Listening started');
            if (this.state.mode === 'DUPLEX') {
                // Already in duplex mode
            } else {
                this.state.mode = 'LISTENING';
            }
            this.updateUIState();
            this.updateStatus('listening...');
        };

        this.recognition.onresult = (event) => {
            const lastIndex = event.results.length - 1;
            const transcript = event.results[lastIndex][0].transcript.trim();
            
            if (event.results[lastIndex].isFinal) {
                console.log('🎤 Heard:', transcript);
                this.processUserInput(transcript, 'voice');
                
                // In non-duplex mode, stop after one command
                if (this.state.mode !== 'DUPLEX') {
                    this.stopListening();
                }
            } else {
                // Show interim results
                this.updateStatus(`"${transcript}"`);
            }
        };

        this.recognition.onerror = (event) => {
            console.error('🎤 Recognition error:', event.error);
            this.errorCount++;
            
            // Handle specific errors
            switch (event.error) {
                case 'not-allowed':
                    this.state.permissionGranted = false;
                    this.updateStatus('microphone blocked');
                    break;
                case 'no-speech':
                    this.updateStatus('no speech detected');
                    // Auto-retry in duplex mode
                    if (this.state.mode === 'DUPLEX' && this.errorCount < this.maxErrors) {
                        setTimeout(() => this.startListening(), 500);
                    }
                    break;
                case 'network':
                    this.updateStatus('network error');
                    break;
                default:
                    this.updateStatus('tap to speak');
            }
            
            // Reset on too many errors
            if (this.errorCount >= this.maxErrors) {
                this.resetVoiceState();
                this.errorCount = 0;
            }
        };

        this.recognition.onend = () => {
            console.log('🎤 Listening ended');
            
            // Auto-restart in duplex mode
            if (this.state.mode === 'DUPLEX' && this.state.permissionGranted) {
                setTimeout(() => {
                    if (this.state.mode === 'DUPLEX') {
                        this.startListening();
                    }
                }, 300);
            } else {
                // Only reset if not in duplex
                if (this.state.mode !== 'DUPLEX') {
                    this.resetVoiceState();
                }
            }
        };
    }

    setupVoiceSynthesis() {
        if (!this.synthesis) {
            console.warn('Speech synthesis not supported');
            return;
        }

        // Load voices when they become available
        if (this.synthesis.onvoiceschanged !== undefined) {
            this.synthesis.onvoiceschanged = () => {
                const voices = this.synthesis.getVoices();
                // Prefer a natural English voice
                this.preferredVoice = voices.find(v => 
                    v.lang.includes('en') && v.name.includes('Natural')
                ) || voices.find(v => v.lang.includes('en')) || voices[0];
                console.log('✅ Voice synthesis ready');
            };
        }

        // Force voice loading
        if (this.synthesis.getVoices().length > 0) {
            const voices = this.synthesis.getVoices();
            this.preferredVoice = voices.find(v => v.lang.includes('en')) || voices[0];
        }
    }

    setupEventListeners() {
        // Get DOM elements
        this.micBtn = document.getElementById('micBtn');
        this.micContainer = document.getElementById('micContainer');
        this.keyboardToggle = document.getElementById('keyboardToggle');
        this.sendBtn = document.getElementById('sendBtn');
        this.textInput = document.getElementById('textInput');
        this.chatHistory = document.getElementById('chatHistory');
        this.voiceInterface = document.getElementById('voiceInterface');
        this.duplexIndicator = document.getElementById('duplexIndicator');
        this.statusText = document.getElementById('statusText');

        if (!this.micBtn || !this.micContainer) {
            console.error('Required DOM elements not found');
            return;
        }

        // Mic click handler
        this.micBtn.addEventListener('click', this.handleMicClick);

        // Mic long press (mouse)
        this.micContainer.addEventListener('mousedown', this.handleMicLongPressStart);
        this.micContainer.addEventListener('mouseup', this.handleMicLongPressEnd);
        this.micContainer.addEventListener('mouseleave', this.handleMicLongPressEnd);

        // Mic long press (touch)
        this.micContainer.addEventListener('touchstart', this.handleMicLongPressStart);
        this.micContainer.addEventListener('touchend', this.handleMicLongPressEnd);
        this.micContainer.addEventListener('touchcancel', this.handleMicLongPressEnd);

        // Keyboard toggle
        if (this.keyboardToggle) {
            this.keyboardToggle.addEventListener('click', () => this.toggleTextMode());
        }

        // Send button
        if (this.sendBtn && this.textInput) {
            this.sendBtn.addEventListener('click', () => this.sendTextMessage());
            this.textInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.sendTextMessage();
            });
        }

        // Handle keyboard shortcuts
        document.addEventListener('keydown', this.handleKeyDown);

        // Handle page visibility change
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.state.mode !== 'IDLE') {
                this.stopListening();
            }
        });
    }

    handleMicClick(event) {
        event.preventDefault();
        
        // Clear any pending long press
        clearTimeout(this.longPressTimer);
        
        // If no permission, request it first
        if (!this.state.permissionGranted) {
            this.checkMicrophoneAvailability().then(granted => {
                if (granted) this.handleMicAction();
            });
            return;
        }
        
        this.handleMicAction();
    }

    handleMicAction() {
        switch (this.state.mode) {
            case 'IDLE':
                this.startListening();
                break;
            case 'LISTENING':
                this.stopListening();
                break;
            case 'DUPLEX':
                this.exitDuplexMode();
                break;
        }
    }

    handleMicLongPressStart(event) {
        event.preventDefault();
        
        // Only start long press if idle
        if (this.state.mode !== 'IDLE') return;
        
        this.longPressTimer = setTimeout(() => {
            if (this.state.mode === 'IDLE' && this.state.permissionGranted) {
                this.startDuplexMode();
            }
        }, this.LONG_PRESS_DURATION);
    }

    handleMicLongPressEnd(event) {
        event.preventDefault();
        clearTimeout(this.longPressTimer);
    }

    handleKeyDown(event) {
        // Alt + V to toggle voice mode
        if (event.altKey && event.key === 'v') {
            event.preventDefault();
            this.handleMicAction();
        }
        
        // Alt + T to toggle text mode
        if (event.altKey && event.key === 't') {
            event.preventDefault();
            this.toggleTextMode();
        }
    }

    startListening() {
        if (!this.recognition || !this.state.permissionGranted) return;
        
        try {
            this.recognition.continuous = false;
            this.recognition.start();
            this.state.mode = 'LISTENING';
            this.errorCount = 0;
            this.updateUIState();
            console.log('🎤 Started listening (single mode)');
        } catch (error) {
            console.error('Failed to start listening:', error);
            this.resetVoiceState();
        }
    }

    startDuplexMode() {
        if (!this.recognition || !this.state.permissionGranted) return;
        
        try {
            this.recognition.continuous = true;
            this.recognition.start();
            this.state.mode = 'DUPLEX';
            this.errorCount = 0;
            this.updateUIState();
            this.speak("Full duplex mode activated. I'll keep listening.");
            console.log('🎤 Started listening (duplex mode)');
        } catch (error) {
            console.error('Failed to start duplex:', error);
            this.resetVoiceState();
        }
    }

    stopListening() {
        if (this.recognition) {
            try {
                this.recognition.stop();
            } catch (error) {
                console.warn('Error stopping recognition:', error);
            }
        }
        this.resetVoiceState();
    }

    exitDuplexMode() {
        this.state.mode = 'IDLE';
        this.stopListening();
        this.speak("Exiting full duplex mode");
    }

    resetVoiceState() {
        this.state.mode = 'IDLE';
        this.errorCount = 0;
        this.updateUIState();
        this.updateStatus('tap to speak · long press for duplex');
    }

    updateUIState() {
        if (!this.micBtn || !this.duplexIndicator) return;
        
        // Remove all state classes
        this.micBtn.classList.remove('listening', 'full-duplex');
        
        // Apply appropriate class based on mode
        switch (this.state.mode) {
            case 'LISTENING':
                this.micBtn.classList.add('listening');
                this.duplexIndicator?.classList.remove('active');
                break;
            case 'DUPLEX':
                this.micBtn.classList.add('full-duplex');
                this.duplexIndicator?.classList.add('active');
                break;
            default:
                this.duplexIndicator?.classList.remove('active');
        }
    }

    updateStatus(text) {
        if (this.statusText) {
            this.statusText.textContent = text;
        }
    }

    showError(message) {
        this.updateStatus(`❌ ${message}`);
        console.error(message);
    }

    toggleTextMode() {
        if (!this.textArea) {
            this.textArea = document.getElementById('textArea');
            this.chatHistory = document.getElementById('chatHistory');
            this.voiceInterface = document.getElementById('voiceInterface');
            this.keyboardToggle = document.getElementById('keyboardToggle');
        }

        if (!this.textArea || !this.chatHistory || !this.voiceInterface) return;

        const isOpening = !this.textArea.classList.contains('active');
        
        if (isOpening) {
            // Opening text mode - stop voice if active
            if (this.state.mode !== 'IDLE') {
                this.stopListening();
            }
            
            this.textArea.classList.add('active');
            this.chatHistory.classList.add('visible');
            this.voiceInterface.style.display = 'none';
            this.keyboardToggle?.classList.add('active');
            this.textInput?.focus();
        } else {
            // Closing text mode
            this.textArea.classList.remove('active');
            this.chatHistory.classList.remove('visible');
            this.voiceInterface.style.display = 'flex';
            this.keyboardToggle?.classList.remove('active');
        }
    }

    async processUserInput(input, source) {
        if (!input || input.length === 0) return;
        
        // Add to context memory (fixed size)
        this.contextMemory.push({
            role: 'user',
            content: input,
            timestamp: Date.now()
        });
        
        // Keep context size fixed
        if (this.contextMemory.length > this.maxContextSize) {
            this.contextMemory.shift();
        }
        
        // Show in chat if text mode
        if (this.textArea?.classList.contains('active')) {
            this.addMessage('user', input);
            await this.delay(this.config?.ai?.responses?.think_time_ms || 800);
        }
        
        // Generate response
        const response = this.generateResponse(input);
        
        // Add response to context
        this.contextMemory.push({
            role: 'assistant',
            content: response,
            timestamp: Date.now()
        });
        
        // Keep context size fixed
        if (this.contextMemory.length > this.maxContextSize) {
            this.contextMemory = this.contextMemory.slice(-this.maxContextSize);
        }
        
        // Show response in chat
        if (this.textArea?.classList.contains('active')) {
            this.addMessage('bot', response);
        }
        
        // Speak response
        this.speak(response);
    }

    generateResponse(input) {
        const q = input.toLowerCase().trim();
        
        // Check for greetings
        if (this.isGreeting(q)) {
            return this.getRandomResponse(this.memory?.contextual_responses?.greeting) || 
                   "Hello! Ask me about Bonz and Ella's story.";
        }
        
        // Check for thanks
        if (this.isThanks(q)) {
            return this.getRandomResponse(this.memory?.contextual_responses?.thanks) ||
                   "You're welcome!";
        }
        
        // Check for farewell
        if (this.isFarewell(q)) {
            return this.getRandomResponse(this.memory?.contextual_responses?.farewell) ||
                   "Talk to you soon!";
        }
        
        // Search specific facts
        const factMatch = this.searchFacts(q);
        if (factMatch) return factMatch;
        
        // Check first meeting
        if (this.isAboutFirstMeeting(q)) {
            return this.handleFirstMeetingQuery(q);
        }
        
        // Check rainy confession
        if (this.isAboutRainyConfession(q)) {
            return this.handleRainyConfessionQuery(q);
        }
        
        // Check relationship development
        if (this.isAboutDevelopment(q)) {
            return this.handleDevelopmentQuery(q);
        }
        
        // Check personality questions
        if (this.isAboutPersonality(q)) {
            return this.handlePersonalityQuery(q);
        }
        
        // Check inside jokes
        if (this.isAboutJokes(q)) {
            return this.handleJokeQuery(q);
        }
        
        // Check for stories
        if (this.isAboutStories(q)) {
            return this.handleStoryQuery(q);
        }
        
        // Check for context follow-ups
        const contextResponse = this.handleContextQuery(q);
        if (contextResponse) return contextResponse;
        
        // Default fallback
        return this.getRandomResponse(this.memory?.fallback_responses?.no_memory) ||
               "I don't have that memory yet. Want to tell me about it?";
    }

    searchFacts(query) {
        if (!this.factMap) return null;
        
        const words = query.split(' ');
        let bestMatch = null;
        let highestScore = 0;
        
        for (let [keyword, facts] of this.factMap.entries()) {
            if (query.includes(keyword)) {
                for (let fact of facts) {
                    const score = keyword.length / query.length;
                    if (score > highestScore) {
                        highestScore = score;
                        bestMatch = fact.fact;
                    }
                }
            }
        }
        
        return bestMatch;
    }

    isGreeting(query) {
        const greetings = ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening'];
        return greetings.some(g => query.includes(g));
    }

    isThanks(query) {
        const thanks = ['thank', 'thanks', 'appreciate', 'thank you'];
        return thanks.some(t => query.includes(t));
    }

    isFarewell(query) {
        const farewells = ['bye', 'goodbye', 'see you', 'talk later', 'see ya'];
        return farewells.some(f => query.includes(f));
    }

    isAboutFirstMeeting(query) {
        const keywords = ['first', 'meet', 'met', 'saw', 'jacaranda', 'library', '23 august', 'chapati', 'politics 101'];
        return keywords.some(k => query.includes(k));
    }

    isAboutRainyConfession(query) {
        const keywords = ['rain', 'confess', 'faculty', 'arts', 'corridor', 'shelter', 'umbrella', 'firework', 'smiling'];
        return keywords.some(k => query.includes(k));
    }

    isAboutDevelopment(query) {
        const keywords = ['second semester', 'food court', 'headphones', 'hip hop', 'luganda', 'argue', 'lecturer'];
        return keywords.some(k => query.includes(k));
    }

    isAboutPersonality(query) {
        const keywords = ['personality', 'trait', 'like', 'character', 'tea', 'sugar', 'pen', 'nervous', 'remember', 'small things'];
        return keywords.some(k => query.includes(k));
    }

    isAboutJokes(query) {
        const keywords = ['joke', 'funny', 'inside joke', 'laugh', 'humor'];
        return keywords.some(k => query.includes(k));
    }

    isAboutStories(query) {
        const keywords = ['story', 'tell', 'narrative', 'happened', 'what happened'];
        return keywords.some(k => query.includes(k));
    }

    handleFirstMeetingQuery(query) {
        if (!this.memory?.first_meeting) return "I don't have that memory.";
        
        const m = this.memory.first_meeting;
        
        if (query.includes('where')) {
            return m.location || "Under the jacaranda tree by Makerere's main library.";
        }
        if (query.includes('when') || query.includes('date')) {
            return `Bonz first saw Ella on ${m.date || '23 August 2025'}.`;
        }
        if (query.includes('hold') || query.includes('carry') || query.includes('ella had')) {
            return m.details?.what_she_was_holding || "Ella was holding notebooks and a chapati.";
        }
        if (query.includes('late') || query.includes('bonz late')) {
            return m.details?.what_he_was_late_for || "Bonz was late for Politics 101.";
        }
        if (query.includes('talk') || query.includes('discuss')) {
            const topics = m.details?.what_they_talked_about || ["Kampala traffic", "debating clubs"];
            return `They talked about ${topics.join(' and ')}.`;
        }
        if (query.includes('tree')) {
            return m.details?.tree_type || "A jacaranda tree near the library.";
        }
        
        return m.story || "They met under the jacaranda tree. She had chapati, he was late, and they talked for hours.";
    }

    handleRainyConfessionQuery(query) {
        if (!this.memory?.rainy_evening_confession) return "I don't have that memory.";
        
        const r = this.memory.rainy_evening_confession;
        
        if (query.includes('where')) {
            return r.location || "In the old Faculty of Arts corridor.";
        }
        if (query.includes('what did bonz say') || query.includes('what bonz said')) {
            return `Bonz said, "${r.what_bonz_said || 'I think I\'m yours'}" - sincerely and badly.`;
        }
        if (query.includes('ella respond')) {
            return r.how_ella_responded || "Ella laughed, then said it back.";
        }
        if (query.includes('firework')) {
            return "No, they didn't need fireworks. Their moment was perfect without grand gestures.";
        }
        if (query.includes('walk')) {
            return r.walk_back || "They walked back through campus with umbrellas knocking.";
        }
        if (query.includes('smil')) {
            return "Yes, they were both smiling too much and pretending not to.";
        }
        
        return r.story || "They sheltered from rain in the Faculty of Arts corridor. Bonz confessed, Ella laughed and said it back. No fireworks needed.";
    }

    handleDevelopmentQuery(query) {
        if (!this.memory?.relationship_development?.second_semester) {
            return "By second semester, they were inseparable at the Food Court.";
        }
        
        const d = this.memory.relationship_development.second_semester;
        
        if (query.includes('food court')) {
            return `They shared headphones in the ${d.shared_spot || 'Food Court'}.`;
        }
        if (query.includes('headphone')) {
            return `They always shared headphones - ${d.bonz_explained || 'Bonz explained hip-hop'}, ${d.ella_corrected || 'Ella corrected Luganda'}.`;
        }
        if (query.includes('hip hop') || query.includes('bonz explain')) {
            return d.bonz_explained || "Bonz explained hip-hop lyrics to Ella.";
        }
        if (query.includes('luganda') || query.includes('ella correct')) {
            return d.ella_corrected || "Ella corrected Bonz's Luganda pronunciation.";
        }
        if (query.includes('argue') || query.includes('lecturer')) {
            return d.what_he_loves_about_her || "He loves how she argues with lecturers and makes everyone laugh.";
        }
        if (query.includes('small things') || query.includes('tea') || query.includes('sugar')) {
            return d.what_she_loves_about_him || "She loves how he remembers small things, like her tea has no sugar.";
        }
        
        return "They grew closer in second semester, sharing music and teaching each other at the Food Court.";
    }

    handlePersonalityQuery(query) {
        const b = this.memory?.personality_traits?.bonz;
        const e = this.memory?.personality_traits?.ella;
        
        if (query.includes('bonz') && query.includes('trait')) {
            return b?.traits?.join(', ') || "Bonz remembers small things, explains hip-hop, and is sincere.";
        }
        if (query.includes('ella') && query.includes('trait')) {
            return e?.traits?.join(', ') || "Ella argues brilliantly, makes people laugh, and corrects Luganda gently.";
        }
        if (query.includes('tea') || query.includes('sugar')) {
            return b?.details?.remembers?.[0] || "Bonz remembers that Ella's tea has no sugar.";
        }
        if (query.includes('tap') || query.includes('pen') || query.includes('nervous')) {
            return b?.details?.remembers?.[1] || "Ella taps her pen when she's nervous.";
        }
        
        return "They complement each other perfectly - he remembers everything about her, she lights up every room.";
    }

    handleJokeQuery(query) {
        const jokes = this.memory?.inside_jokes || [];
        
        if (query.includes('chapati')) {
            const joke = jokes.find(j => j.name?.includes('chapati'));
            return joke?.story || "The chapati incident from their first meeting - she was holding it, he almost made her drop it.";
        }
        if (query.includes('politics 101') || query.includes('skip class')) {
            const joke = jokes.find(j => j.name?.includes('Politics'));
            return joke?.story || "Politics 101 became code for skipping class to be together.";
        }
        if (query.includes('umbrella')) {
            const joke = jokes.find(j => j.name?.includes('umbrella'));
            return joke?.story || "Their umbrellas kept knocking during the rainy walk home.";
        }
        
        return "They have so many inside jokes! Ask about the chapati incident, Politics 101, or the umbrella wars.";
    }

    handleStoryQuery(query) {
        const stories = this.memory?.stories || [];
        
        if (query.includes('met') || query.includes('first')) {
            const story = stories.find(s => s.category === 'origin');
            return story?.content || "Under the jacaranda tree, with chapati and notebooks, their story began.";
        }
        if (query.includes('food court') || query.includes('second semester')) {
            const story = stories.find(s => s.category === 'development');
            return story?.content || "They shared headphones in the Food Court, teaching each other music and language.";
        }
        if (query.includes('rain') || query.includes('confession')) {
            const story = stories.find(s => s.category === 'milestone');
            return story?.content || "In the Faculty of Arts corridor, sheltering from rain, Bonz confessed his heart.";
        }
        
        return "I have beautiful stories about them. Ask about how they met, their Food Court days, or the rainy confession.";
    }

    handleContextQuery(query) {
        if (this.contextMemory.length < 2) return null;
        
        const lastUserMsg = [...this.contextMemory].reverse().find(m => m.role === 'user');
        if (!lastUserMsg) return null;
        
        // Handle follow-ups
        if (query.includes('where') && lastUserMsg.content.includes('meet')) {
            return this.memory?.first_meeting?.location || "Under the jacaranda tree.";
        }
        if (query.includes('when') && lastUserMsg.content.includes('confess')) {
            return "During rainy season in their second semester.";
        }
        if (query.includes('why') && lastUserMsg.content.includes('fireworks')) {
            return "Because their love was genuine - they didn't need grand gestures.";
        }
        
        return null;
    }

    getRandomResponse(array) {
        if (!array || array.length === 0) return null;
        return array[Math.floor(Math.random() * array.length)];
    }

    // Speech Queue System
    speak(text, callback) {
        if (!this.synthesis || !text) return;
        
        // Add to queue
        this.speechQueue.push({ text, callback });
        
        // Start processing if not already
        if (!this.isProcessingQueue) {
            this.processSpeechQueue();
        }
    }

    async processSpeechQueue() {
        if (this.isProcessingQueue || this.speechQueue.length === 0) return;
        
        this.isProcessingQueue = true;
        
        while (this.speechQueue.length > 0) {
            const { text, callback } = this.speechQueue.shift();
            
            await this.speakNow(text);
            
            if (callback) callback();
            
            // Small pause between speeches
            await this.delay(100);
        }
        
        this.isProcessingQueue = false;
    }

    speakNow(text) {
        return new Promise((resolve) => {
            const utterance = new SpeechSynthesisUtterance(text);
            
            // Apply voice settings
            utterance.rate = this.config?.voice?.output?.rate || 0.95;
            utterance.pitch = this.config?.voice?.output?.pitch || 1.0;
            utterance.volume = this.config?.voice?.output?.volume || 1.0;
            
            if (this.preferredVoice) {
                utterance.voice = this.preferredVoice;
            }
            
            // Show speaking indicator
            const indicator = document.getElementById('speakingIndicator');
            if (indicator) indicator.classList.add('active');
            
            utterance.onend = () => {
                if (indicator) indicator.classList.remove('active');
                resolve();
            };
            
            utterance.onerror = () => {
                if (indicator) indicator.classList.remove('active');
                resolve(); // Resolve anyway to continue queue
            };
            
            this.synthesis.speak(utterance);
        });
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    addMessage(sender, text) {
        if (!this.chatHistory) return;
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}`;
        
        if (sender === 'bot') {
            messageDiv.innerHTML = `
                <div class="message-avatar">🐧</div>
                <div class="message-content">${text}</div>
            `;
        } else {
            messageDiv.innerHTML = `
                <div class="message-content">${text}</div>
                <div class="message-avatar">👤</div>
            `;
        }
        
        this.chatHistory.appendChild(messageDiv);
        this.chatHistory.scrollTop = this.chatHistory.scrollHeight;
    }

    sendTextMessage() {
        if (!this.textInput) return;
        
        const message = this.textInput.value.trim();
        if (message) {
            this.processUserInput(message, 'text');
            this.textInput.value = '';
        }
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.pingu = new PinguAI();
    });
} else {
    window.pingu = new PinguAI();
}
