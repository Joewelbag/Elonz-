// ULTRA SIMPLE VOICE TEST - Add this to a separate HTML file to test
function testVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
        alert('Voice not supported');
        return;
    }
    
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    
    recognition.onstart = () => console.log('Started');
    recognition.onresult = (e) => console.log('You said:', e.results[0][0].transcript);
    recognition.onerror = (e) => console.log('Error:', e.error);
    
    // Must be called from user gesture
    recognition.start();
}

// Add to your mic button click:
// testVoice();
