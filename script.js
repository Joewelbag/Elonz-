// Pingu - Voice + Text Companion
class PinguBot {
    constructor() {
        this.config = null;
        this.memory = null;
        this.session = {
            conversation: [],
            context: null,
            lastQuestion: null
        };
        this.recognition = null;
        this.synthesis = window.speechSynthesis;
        this.isListening = false;
        this.isSpeaking = false;
        this.textMode = false;
        
        this.init();
    }

    async init() {
        await this.loadData();
        this.setupVoiceRecognition();
        this.setupEventListeners();
        this.introducePingu();
    }

    async loadData() {
        try {
            // Load config
            const configRes = await fetch('config.json');
            this.config = await configRes.json();
            
            // Load memory (relationship data)
            const memoryRes = await fetch('memory.json');
            this.memory = await memoryRes.json();
            
            console.log('✅ Pingu loaded:', this.memory.bot_profile.name);
        } catch (error) {
            console.error('Failed to load Pingu data:', error);
        }
    }

    setupVoiceRecognition() {
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            this.recognition = new SpeechRecognition();
            this.recognition.continuous = false;
            this.recognition.interimResults = false;
            this.recognition.lang = 'en-US';
            
            this.recognition.onstart = () => {
                this.isListening = true;
                document.getElementById('micButton').classList.add('listening');
                document.getElementById('listeningAnimation').classList.add('active');
                document.getElementById('voiceHint').textContent = 'listening...';
            };
            
            this.recognition.onresult = (event) => {
                const command = event.results[0][0].transcript;
                this.processVoiceCommand(command);
            };
            
            this.recognition.onend = () => {
                this.isListening = false;
                document.getElementById('micButton').classList.remove('listening');
                document.getElementById('listeningAnimation').classList.remove('active');
                document.getElementById('voiceHint').textContent = 'tap to speak';
            };
            
            this.recognition.onerror = () => {
                this.speak("Sorry, I didn't catch that. Try again?");
                this.resetVoiceState();
            };
        } else {
            document.getElementById('voiceHint').textContent = 'voice not supported';
        }
    }

    setupEventListeners() {
        // Mic button
        document.getElementById('micButton').addEventListener('click', () => {
            this.startListening();
        });
        
        // Open text interface
        document.getElementById('openTextBtn').addEventListener('click', () => {
            this.toggleTextInterface();
        });
        
        // Close text interface
        document.getElementById('closeText').addEventListener('click', () => {
            this.toggleTextInterface();
        });
        
        // Send text message
        document.getElementById('sendButton').addEventListener('click', () => {
            this.sendTextMessage();
        });
        
        // Enter key in text input
        document.getElementById('textInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendTextMessage();
        });
    }

    introducePingu() {
        // Show greeting in bubble
        document.getElementById('botMessage').textContent = this.memory.bot_profile.greeting;
        
        // Speak greeting
        setTimeout(() => {
            this.speak(this.memory.bot_profile.greeting, () => {
                // After greeting, explain how it works
                setTimeout(() => {
                    const welcome = this.memory.bot_profile.welcome_message;
                    document.getElementById('botMessage').textContent = welcome;
                    this.speak(welcome);
                }, 1000);
            });
        }, 500);
    }

    startListening() {
        if (this.recognition && !this.isListening) {
            this.recognition.start();
        }
    }

    processVoiceCommand(command) {
        console.log('Heard:', command);
        
        // Show command in bubble
        document.getElementById('botMessage').textContent = `"${command}"`;
        
        // Check for text interface command
        if (command.toLowerCase().includes('open text') || 
            command.toLowerCase().includes('type mode') ||
            command.toLowerCase().includes('keyboard')) {
            this.toggleTextInterface(true);
            this.speak("Opening text interface for you");
            return;
        }
        
        // Process the question
        const response = this.findResponse(command);
        
        // Show and speak response
        setTimeout(() => {
            document.getElementById('botMessage').textContent = response;
            this.speak(response);
            
            // Save to session
            this.session.conversation.push({
                question: command,
                response: response,
                timestamp: new Date()
            });
        }, 500);
    }

    findResponse(question) {
        const q = question.toLowerCase();
        
        // Search in timeline
        for (let event of this.memory.timeline) {
            if (event.keywords.some(k => q.includes(k))) {
                return event.story;
            }
        }
        
        // Search in WhatsApp chats
        for (let chat of this.memory.whatsapp_chats) {
            if (chat.keywords.some(k => q.includes(k))) {
                return `I remember this message: "${chat.message}" from ${chat.date}`;
            }
        }
        
        // Search inside jokes
        for (let joke of this.memory.inside_jokes) {
            if (joke.trigger_words.some(w => q.includes(w))) {
                return joke.story;
            }
        }
        
        // Search stories
        for (let story of this.memory.stories) {
            if (q.includes(story.title.toLowerCase())) {
                return story.content.substring(0, 100) + "...";
            }
        }
        
        // Check favorites
        if (q.includes('favorite')) {
            if (q.includes('her') || q.includes('she')) {
                return `Her favorite food is ${this.memory.favorites.her.food.join(' and ')}`;
            }
            if (q.includes('his') || q.includes('he')) {
                return `His favorite food is ${this.memory.favorites.him.food.join(' and ')}`;
            }
        }
        
        // Default response
        const fallbacks = this.memory.fallback_responses;
        return fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }

    speak(text, callback) {
        if (!this.synthesis) return;
        
        // Cancel current speech
        this.synthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = this.config.voice_settings.rate;
        utterance.pitch = this.config.voice_settings.pitch;
        
        // Show speaking indicator
        document.getElementById('speakingIndicator').classList.add('active');
        this.isSpeaking = true;
        
        utterance.onend = () => {
            document.getElementById('speakingIndicator').classList.remove('active');
            this.isSpeaking = false;
            if (callback) callback();
        };
        
        this.synthesis.speak(utterance);
    }

    toggleTextInterface(force) {
        const textInterface = document.getElementById('textInterface');
        if (force === true) {
            textInterface.classList.add('active');
            this.textMode = true;
            document.getElementById('textInput').focus();
        } else {
            textInterface.classList.toggle('active');
            this.textMode = !this.textMode;
            if (this.textMode) {
                document.getElementById('textInput').focus();
            }
        }
    }

    sendTextMessage() {
        const input = document.getElementById('textInput');
        const message = input.value.trim();
        
        if (message) {
            // Show message in bubble
            document.getElementById('botMessage').textContent = `"${message}"`;
            
            // Get response
            const response = this.findResponse(message);
            
            // Show and speak response
            setTimeout(() => {
                document.getElementById('botMessage').textContent = response;
                this.speak(response);
            }, 500);
            
            // Clear input
            input.value = '';
        }
    }

    resetVoiceState() {
        this.isListening = false;
        document.getElementById('micButton').classList.remove('listening');
        document.getElementById('listeningAnimation').classList.remove('active');
        document.getElementById('voiceHint').textContent = 'tap to speak';
    }

    // WhatsApp Import Function
    importWhatsAppChat(exportedText) {
        // Simple parser for WhatsApp exports
        const lines = exportedText.split('\n');
        const chats = [];
        
        lines.forEach(line => {
            // Match pattern: [date, time] Sender: Message
            const match = line.match(/\[(.*?),\s(.*?)\]\s(.*?):\s(.*)/);
            if (match) {
                chats.push({
                    date: match[1],
                    time: match[2],
                    from: match[3].toLowerCase(),
                    message: match[4],
                    keywords: match[4].toLowerCase().split(' ')
                });
            }
        });
        
        return chats;
    }
}

// Initialize Pingu when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.pingu = new PinguBot();
});