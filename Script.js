// Pingu AI Core - Version 2.0
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
        
        this.init();
    }

    async init() {
        await this.loadConfig();
        await this.loadMemory();
        this.setupVoiceRecognition();
        this.setupVoiceSynthesis();
        this.setupEventListeners();
        this.initialized = true;
        
        // Welcome user (voice only)
        setTimeout(() => {
            this.speak(this.memory.bot_profile.greeting, () => {
                setTimeout(() => {
                    this.speak(this.memory.bot_profile.welcome_message);
                }, 1500);
            });
        }, 800);
    }

    async loadConfig() {
        try {
            const response = await fetch('config.json');
            this.config = await response.json();
            console.log('✅ Config loaded');
        } catch (error) {
            console.error('Failed to load config:', error);
            this.useDefaultConfig();
        }
    }

    useDefaultConfig() {
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

    async loadMemory() {
        try {
            const response = await fetch('memory.json');
            this.memory = await response.json();
            console.log('✅ Memory loaded:', this.memory.bot_profile.name);
            this.buildSearchIndex();
        } catch (error) {
            console.error('Failed to load memory:', error);
        }
    }

    buildSearchIndex() {
        // Create quick lookup maps for faster searching
        this.factMap = new Map();
        if (this.memory.specific_facts) {
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

    setupVoiceRecognition() {
        if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
            this.updateStatus('voice not supported');
            return;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = new SpeechRecognition();
        
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = this.config.voice.input.language || 'en-US';
        this.recognition.maxAlternatives = this.config.voice.input.max_alternatives || 1;
        
        this.recognition.onstart = () => {
            this.isListening = true;
            this.updateMicState();
            this.updateStatus('listening...');
        };
        
        this.recognition.onresult = (event) => {
            const lastIndex = event.results.length - 1;
            const transcript = event.results[lastIndex][0].transcript.trim();
            
            if (event.results[lastIndex].isFinal) {
                this.processUserInput(transcript, 'voice');
                
                if (!this.isFullDuplex) {
                    this.stopListening();
                }
            } else {
                this.updateStatus(`"${transcript}"`);
            }
        };
        
        this.recognition.onerror = (event) => {
            console.error('Recognition error:', event.error);
            this.updateStatus('tap to speak');
            this.resetVoiceState();
        };
        
        this.recognition.onend = () => {
            if (this.isFullDuplex) {
                // Restart for continuous listening
                this.recognition.start();
            } else {
                this.resetVoiceState();
            }
        };
    }

    setupVoiceSynthesis() {
        if (!this.synthesis) return;
        
        // Load available voices
        this.synthesis.onvoiceschanged = () => {
            const voices = this.synthesis.getVoices();
            this.currentVoice = voices.find(v => v.lang.includes('en')) || voices[0];
        };
    }

    setupEventListeners() {
        const micBtn = document.getElementById('micBtn');
        const micContainer = document.getElementById('micContainer');
        const keyboardToggle = document.getElementById('keyboardToggle');
        const sendBtn = document.getElementById('sendBtn');
        const textInput = document.getElementById('textInput');

        if (!micBtn || !micContainer) return;

        // Single tap - toggle listening / exit duplex
        micBtn.addEventListener('click', (e) => {
            e.preventDefault();
            
            if (this.isFullDuplex) {
                this.exitFullDuplex();
            } else if (this.isListening) {
                this.stopListening();
            } else {
                this.startListening();
            }
        });

        // Long press for full duplex
        micContainer.addEventListener('mousedown', () => {
            this.longPressTimer = setTimeout(() => {
                if (!this.isFullDuplex && !this.isListening) {
                    this.startFullDuplex();
                }
            }, this.config.voice.full_duplex.long_press_ms || 500);
        });

        micContainer.addEventListener('mouseup', () => clearTimeout(this.longPressTimer));
        micContainer.addEventListener('mouseleave', () => clearTimeout(this.longPressTimer));

        // Touch events
        micContainer.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.longPressTimer = setTimeout(() => {
                if (!this.isFullDuplex && !this.isListening) {
                    this.startFullDuplex();
                }
            }, this.config.voice.full_duplex.long_press_ms || 500);
        });

        micContainer.addEventListener('touchend', () => clearTimeout(this.longPressTimer));
        micContainer.addEventListener('touchcancel', () => clearTimeout(this.longPressTimer));

        // Keyboard toggle
        if (keyboardToggle) {
            keyboardToggle.addEventListener('click', () => this.toggleTextMode());
        }

        // Send text
        if (sendBtn && textInput) {
            sendBtn.addEventListener('click', () => this.sendTextMessage());
            textInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.sendTextMessage();
            });
        }
    }

    startListening() {
        if (this.recognition && !this.isListening) {
            this.recognition.continuous = false;
            try {
                this.recognition.start();
            } catch (e) {
                console.error('Failed to start recognition:', e);
            }
        }
    }

    startFullDuplex() {
        this.isFullDuplex = true;
        this.updateMicState();
        this.updateStatus('full duplex mode');
        
        if (this.recognition) {
            this.recognition.continuous = true;
            try {
                this.recognition.start();
            } catch (e) {
                console.error('Failed to start duplex:', e);
            }
        }
        
        this.speak("Full duplex mode activated. I'll keep listening.");
    }

    exitFullDuplex() {
        this.isFullDuplex = false;
        this.stopListening();
        this.speak("Exiting full duplex mode");
    }

    stopListening() {
        if (this.recognition && this.isListening) {
            try {
                this.recognition.stop();
            } catch (e) {
                console.error('Failed to stop recognition:', e);
            }
        }
        this.resetVoiceState();
    }

    resetVoiceState() {
        this.isListening = false;
        this.isFullDuplex = false;
        this.updateMicState();
        this.updateStatus('tap to speak · long press for duplex');
    }

    updateMicState() {
        const micBtn = document.getElementById('micBtn');
        const duplexIndicator = document.getElementById('duplexIndicator');
        
        if (!micBtn) return;
        
        micBtn.classList.remove('listening', 'full-duplex');
        
        if (this.isFullDuplex) {
            micBtn.classList.add('full-duplex');
            if (duplexIndicator) duplexIndicator.classList.add('active');
        } else if (this.isListening) {
            micBtn.classList.add('listening');
            if (duplexIndicator) duplexIndicator.classList.remove('active');
        } else {
            if (duplexIndicator) duplexIndicator.classList.remove('active');
        }
    }

    updateStatus(text) {
        const statusEl = document.getElementById('statusText');
        if (statusEl) statusEl.textContent = text;
    }

    toggleTextMode() {
        this.textMode = !this.textMode;
        const textArea = document.getElementById('textArea');
        const chatHistory = document.getElementById('chatHistory');
        const voiceInterface = document.getElementById('voiceInterface');
        const keyboardToggle = document.getElementById('keyboardToggle');
        
        if (!textArea || !chatHistory || !voiceInterface) return;
        
        keyboardToggle.classList.toggle('active');
        
        if (this.textMode) {
            textArea.classList.add('active');
            chatHistory.classList.add('visible');
            voiceInterface.style.display = 'none';
            document.getElementById('textInput')?.focus();
        } else {
            textArea.classList.remove('active');
            chatHistory.classList.remove('visible');
            voiceInterface.style.display = 'flex';
        }
    }

    async processUserInput(input, source) {
        if (!input || input.length === 0) return;
        
        // Add to context memory
        this.contextMemory.push({
            role: 'user',
            content: input,
            timestamp: Date.now()
        });
        
        // Keep only last 5 interactions
        if (this.contextMemory.length > 10) {
            this.contextMemory = this.contextMemory.slice(-10);
        }
        
        // Show in chat if text mode
        if (this.textMode) {
            this.addMessage('user', input);
            await this.delay(this.config.ai.responses.think_time_ms || 800);
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
        const q = input.toLowerCase().trim();
        
        // Check for greetings
        if (this.isGreeting(q)) {
            return this.getRandomResponse(this.memory.contextual_responses.greeting);
        }
        
        // Check for thanks
        if (this.isThanks(q)) {
            return this.getRandomResponse(this.memory.contextual_responses.thanks);
        }
        
        // Check for farewell
        if (this.isFarewell(q)) {
            return this.getRandomResponse(this.memory.contextual_responses.farewell);
        }
        
        // Search specific facts (fast lookup)
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
        return this.getRandomResponse(this.memory.fallback_responses.no_memory);
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
        const thanks = ['thank', 'thanks', 'appreciate'];
        return thanks.some(t => query.includes(t));
    }

    isFarewell(query) {
        const farewells = ['bye', 'goodbye', 'see you', 'talk later'];
        return farewells.some(f => query.includes(f));
    }

    isAboutFirstMeeting(query) {
        const keywords = ['first', 'meet', 'met', 'saw', 'jacaranda', 'library', '23 august', 'chapati'];
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
        const keywords = ['joke', 'funny', 'inside joke', 'laugh'];
        return keywords.some(k => query.includes(k));
    }

    isAboutStories(query) {
        const keywords = ['story', 'tell', 'narrative', 'happened'];
        return keywords.some(k => query.includes(k));
    }

    handleFirstMeetingQuery(query) {
        const m = this.memory.first_meeting;
        
        if (query.includes('where')) {
            return `Under the jacaranda tree by Makerere's main library. ${m.location_details || ''}`;
        }
        if (query.includes('when') || query.includes('date')) {
            return `Bonz first saw Ella on ${m.date}. It was a Saturday morning.`;
        }
        if (query.includes('hold') || query.includes('carry') || query.includes('ella had')) {
            return `Ella was holding ${m.details.what_she_was_holding}.`;
        }
        if (query.includes('late') || query.includes('bonz late')) {
            return `Bonz was late for ${m.details.what_he_was_late_for}. He nearly knocked them both over!`;
        }
        if (query.includes('talk') || query.includes('discuss')) {
            return `They talked about ${m.details.what_they_talked_about.join(' and ')} instead of going to class.`;
        }
        if (query.includes('tree')) {
            return `It was a jacaranda tree with beautiful purple blooms near the main library.`;
        }
        if (query.includes('chapati')) {
            return `Ella was holding a chapati wrapped in paper. It became their first inside joke.`;
        }
        
        return m.story;
    }

    handleRainyConfessionQuery(query) {
        const r = this.memory.rainy_evening_confession;
        
        if (query.includes('where')) {
            return `In the ${r.location}. It's an old corridor in the Faculty of Arts building.`;
        }
        if (query.includes('what did bonz say') || query.includes('what bonz said')) {
            return `Bonz said, "${r.what_bonz_said}" - sincerely and badly.`;
        }
        if (query.includes('ella respond')) {
            return `Ella laughed warmly, then said it back.`;
        }
        if (query.includes('firework')) {
            return `No, they didn't need fireworks. Their moment was perfect without grand gestures.`;
        }
        if (query.includes('walk')) {
            return `They walked back through campus with their umbrellas knocking together.`;
        }
        if (query.includes('smil')) {
            return `Yes, they were both smiling too much and pretending not to.`;
        }
        if (query.includes('umbrella')) {
            return `Their umbrellas kept knocking during the walk back. It's now an inside joke.`;
        }
        
        return r.story;
    }

    handleDevelopmentQuery(query) {
        const d = this.memory.relationship_development.second_semester;
        
        if (query.includes('food court')) {
            return `They shared headphones in the Food Court during second semester. It became their special spot.`;
        }
        if (query.includes('headphone')) {
            return `They always shared headphones in the Food Court - Bonz would play hip-hop, Ella would share Luganda music.`;
        }
        if (query.includes('hip hop') || query.includes('bonz explain')) {
            return `Bonz explained hip-hop lyrics to Ella. He loved sharing the stories behind the music.`;
        }
        if (query.includes('luganda') || query.includes('ella correct')) {
            return `Ella corrected Bonz's Luganda pronunciation with patience and a smile.`;
        }
        if (query.includes('argue') || query.includes('lecturer')) {
            return d.what_he_loves_about_her;
        }
        if (query.includes('small things') || query.includes('tea') || query.includes('sugar')) {
            return d.what_she_loves_about_him;
        }
        
        return `By second semester, they were inseparable. They'd share headphones in the Food Court, teach each other things, and make the whole row laugh.`;
    }

    handlePersonalityQuery(query) {
        const b = this.memory.personality_traits.bonz;
        const e = this.memory.personality_traits.ella;
        
        if (query.includes('bonz') && (query.includes('trait') || query.includes('like'))) {
            return `Bonz is ${b.traits.join(', ')}. He's the kind of person who notices everything about you.`;
        }
        if (query.includes('ella') && (query.includes('trait') || query.includes('like'))) {
            return `Ella is ${e.traits.join(', ')}. She lights up any room she walks into.`;
        }
        if (query.includes('tea') || query.includes('sugar')) {
            return `Bonz remembers that Ella's tea has no sugar. It's one of the small things he loves about her.`;
        }
        if (query.includes('tap') || query.includes('pen') || query.includes('nervous')) {
            return `Ella taps her pen when she's nervous. Bonz noticed it early on and still finds it endearing.`;
        }
        if (query.includes('remember')) {
            return `Bonz remembers small things like Ella's tea preference and how she taps her pen when nervous. It's what she loves most about him.`;
        }
        
        return `They balance each other perfectly - Ella is bold and makes everyone laugh, Bonz is attentive and remembers every little detail about her.`;
    }

    handleJokeQuery(query) {
        const jokes = this.memory.inside_jokes;
        
        if (query.includes('chapati')) {
            return jokes.find(j => j.name.includes('chapati')).story;
        }
        if (query.includes('politics 101') || query.includes('skip class')) {
            return jokes.find(j => j.name.includes('Politics')).story;
        }
        if (query.includes('umbrella')) {
            return jokes.find(j => j.name.includes('umbrella')).story;
        }
        
        return "They have so many inside jokes! Ask about the chapati incident, Politics 101, or the umbrella wars.";
    }

    handleStoryQuery(query) {
        const stories = this.memory.stories;
        
        if (query.includes('met') || query.includes('first')) {
            return stories.find(s => s.category === 'origin').content;
        }
        if (query.includes('food court') || query.includes('second semester')) {
            return stories.find(s => s.category === 'development').content;
        }
        if (query.includes('rain') || query.includes('confession')) {
            return stories.find(s => s.category === 'milestone').content;
        }
        
        return "I have so many stories about them! Would you like to hear how they met, about their Food Court days, or the rainy confession?";
    }

    handleContextQuery(query) {
        // Check if this is a follow-up question
        if (this.contextMemory.length < 2) return null;
        
        const lastUserMsg = this.contextMemory.filter(m => m.role === 'user').pop();
        
        if (!lastUserMsg) return null;
        
        // Handle follow-ups like "where was that?" or "when did that happen?"
        if (query.includes('where') && lastUserMsg.content.includes('meet')) {
            return this.memory.first_meeting.location;
        }
        if (query.includes('when') && lastUserMsg.content.includes('confess')) {
            return "It happened during the rainy season in their second semester.";
        }
        if (query.includes('why') && lastUserMsg.content.includes('fireworks')) {
            return this.memory.rainy_evening_confession.fireworks_meaning;
        }
        
        return null;
    }

    getRandomResponse(array) {
        if (!array || array.length === 0) return "I'm not sure what to say.";
        return array[Math.floor(Math.random() * array.length)];
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    addMessage(sender, text) {
        const chatHistory = document.getElementById('chatHistory');
        if (!chatHistory) return;
        
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
        
        chatHistory.appendChild(messageDiv);
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    speak(text, callback) {
        if (!this.synthesis || !text) return;
        
        // Cancel any ongoing speech
        this.synthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = this.config.voice.output.rate || 0.95;
        utterance.pitch = this.config.voice.output.pitch || 1.0;
        utterance.volume = this.config.voice.output.volume || 1.0;
        
        if (this.currentVoice) {
            utterance.voice = this.currentVoice;
        }
        
        // Show speaking indicator
        const indicator = document.getElementById('speakingIndicator');
        if (indicator) indicator.classList.add('active');
        this.isSpeaking = true;
        
        utterance.onend = () => {
            if (indicator) indicator.classList.remove('active');
            this.isSpeaking = false;
            if (callback) callback();
        };
        
        utterance.onerror = () => {
            if (indicator) indicator.classList.remove('active');
            this.isSpeaking = false;
        };
        
        this.synthesis.speak(utterance);
    }

    sendTextMessage() {
        const input = document.getElementById('textInput');
        if (!input) return;
        
        const message = input.value.trim();
        if (message) {
            this.processUserInput(message, 'text');
            input.value = '';
        }
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.pingu = new PinguAI();
});