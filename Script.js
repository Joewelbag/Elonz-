// Pingu AI Core - Version 2.1 with Learning, Fuzzy Matching, Context, Synonyms & LocalStorage
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
        
        // Learning Mode Properties
        this.learningMode = false;
        this.pendingTeach = null;
        this.factMap = new Map();
        this.userPrefs = {};
        
        this.init();
    }

    async init() {
        await this.loadConfig();
        await this.loadMemory();
        this.setupVoiceRecognition();
        this.setupVoiceSynthesis();
        this.setupEventListeners();
        this.loadTaughtMemories();
        this.loadConversation();
        this.userPrefs = this.loadFromLocalStorage('preferences') || {};
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
                matching: { fuzzy_threshold: 0.75, enable_fuzzy: true },
                responses: { think_time_ms: 800 },
                context: { enabled: true, max_history: 5, context_window_ms: 300000 }
            },
            learning: {
                trigger_phrases: ["remember that", "learn this", "Pingu remember"],
                confirmation_needed: true,
                storage_key: "pingu_taught_memories"
            },
            synonyms: {},
            performance: { save_conversation_frequency: 5 }
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
        this.factMap = new Map();
        
        // Index built-in facts
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
        
        // Index first meeting keywords
        if (this.memory.first_meeting && this.memory.first_meeting.keywords) {
            const fact = {
                fact: this.memory.first_meeting.story,
                category: 'first_meeting'
            };
            this.memory.first_meeting.keywords.forEach(keyword => {
                if (!this.factMap.has(keyword)) {
                    this.factMap.set(keyword, []);
                }
                this.factMap.get(keyword).push(fact);
            });
        }
        
        // Index rainy confession keywords
        if (this.memory.rainy_evening_confession && this.memory.rainy_evening_confession.keywords) {
            const fact = {
                fact: this.memory.rainy_evening_confession.story,
                category: 'confession'
            };
            this.memory.rainy_evening_confession.keywords.forEach(keyword => {
                if (!this.factMap.has(keyword)) {
                    this.factMap.set(keyword, []);
                }
                this.factMap.get(keyword).push(fact);
            });
        }
    }

    // ==================== FUZZY MATCHING ====================
    fuzzyMatch(query, target) {
        if (!this.config.ai.matching.enable_fuzzy) {
            return query.toLowerCase().includes(target.toLowerCase());
        }
        
        query = query.toLowerCase();
        target = target.toLowerCase();
        
        // Quick win - direct inclusion
        if (query.includes(target)) return true;
        
        // Levenshtein distance for fuzzy matching
        const len1 = query.length;
        const len2 = target.length;
        const matrix = Array(len2 + 1).fill().map(() => Array(len1 + 1).fill(0));
        
        for (let i = 0; i <= len1; i++) matrix[0][i] = i;
        for (let j = 0; j <= len2; j++) matrix[j][0] = j;
        
        for (let j = 1; j <= len2; j++) {
            for (let i = 1; i <= len1; i++) {
                const cost = query[i-1] === target[j-1] ? 0 : 1;
                matrix[j][i] = Math.min(
                    matrix[j][i-1] + 1,
                    matrix[j-1][i] + 1,
                    matrix[j-1][i-1] + cost
                );
            }
        }
        
        const distance = matrix[len2][len1];
        const maxLen = Math.max(len1, len2);
        const similarity = 1 - (distance / maxLen);
        
        return similarity > (this.config.ai.matching.fuzzy_threshold || 0.75);
    }

    // ==================== SYNONYM EXPANSION ====================
    expandWithSynonyms(query) {
        if (!this.config.synonyms) return [query];
        
        let expandedQueries = [query];
        const words = query.toLowerCase().split(' ');
        
        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            
            for (let [key, synonyms] of Object.entries(this.config.synonyms)) {
                if (word === key || synonyms.includes(word)) {
                    const allTerms = [key, ...synonyms];
                    allTerms.forEach(term => {
                        if (term !== word) {
                            const newQuery = [...words];
                            newQuery[i] = term;
                            expandedQueries.push(newQuery.join(' '));
                        }
                    });
                }
            }
        }
        
        return [...new Set(expandedQueries)]; // Remove duplicates
    }

    // ==================== SEARCH FACTS WITH FUZZY + SYNONYMS ====================
    searchFacts(query) {
        if (!this.factMap) return null;
        
        const queries = this.expandWithSynonyms(query);
        let bestMatch = null;
        let highestScore = 0;
        
        for (let expandedQuery of queries) {
            for (let [keyword, facts] of this.factMap.entries()) {
                if (this.fuzzyMatch(expandedQuery, keyword)) {
                    for (let fact of facts) {
                        // Calculate confidence score
                        const keywordLength = keyword.length;
                        const queryLength = query.length;
                        const baseScore = keywordLength / Math.max(queryLength, 1);
                        
                        // Boost score if keyword appears directly
                        const directBoost = query.includes(keyword) ? 0.2 : 0;
                        const score = baseScore + directBoost;
                        
                        if (score > highestScore) {
                            highestScore = score;
                            bestMatch = fact.fact || fact;
                        }
                    }
                }
            }
        }
        
        return bestMatch;
    }

    // ==================== LOCALSTORAGE METHODS ====================
    saveToLocalStorage(key, data) {
        try {
            localStorage.setItem(`pingu_${key}`, JSON.stringify(data));
            return true;
        } catch (e) {
            console.warn('Failed to save to localStorage:', e);
            return false;
        }
    }

    loadFromLocalStorage(key) {
        try {
            const data = localStorage.getItem(`pingu_${key}`);
            return data ? JSON.parse(data) : null;
        } catch (e) {
            console.warn('Failed to load from localStorage:', e);
            return null;
        }
    }

    saveConversation() {
        const recent = this.conversationHistory.slice(-20);
        this.saveToLocalStorage('conversation', recent);
    }

    loadConversation() {
        const saved = this.loadFromLocalStorage('conversation');
        if (saved) {
            this.conversationHistory = saved;
        }
    }

    saveUserPreference(key, value) {
        let prefs = this.loadFromLocalStorage('preferences') || {};
        prefs[key] = value;
        this.saveToLocalStorage('preferences', prefs);
        this.userPrefs = prefs;
    }

    // ==================== LEARNING MODE METHODS ====================
    checkForLearningTrigger(query) {
        const triggers = this.config.learning?.trigger_phrases || 
                        ["remember that", "learn this", "Pingu remember", "save this"];
        
        for (let phrase of triggers) {
            if (query.toLowerCase().includes(phrase)) {
                this.enterLearningMode(query);
                return true;
            }
        }
        return false;
    }

    enterLearningMode(query) {
        const triggers = this.config.learning?.trigger_phrases || 
                        ["remember that", "learn this", "Pingu remember", "save this"];
        
        const usedPhrase = triggers.find(p => query.toLowerCase().includes(p));
        if (!usedPhrase) return;
        
        const parts = query.split(usedPhrase);
        if (parts.length < 2) return;
        
        const teachContent = parts[1].trim();
        if (!teachContent) return;
        
        this.learningMode = true;
        this.pendingTeach = teachContent;
        
        this.speak("What should I remember about that?");
        
        if (this.textMode) {
            this.addMessage('bot', "What should I remember about that?");
        }
    }

    processTeaching(userResponse) {
        if (!this.pendingTeach) return;
        
        // Create new memory
        const newMemory = {
            id: `taught_${Date.now()}`,
            question: this.pendingTeach,
            answer: userResponse,
            taught_date: new Date().toISOString().split('T')[0],
            times_asked: 0,
            keywords: this.extractKeywords(this.pendingTeach + ' ' + userResponse)
        };
        
        // Save to localStorage
        this.saveTaughtMemory(newMemory);
        
        this.speak("Got it! I'll remember that.");
        
        if (this.textMode) {
            this.addMessage('bot', "✅ Got it! I'll remember that.");
        }
        
        this.learningMode = false;
        this.pendingTeach = null;
    }

    extractKeywords(text) {
        return text.toLowerCase()
            .replace(/[^\w\s]/g, '')
            .split(' ')
            .filter(w => w.length > 3)
            .slice(0, 5); // Limit to 5 keywords
    }

    saveTaughtMemory(memory) {
        const storageKey = this.config.learning?.storage_key || 'pingu_taught_memories';
        let taught = this.loadFromLocalStorage(storageKey) || [];
        taught.push(memory);
        this.saveToLocalStorage(storageKey, taught);
        
        // Add to current session factMap
        memory.keywords.forEach(keyword => {
            if (!this.factMap.has(keyword)) {
                this.factMap.set(keyword, []);
            }
            this.factMap.get(keyword).push({ fact: memory.answer, taught: true });
        });
    }

    loadTaughtMemories() {
        const storageKey = this.config.learning?.storage_key || 'pingu_taught_memories';
        const taught = this.loadFromLocalStorage(storageKey);
        
        if (taught && Array.isArray(taught)) {
            taught.forEach(memory => {
                memory.keywords.forEach(keyword => {
                    if (!this.factMap.has(keyword)) {
                        this.factMap.set(keyword, []);
                    }
                    this.factMap.get(keyword).push({ 
                        fact: memory.answer, 
                        taught: true,
                        id: memory.id 
                    });
                });
            });
            console.log(`✅ Loaded ${taught.length} taught memories`);
        }
    }

    // ==================== CONTEXT HANDLING ====================
    handleContextQuery(query) {
        if (!this.config.ai?.context?.enabled || this.contextMemory.length < 2) {
            return null;
        }
        
        const now = Date.now();
        const windowMs = this.config.ai.context.context_window_ms || 300000;
        
        // Get recent context (last 5 minutes)
        const recentContext = this.contextMemory.filter(m => 
            (now - m.timestamp) < windowMs
        );
        
        if (recentContext.length < 2) return null;
        
        const lastUserMsg = [...recentContext].reverse().find(m => m.role === 'user');
        const lastBotMsg = [...recentContext].reverse().find(m => m.role === 'assistant');
        
        if (!lastUserMsg || !lastBotMsg) return null;
        
        // Context mapping
        const contextMap = {
            'where': ['location', 'place', 'at', 'which place'],
            'when': ['date', 'time', 'day', 'month', 'year', 'what day'],
            'who': ['person', 'name', 'called', 'who is'],
            'why': ['reason', 'because', 'why did'],
            'what': ['what', 'which', 'tell me more']
        };
        
        // Check for follow-up questions
        for (let [type, indicators] of Object.entries(contextMap)) {
            if (indicators.some(i => query.toLowerCase().includes(i))) {
                // Look for location in last bot message
                if (type === 'where') {
                    const locationMatch = lastBotMsg.content.match(/(?:in|at|under|near) ([^.!?]+)/i);
                    if (locationMatch) return `It happened ${locationMatch[0]}.`;
                }
                // Look for date in last bot message
                if (type === 'when') {
                    const dateMatch = lastBotMsg.content.match(/\d{1,2}(?:st|nd|rd|th)? \w+(?: \d{4})?/);
                    if (dateMatch) return `That was on ${dateMatch[0]}.`;
                }
            }
        }
        
        // Handle pronoun references (they, them, he, she)
        const pronouns = ['they', 'them', 'their', 'he', 'him', 'she', 'her', 'it'];
        if (pronouns.some(p => query.toLowerCase().includes(p))) {
            const lastTopic = lastBotMsg.content.split('.').slice(0, 1)[0];
            return `You're asking about ${lastTopic}... ` + 
                   this.findResponse(query.replace(/they|them|he|him|she|her|it/g, 'Bonz Ella'));
        }
        
        return null;
    }

    addToContext(role, content) {
        this.contextMemory.push({
            role: role,
            content: content,
            timestamp: Date.now()
        });
        
        const maxHistory = this.config.ai?.context?.max_history || 5;
        if (this.contextMemory.length > maxHistory * 2) {
            this.contextMemory = this.contextMemory.slice(-maxHistory * 2);
        }
    }

    // ==================== VOICE SETUP ====================
    setupVoiceRecognition() {
        if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
            this.updateStatus('voice not supported');
            return;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = new SpeechRecognition();
        
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = this.config.voice?.input?.language || 'en-US';
        this.recognition.maxAlternatives = this.config.voice?.input?.max_alternatives || 1;
        
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
                try {
                    this.recognition.start();
                } catch (e) {
                    console.log('Restarting duplex...');
                }
            } else {
                this.resetVoiceState();
            }
        };
    }

    setupVoiceSynthesis() {
        if (!this.synthesis) return;
        
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

        micContainer.addEventListener('mousedown', () => {
            this.longPressTimer = setTimeout(() => {
                if (!this.isFullDuplex && !this.isListening) {
                    this.startFullDuplex();
                }
            }, this.config.voice?.full_duplex?.long_press_ms || 500);
        });

        micContainer.addEventListener('mouseup', () => clearTimeout(this.longPressTimer));
        micContainer.addEventListener('mouseleave', () => clearTimeout(this.longPressTimer));

        micContainer.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.longPressTimer = setTimeout(() => {
                if (!this.isFullDuplex && !this.isListening) {
                    this.startFullDuplex();
                }
            }, this.config.voice?.full_duplex?.long_press_ms || 500);
        });

        micContainer.addEventListener('touchend', () => clearTimeout(this.longPressTimer));
        micContainer.addEventListener('touchcancel', () => clearTimeout(this.longPressTimer));

        if (keyboardToggle) {
            keyboardToggle.addEventListener('click', () => this.toggleTextMode());
        }

        if (sendBtn && textInput) {
            sendBtn.addEventListener('click', () => this.sendTextMessage());
            textInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.sendTextMessage();
            });
        }
    }

    // ==================== CORE PROCESSING ====================
    async processUserInput(input, source) {
        if (!input || input.length === 0) return;
        
        // Check if in learning mode
        if (this.learningMode && this.pendingTeach) {
            this.processTeaching(input);
            return;
        }
        
        // Check for learning triggers
        if (this.checkForLearningTrigger(input)) {
            return;
        }
        
        // Add to context
        this.addToContext('user', input);
        
        // Check context first for follow-ups
        const contextResponse = this.handleContextQuery(input);
        if (contextResponse) {
            this.addToContext('assistant', contextResponse);
            if (this.textMode) this.addMessage('bot', contextResponse);
            this.speak(contextResponse);
            return;
        }
        
        // Show in chat if text mode
        if (this.textMode) {
            this.addMessage('user', input);
            await this.delay(this.config.ai?.responses?.think_time_ms || 800);
        }
        
        // Generate response
        const response = this.generateResponse(input);
        
        // Add to context
        this.addToContext('assistant', response);
        
        // Show response in chat
        if (this.textMode) {
            this.addMessage('bot', response);
        }
        
        // Speak response
        this.speak(response);
        
        // Save conversation periodically
        if (this.conversationHistory.length % (this.config.performance?.save_conversation_frequency || 5) === 0) {
            this.saveConversation();
        }
    }

    generateResponse(query) {
        const q = query.toLowerCase().trim();
        
        // Check for greetings
        if (this.isGreeting(q)) {
            return this.getRandomResponse(this.memory.contextual_responses?.greeting);
        }
        
        // Check for thanks
        if (this.isThanks(q)) {
            return this.getRandomResponse(this.memory.contextual_responses?.thanks);
        }
        
        // Check for farewell
        if (this.isFarewell(q)) {
            return this.getRandomResponse(this.memory.contextual_responses?.farewell);
        }
        
        // Search facts with fuzzy + synonyms
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
        
        // Default fallback with teaching prompt
        const fallbacks = this.memory.fallback_responses?.no_memory || [
            "I don't have that memory yet. Would you like to teach me? Say 'Pingu remember' followed by what you want me to know."
        ];
        return this.getRandomResponse(fallbacks);
    }

    // ==================== QUERY DETECTION ====================
    isGreeting(query) {
        const greetings = ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening'];
        return greetings.some(g => query.includes(g));
    }

    isThanks(query) {
        const thanks = ['thank', 'thanks', 'appreciate', 'thank you'];
        return thanks.some(t => query.includes(t));
    }

    isFarewell(query) {
        const farewells = ['bye', 'goodbye', 'see you', 'talk later', 'cya'];
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
        const keywords = ['joke', 'funny', 'inside joke', 'laugh', 'humor'];
        return keywords.some(k => query.includes(k));
    }

    isAboutStories(query) {
        const keywords = ['story', 'tell', 'narrative', 'happened', 'describe'];
        return keywords.some(k => query.includes(k));
    }

    // ==================== HANDLERS ====================
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
        const d = this.memory.relationship_development?.second_semester;
        if (!d) return "I don't have that memory yet.";
        
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
        const b = this.memory.personality_traits?.bonz;
        const e = this.memory.personality_traits?.ella;
        
        if (!b || !e) return "I don't have that memory yet.";
        
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
        if (!jokes) return "I don't know any jokes yet.";
        
        if (query.includes('chapati')) {
            const joke = jokes.find(j => j.name.includes('chapati'));
            return joke ? joke.story : "They have a chapati joke from their first meeting.";
        }
        if (query.includes('politics 101') || query.includes('skip class')) {
            const joke = jokes.find(j => j.name.includes('Politics'));
            return joke ? joke.story : "Politics 101 is their code for skipping class together.";
        }
        if (query.includes('umbrella')) {
            const joke = jokes.find(j => j.name.includes('umbrella'));
            return joke ? joke.story : "They still argue about whose umbrella started knocking during their rainy walk.";
        }
        
        return "They have so many inside jokes! Ask about the chapati incident, Politics 101, or the umbrella wars.";
    }

    handleStoryQuery(query) {
        const stories = this.memory.stories;
        if (!stories) return "I don't have any stories yet.";
        
        if (query.includes('met') || query.includes('first')) {
            const story = stories.find(s => s.category === 'origin');
            return story ? story.content : this.memory.first_meeting.story;
        }
        if (query.includes('food court') || query.includes('second semester')) {
            const story = stories.find(s => s.category === 'development');
            return story ? story.content : "They spent second semester together in the Food Court, sharing headphones and teaching each other.";
        }
        if (query.includes('rain') || query.includes('confession')) {
            const story = stories.find(s => s.category === 'milestone');
            return story ? story.content : this.memory.rainy_evening_confession.story;
        }
        
        return "I have so many stories about them! Would you like to hear how they met, about their Food Court days, or the rainy confession?";
    }

    getRandomResponse(array) {
        if (!array || array.length === 0) return "I'm not sure what to say.";
        return array[Math.floor(Math.random() * array.length)];
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ==================== UI METHODS ====================
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
        
        // Add to conversation history
        this.conversationHistory.push({ sender, text, timestamp: Date.now() });
    }

    speak(text, callback) {
        if (!this.synthesis || !text) return;
        
        this.synthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = this.config.voice?.output?.rate || 0.95;
        utterance.pitch = this.config.voice?.output?.pitch || 1.0;
        utterance.volume = this.config.voice?.output?.volume || 1.0;
        
        if (this.currentVoice) {
            utterance.voice = this.currentVoice;
        }
        
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
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.pingu = new PinguAI();
});