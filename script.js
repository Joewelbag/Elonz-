const micBtn = document.getElementById("micBtn");
const statusText = document.getElementById("statusText");
const chatHistory = document.getElementById("chatHistory");
const textInput = document.getElementById("textInput");
const sendBtn = document.getElementById("sendBtn");

let recognition;
let isListening = false;

// Speech Recognition Setup
if ("webkitSpeechRecognition" in window) {
    recognition = new webkitSpeechRecognition();
    recognition.continuous = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
        const transcript = event.results[event.results.length - 1][0].transcript;
        addMessage(transcript, "user");
        handleResponse(transcript);
    };

    recognition.onend = () => {
        if (isListening) recognition.start();
    };
}

// Mic button
micBtn.addEventListener("click", () => {
    if (!recognition) {
        alert("Speech recognition not supported");
        return;
    }

    if (!isListening) {
        recognition.start();
        isListening = true;
        micBtn.classList.add("listening");
        statusText.innerText = "listening...";
    } else {
        recognition.stop();
        isListening = false;
        micBtn.classList.remove("listening");
        statusText.innerText = "tap to speak";
    }
});

// Send text
sendBtn.addEventListener("click", () => {
    const text = textInput.value;
    if (!text) return;

    addMessage(text, "user");
    handleResponse(text);
    textInput.value = "";
});

// Add chat message
function addMessage(text, sender) {
    chatHistory.classList.add("visible");

    const msg = document.createElement("div");
    msg.className = `message ${sender}`;

    msg.innerHTML = `
        <div class="message-avatar">${sender === "user" ? "🧑" : "🐧"}</div>
        <div class="message-content">${text}</div>
    `;

    chatHistory.appendChild(msg);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

// Simple AI response + memory
function handleResponse(input) {
    let response = "I’m learning...";

    if (input.toLowerCase().includes("hello")) {
        response = "Hey! I'm Pingu 🐧";
    }

    if (input.toLowerCase().includes("your name")) {
        response = "I am Pingu, your voice assistant.";
    }

    if (input.toLowerCase().includes("remember")) {
        saveMemory(input);
        response = "Got it, I’ll remember that.";
    }

    addMessage(response, "bot");
    speak(response);
}

// Speech output
function speak(text) {
    const speech = new SpeechSynthesisUtterance(text);
    speech.lang = "en-US";
    speechSynthesis.speak(speech);
}

// Save memory locally
function saveMemory(data) {
    let memory = JSON.parse(localStorage.getItem("pinguMemory")) || [];
    memory.push(data);
    localStorage.setItem("pinguMemory", JSON.stringify(memory));
}
