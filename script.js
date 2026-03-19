// Pingu AI Core - Version 3.0 - FULLY WORKING VOICE
class PinguAI {
    constructor() {
        this.config = null;
        this.memory = null;
        this.recognition = null;
        this.synthesis = window.speechSynthesis;
        this.isListening = false;
        this.isSpeaking = false;
        this.isFullDuplex = false;
        this.longPressTimer = null;
        this.textMode = false;
        this.conversationHistory = [];
        this.contextMemory = [];
        this.currentVoice = null;
        this.initialized = false;
        this.factMap = new Map();
        this.speakingIndicator = null;
        this.micBtn = null;
        this.micContainer = null;
        this.duplexIndicator = null;
        this.statusText = null;
        this.levelBars = [];
        this.keyboardToggle = null;
        this.textArea = null;
        this.chatHistory = null;
        this.voiceInterface = null;
        this.textInput = null;
        this.sendBtn = null;
        this.recognitionActive = false;
        this.restartTimeout = null;
        
        // Bind methods
        this.startListening = this.startListening.bind(this);
        this.stopListening = this.stopListening.bind(this);
        this.startFullDuplex = this.startFullDuplex.bind(this);
        this.exitFullDuplex = this.exitFullDuplex.bind(this);
        this.toggleTextMode = this.toggleTextMode.bind(this);
        this.sendTextMessage = this.sendTextMessage.bind(this);
        this.handleMicClick = this.handleMicClick.bind(this);
        this.handleLongPressStart = this.handleLongPressStart.bind(this);
        this.handleLongPressEnd = this.handleLongPressEnd.bind(this);
        
        // Initialize when DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }

    async init() {
        console.log('🐧 Pingu initializing...');
        
        // Get DOM elements
        this.cacheElements();
        
        await this.loadConfig();
        await this.loadMemory();
        this.setupVoiceRecognition();
        this.setupVoiceSynthesis();
        this.setupEventListeners();
        
        this.initialized = true;
        console.log('✅ Pingu initialized successfully');
        
        // Welcome user (voice only) - but only after user interaction
        // We'll do this on first mic click instead of automatically
        this.showWelcomeMessage();
    }

    cacheElements() {
        this.speakingIndicator = document.getElementById('speakingIndicator');
        this.micBtn = document.getElementById('micBtn');
        this.micContainer = document.getElementById('micContainer');
        this.duplexIndicator = document.getElementById('duplexIndicator');
        this.statusText = document.getElementById('statusText');
        this.keyboardToggle = document.getElementById('keyboardToggle');
        this.textArea = document.getElementById('textArea');
        this.chatHistory = document.getElementById('chatHistory');
        this.voiceInterface = document.getElementById('voiceInterface');
        this.textInput = document.getElementById('textInput');
        this.sendBtn = document.getElementById('sendBtn');
        
        // Get level bars
        this.levelBars = document.querySelectorAll('.level-bar');
    }

    showWelcomeMessage() {
        // Show in status instead of auto-speaking (browsers block auto-speech)
        if (this.statusText) {
            this.statusText.textContent = 'tap mic to start · Pingu ready';
        }
    }

    async loadConfig() {
        try {
            const response = await fetch('config.json');
            if (!response.ok) throw new Error('Config not found');
            this.config = await response.json();
            console.log('✅ Config loaded');
        } catch (error) {
            console.warn('Failed to load config, using defaults:', error);
            this.useDefaultConfig();
        }
    }

    useDefaultConfig() {
        this.config = {
            voice: {
                input: {
                    language: 'en-US',
                    continuous_mode: true,
                    interim_results: true
                },
                output: { 
                    rate: 0.95, 
                    pitch: 1.0,
                    volume: 1.0
                },
                full_duplex: { 
                    long_press_ms: 500 
                }
            },
            ai: {
                matching: { 
                    fuzzy_threshold: 0.75 
                },
                responses: { 
                    think_time_ms: 800 
                }
            }
        };
    }

    async loadMemory() {
        try {
            const response = await fetch('memory.json');
            if (!response.ok) throw new Error('Memory not found');
            this.memory = await response.json();
            console.log('✅ Memory loaded:', this.memory.bot_profile?.name || 'Pingu');
            this.buildSearchIndex();
        } catch (error) {
            console.error('Failed to load memory:', error);
            this.useDefaultMemory();
        }
    }

    useDefaultMemory() {
        this.memory = {
            bot_profile: {
                name: "Pingu",
                greeting: "Hello, my name is Pingu at your service",
                welcome_message: "I'm here to help. What would you like to know?"
            },
            fallback_responses: {
                no_memory: [
                    "I don't have that memory yet.",
                    "Tell me more about that?",
                    "I'd love to learn about that."
                ]
            }
        };
    }

    buildSearchIndex() {
        this.factMap.clear();
        
        if (this.memory && this.memory.specific_facts) {
            this.memory.specific_facts.forEach(fact => {
                if (fact.keywords && Array.isArray(fact.keywords)) {
                    fact.keywords.forEach(keyword => {
                        if (!this.factMap.has(keyword)) {
                            this.factMap.set(keyword, []);
                        }
                        this.factMap.get(keyword).push(fact);
                    });
                }
            });
        }
        
        console.log(`✅ Built search index with ${this.factMap.size} keywords`);
    }

    setupVoiceRecognition() {
        // Check for browser support
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        
        if (!SpeechRecognition) {
            console.error('Speech recognition not supported');
            this.updateStatus('voice not supported');
            return;
        }

        try {
            this.recognition = new SpeechRecognition();
            
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.lang = this.config?.voice?.input?.language || 'en-US';
            this.recognition.maxAlternatives = 1;
            
            this.recognition.onstart = () => {
                console.log('🎤 Recognition started');
                this.recognitionActive = true;
                this.isListening = true;
                this.updateMicState();
                this.updateStatus('listening...');
                this.animateLevelBars(true);
            };
            
            this.recognition.onresult = (event) => {
                let finalTranscript = '';
                let interimTranscript = '';
                
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const transcript = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                        finalTranscript += transcript;
                    } else {
                        interimTranscript += transcript;
                    }
                }
                
                if (finalTranscript) {
                    console.log('✅ Final:', finalTranscript);
                    this.processUserInput(finalTranscript, 'voice');
                    
                    if (!this.isFullDuplex) {
                        // In normal mode, stop after one command
                        setTimeout(() => this.stopListening(), 500);
                    }
                }
                
                if (interimTranscript) {
                    this.updateStatus(`"${interimTranscript}"`);
                }
            };
            
            this.recognition.onerror = (event) => {
                console.error('Recognition error:', event.error);
                
                if (event.error === 'not-allowed') {
                    this.updateStatus('microphone blocked · allow access');
                } else if (event.error === 'no-speech') {
                    this.updateStatus('no speech detected');
                    // Don't reset, just wait for next try
                } else {
                    this.updateStatus('tap to speak');
                    this.resetVoiceState();
                }
                
                this.animateLevelBars(false);
                this.recognitionActive = false;
            };
            
            this.recognition.onend = () => {
                console.log('🎤 Recognition ended');
                this.recognitionActive = false;
                
                if (this.isFullDuplex) {
                    // In duplex mode, restart after a short delay
                    clearTimeout(this.restartTimeout);
                    this.restartTimeout = setTimeout(() => {
                        if (this.isFullDuplex && !this.recognitionActive) {
                            try {
                                this.recognition.start();
                            } catch (e) {
                                console.log('Duplex restart failed:', e);
                            }
                        }
                    }, 100);
                } else {
                    this.isListening = false;
                    this.updateMicState();
                    this.updateStatus('tap to speak · long press for duplex');
                    this.animateLevelBars(false);
                }
            };
            
        } catch (e) {
            console.error('Failed to setup recognition:', e);
            this.updateStatus('voice setup failed');
        }
    }

    setupVoiceSynthesis() {
        if (!this.synthesis) return;
        
        // Load available voices
        if (this.synthesis.onvoiceschanged !== undefined) {
            this.synthesis.onvoiceschanged = () => {
                const voices = this.synthesis.getVoices();
                this.currentVoice = voices.find(v => v.lang.includes('en')) || voices[0];
            };
        }
        
        // Trigger initial load
        setTimeout(() => {
            const voices = this.synthesis.getVoices();
            if (voices.length > 0) {
                this.currentVoice = voices.find(v => v.lang.includes('en')) || voices[0];
            }
        }, 100);
    }

    setupEventListeners() {
        if (!this.micBtn || !this.micContainer) return;

        // Remove existing listeners
        this.micBtn.removeEventListener('click', this.handleMicClick);
        this.micContainer.removeEventListener('mousedown', this.handleLongPressStart);
        this.micContainer.removeEventListener('mouseup', this.handleLongPressEnd);
        this.micContainer.removeEventListener('mouseleave', this.handleLongPressEnd);
        
        // Add new listeners
        this.micBtn.addEventListener('click', this.handleMicClick);

        // Mouse events for long press
        this.micContainer.addEventListener('mousedown', this.handleLongPressStart);
        this.micContainer.addEventListener('mouseup', this.handleLongPressEnd);
        this.micContainer.addEventListener('mouseleave', this.handleLongPressEnd);

        // Touch events for mobile
        this.micContainer.addEventListener('touchstart', this.handleLongPressStart, { passive: false });
        this.micContainer.addEventListener('touchend', this.handleLongPressEnd);
        this.micContainer.addEventListener('touchcancel', this.handleLongPressEnd);

        // Keyboard toggle
        if (this.keyboardToggle) {
            this.keyboardToggle.removeEventListener('click', this.toggleTextMode);
            this.keyboardToggle.addEventListener('click', this.toggleTextMode);
        }

        // Send text
        if (this.sendBtn && this.textInput) {
            this.sendBtn.removeEventListener('click', this.sendTextMessage);
            this.textInput.removeEventListener('keypress', this.handleTextKeyPress);
            
            this.sendBtn.addEventListener('click', this.sendTextMessage);
            this.textInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.sendTextMessage();
            });
        }
        
        // First interaction welcome
        const firstInteraction = () => {
            if (!this.welcomed) {
                this.welcomed = true;
                setTimeout(() => {
                    this.speak(this.memory?.bot_profile?.greeting || "Hello, I'm Pingu");
                }, 500);
            }
        };
        
        this.micBtn.addEventListener('click', firstInteraction, { once: true });
    }

    handleMicClick(e) {
        e.preventDefault();
        e.stopPropagation();
        
        if (this.isFullDuplex) {
            // Single tap exits duplex mode (FIXED)
            this.exitFullDuplex();
        } else if (this.isListening) {
            this.stopListening();
        } else {
            this.startListening();
        }
    }

    handleLongPressStart(e) {
        e.preventDefault();
        this.longPressTimer = setTimeout(() => {
            if (!this.isFullDuplex && !this.isListening) {
                this.startFullDuplex();
            }
        }, this.config?.voice?.full_duplex?.long_press_ms || 500);
    }

    handleLongPressEnd() {
        clearTimeout(this.longPressTimer);
    }

    startListening() {
        if (!this.recognition) {
            alert('Voice recognition not supported. Please use text mode.');
            return;
        }
        
        if (this.recognitionActive) {
            console.log('Already listening');
            return;
        }
        
        try {
            // Request microphone permission implicitly
            this.recognition.continuous = false;
            this.recognition.start();
            console.log('🎤 Starting recognition...');
        } catch (e) {
            console.error('Failed to start recognition:', e);
            this.updateStatus('click again to start');
            
            // Fallback for browsers that need user interaction
            setTimeout(() => {
                try {
                    this.recognition.start();
                } catch (err) {
                    console.error('Second attempt failed:', err);
                    this.updateStatus('voice unavailable · use text');
                }
            }, 100);
        }
    }

    startFullDuplex() {
        if (!this.recognition) {
            alert('Voice recognition not supported.');
            return;
        }
        
        this.isFullDuplex = true;
        this.updateMicState();
        this.updateStatus('full duplex mode · tap mic to exit');
        this.animateLevelBars(true);
        
        if (this.recognitionActive) {
            try {
                this.recognition.stop();
            } catch (e) {}
        }
        
        setTimeout(() => {
            try {
                this.recognition.continuous = true;
                this.recognition.start();
                this.speak("Full duplex mode on. I'll keep listening.");
            } catch (e) {
                console.error('Failed to start duplex:', e);
                this.isFullDuplex = false;
                this.updateMicState();
                this.updateStatus('tap to speak');
            }
        }, 200);
    }

    exitFullDuplex() {
        this.isFullDuplex = false;
        this.stopListening();
        this.speak("Exiting full duplex mode");
        this.updateStatus('tap to speak · long press for duplex');
    }

    stopListening() {
        if (this.recognition && this.recognitionActive) {
            try {
                this.recognition.stop();
            } catch (e) {
                console.error('Failed to stop recognition:', e);
            }
        }
        
        clearTimeout(this.restartTimeout);
        this.isListening = false;
        this.recognitionActive = false;
        this.updateMicState();
        this.animateLevelBars(false);
        
        if (!this.isFullDuplex) {
            this.updateStatus('tap to speak · long press for duplex');
        }
    }

    resetVoiceState() {
        this.isListening = false;
        this.isFullDuplex = false;
        this.recognitionActive = false;
        this.updateMicState();
        this.updateStatus('tap to speak · long press for duplex');
        this.animateLevelBars(false);
        clearTimeout(this.restartTimeout);
    }

    updateMicState() {
        if (!this.micBtn || !this.duplexIndicator) return;
        
        this.micBtn.classList.remove('listening', 'full-duplex');
        
        if (this.isFullDuplex) {
            this.micBtn.classList.add('full-duplex');
            this.duplexIndicator.classList.add('active');
        } else if (this.isListening) {
            this.micBtn.classList.add('listening');
            this.duplexIndicator.classList.remove('active');
        } else {
            this.duplexIndicator.classList.remove('active');
        }
    }

    updateStatus(text) {
        if (this.statusText) {
            this.statusText.textContent = text;
        }
    }

    animateLevelBars(animate) {
        if (!this.levelBars || this.levelBars.length === 0) return;
        
        this.levelBars.forEach(bar => {
            if (animate) {
                bar.style.animation = 'levelMeter 0.8s infinite alternate';
            } else {
                bar.style.animation = 'none';
                bar.style.height = '15px';
            }
        });
    }

    toggleTextMode() {
        this.textMode = !this.textMode;
        
        if (!this.textArea || !this.chatHistory || !this.voiceInterface || !this.keyboardToggle) return;
        
        this.keyboardToggle.classList.toggle('active');
        
        if (this.textMode) {
            this.textArea.classList.add('active');
            this.chatHistory.classList.add('visible');
            this.voiceInterface.style.display = 'none';
            if (this.textInput) this.textInput.focus();
            
            // Stop listening when switching to text mode
            if (this.isListening || this.isFullDuplex) {
                this.stopListening();
                this.isFullDuplex = false;
                this.updateMicState();
            }
        } else {
            this.textArea.classList.remove('active');
            this.chatHistory.classList.remove('visible');
            this.voiceInterface.style.display = 'flex';
        }
    }

    async processUserInput(input, source) {
        if (!input || input.length === 0) return;
        
        console.log(`📝 Processing: "${input}" (${source})`);
        
        // Add to context memory
        this.contextMemory.push({
            role: 'user',
            content: input,
            timestamp: Date.now()
        });
        
        // Keep only last 10 interactions
        if (this.contextMemory.length > 10) {
            this.contextMemory = this.contextMemory.slice(-10);
        }
        
        // Show in chat if text mode
        if (this.textMode) {
            this.addMessage('user', input);
            await this.delay(this.config?.ai?.responses?.think_time_ms || 800);
        }
        
        // Generate response
        const response = this.generateResponse(input);
        
        // Add to context
        this.contextMemory.push({
            role: 'assistant',
            content: response,
            timestamp: Date.now()
        });
        
        // Show response in chat
        if (this.textMode) {
            this.addMessage('bot', response);
        }
        
        // Speak response
        this.speak(response);
    }

    generateResponse(input) {
        if (!this.memory) return "I'm still learning. Ask me again in a moment.";
        
        const q = input.toLowerCase().trim();
        
        // Check for greetings
        if (this.isGreeting(q)) {
            return this.getRandomResponse(this.memory.contextual_responses?.greeting) || 
                   "Hello! Ask me about Bonz and Ella.";
        }
        
        // Check for thanks
        if (this.isThanks(q)) {
            return this.getRandomResponse(this.memory.contextual_responses?.thanks) || 
                   "You're welcome!";
        }
        
        // Check for farewell
        if (this.isFarewell(q)) {
            return this.getRandomResponse(this.memory.contextual_responses?.farewell) || 
                   "Talk to you soon!";
        }
        
        // Search specific facts (fast lookup)
        const factMatch = this.searchFacts(q);
        if (factMatch) return factMatch;
        
        // Check first meeting
        if (this.isAboutFirstMeeting(q) && this.memory.first_meeting) {
            return this.handleFirstMeetingQuery(q);
        }
        
        // Check rainy confession
        if (this.isAboutRainyConfession(q) && this.memory.rainy_evening_confession) {
            return this.handleRainyConfessionQuery(q);
        }
        
        // Check relationship development
        if (this.isAboutDevelopment(q) && this.memory.relationship_development) {
            return this.handleDevelopmentQuery(q);
        }
        
        // Check personality questions
        if (this.isAboutPersonality(q) && this.memory.personality_traits) {
            return this.handlePersonalityQuery(q);
        }
        
        // Check inside jokes
        if (this.isAboutJokes(q) && this.memory.inside_jokes) {
            return this.handleJokeQuery(q);
        }
        
        // Check for stories
        if (this.isAboutStories(q) && this.memory.stories) {
            return this.handleStoryQuery(q);
        }
        
        // Default fallback
        return this.getRandomResponse(this.memory.fallback_responses?.no_memory) || 
               "I don't have that memory yet.";
    }

    searchFacts(query) {
        if (!this.factMap || this.factMap.size === 0) return null;
        
        let bestMatch = null;
        let highestScore = 0;
        
        for (let [keyword, facts] of this.factMap.entries()) {
            if (query.includes(keyword.toLowerCase())) {
                for (let fact of facts) {
                    const score = keyword.length / query.length;
                    if (score > highestScore && fact.fact) {
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
        const farewells = ['bye', 'goodbye', 'see you', 'talk later', 'farewell'];
        return farewells.some(f => query.includes(f));
    }

    isAboutFirstMeeting(query) {
        const keywords = ['first', 'meet', 'met', 'saw', 'jacaranda', 'library', 'august', 'chapati'];
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
        const keywords = ['personality', 'trait', 'like', 'character', 'tea', 'sugar', 'pen', 'nervous', 'remember'];
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
        const m = this.memory.first_meeting;
        if (!m) return "I don't have that memory yet.";
        
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
            return m.details?.tree_type || "A jacaranda tree near the main library.";
        }
        
        return m.story || "They met under the jacaranda tree on 23 August 2025.";
    }

    handleRainyConfessionQuery(query) {
        const r = this.memory.rainy_evening_confession;
        if (!r) return "I don't have that memory yet.";
        
        if (query.includes('where')) {
            return r.location || "In the old Faculty of Arts corridor.";
        }
        if (query.includes('what did bonz say') || query.includes('what bonz said')) {
            return `Bonz said, "${r.what_bonz_said || "I think I'm yours"}" - sincerely and badly.`;
        }
        if (query.includes('ella respond')) {
            return r.how_ella_responded || "Ella laughed, then said it back.";
        }
        if (query.includes('firework')) {
            return r.fireworks_meaning || "They didn't need fireworks. Their moment was perfect without grand gestures.";
        }
        if (query.includes('smil')) {
            return r.were_they_smiling ? "Yes, they were both smiling." : "They were smiling too much.";
        }
        
        return r.story || "One rainy evening, Bonz confessed his feelings in the Faculty of Arts corridor.";
    }

    handleDevelopmentQuery(query) {
        const d = this.memory.relationship_development?.second_semester;
        
        if (!d) return "During second semester, they grew closer at the Food Court.";
        
        if (query.includes('food court')) {
            return `They shared headphones in the ${d.shared_spot || 'Food Court'}.`;
        }
        if (query.includes('headphone')) {
            return `They always shared headphones - Bonz played hip-hop, Ella shared Luganda music.`;
        }
        if (query.includes('hip hop') || query.includes('bonz explain')) {
            return d.bonz_explained || "Bonz explained hip-hop lyrics to Ella.";
        }
        if (query.includes('luganda') || query.includes('ella correct')) {
            return d.ella_corrected || "Ella corrected Bonz's Luganda pronunciation.";
        }
        if (query.includes('argue') || query.includes('lecturer')) {
            return d.what_he_loves_about_her || "Ella could argue with lecturers and still make everyone laugh.";
        }
        if (query.includes('small things') || query.includes('tea') || query.includes('sugar')) {
            return d.what_she_loves_about_him || "Bonz remembered small things, like her tea with no sugar.";
        }
        
        return "They became inseparable during second semester, sharing headphones and teaching each other.";
    }

    handlePersonalityQuery(query) {
        const b = this.memory.personality_traits?.bonz;
        const e = this.memory.personality_traits?.ella;
        
        if (query.includes('bonz') && (query.includes('trait') || query.includes('like'))) {
            const traits = b?.traits || ["remembers small things", "explains hip-hop lyrics"];
            return `Bonz is ${traits.join(', ')}.`;
        }
        if (query.includes('ella') && (query.includes('trait') || query.includes('like'))) {
            const traits = e?.traits || ["argues brilliantly", "makes everyone laugh"];
            return `Ella is ${traits.join(', ')}.`;
        }
        if (query.includes('tea') || query.includes('sugar')) {
            return b?.details?.remembers?.[0] || "Bonz remembers that Ella's tea has no sugar.";
        }
        if (query.includes('tap') || query.includes('pen') || query.includes('nervous')) {
            return b?.details?.remembers?.[1] || "Ella taps her pen when she's nervous.";
        }
        
        return "They balance each other perfectly - Ella is bold, Bonz is attentive.";
    }

    handleJokeQuery(query) {
        const jokes = this.memory.inside_jokes || [];
        
        if (query.includes('chapati')) {
            const joke = jokes.find(j => j.name?.includes('chapati'));
            return joke?.story || "The chapati incident from their first meeting is their favorite inside joke.";
        }
        if (query.includes('politics 101') || query.includes('skip class')) {
            const joke = jokes.find(j => j.name?.includes('Politics'));
            return joke?.story || "Politics 101 became code for skipping class to be together.";
        }
        if (query.includes('umbrella')) {
            const joke = jokes.find(j => j.name?.includes('umbrella'));
            return joke?.story || "They still argue about whose umbrella started knocking during their rainy walk.";
        }
        
        return "They have many inside jokes! Ask about the chapati incident or umbrella wars.";
    }

    handleStoryQuery(query) {
        const stories = this.memory.stories || [];
        
        if (query.includes('met') || query.includes('first')) {
            const story = stories.find(s => s.category === 'origin');
            return story?.content || "They met under the jacaranda tree on 23 August 2025.";
        }
        if (query.includes('food court') || query.includes('second semester')) {
            const story = stories.find(s => s.category === 'development');
            return story?.content || "They spent second semester together at the Food Court, sharing headphones.";
        }
        if (query.includes('rain') || query.includes('confession')) {
            const story = stories.find(s => s.category === 'milestone');
            return story?.content || "Bonz confessed on a rainy evening in the Faculty of Arts corridor.";
        }
        
        return "I have many stories about them! Ask about how they met, their Food Court days, or the rainy confession.";
    }

    getRandomResponse(array) {
        if (!array || !Array.isArray(array) || array.length === 0) return null;
        return array[Math.floor(Math.random() * array.length)];
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
                <div class="message-content">${this.escapeHtml(text)}</div>
            `;
        } else {
            messageDiv.innerHTML = `
                <div class="message-content">${this.escapeHtml(text)}</div>
                <div class="message-avatar">👤</div>
            `;
        }
        
        this.chatHistory.appendChild(messageDiv);
        this.chatHistory.scrollTop = this.chatHistory.scrollHeight;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    speak(text, callback) {
        if (!this.synthesis || !text) return;
        
        // Cancel any ongoing speech
        this.synthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = this.config?.voice?.output?.rate || 0.95;
        utterance.pitch = this.config?.voice?.output?.pitch || 1.0;
        utterance.volume = this.config?.voice?.output?.volume || 1.0;
        
        if (this.currentVoice) {
            utterance.voice = this.currentVoice;
        }
        
        // Show speaking indicator
        if (this.speakingIndicator) {
            this.speakingIndicator.classList.add('active');
        }
        this.isSpeaking = true;
        
        utterance.onend = () => {
            if (this.speakingIndicator) {
                this.speakingIndicator.classList.remove('active');
            }
            this.isSpeaking = false;
            if (callback) callback();
        };
        
        utterance.onerror = () => {
            if (this.speakingIndicator) {
                this.speakingIndicator.classList.remove('active');
            }
            this.isSpeaking = false;
        };
        
        this.synthesis.speak(utterance);
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
if (typeof window !== 'undefined') {
    window.PinguAI = PinguAI;
    
    // Auto-initialize
    document.addEventListener('DOMContentLoaded', () => {
        window.pingu = new PinguAI();
    });
}