// Pingu - Voice + Text Companion
// Enhanced findResponse for Bonz & Ella's memory
findResponse(question) {
    const q = question.toLowerCase().trim();
    
    // 1️⃣ Check FAQ mappings first (fastest)
    if (this.memory.faq_mappings && this.memory.faq_mappings[q]) {
        const path = this.memory.faq_mappings[q].split('.');
        let result = this.memory;
        for (let key of path) {
            // Handle array indices
            if (key.includes('[')) {
                const arrayKey = key.split('[')[0];
                const index = parseInt(key.split('[')[1]);
                result = result[arrayKey][index];
            } else {
                result = result[key];
            }
        }
        if (result) return this.formatResponse(result);
    }
    
    // 2️⃣ Search specific_facts array (perfect for direct Q&A)
    for (let fact of this.memory.specific_facts) {
        for (let keyword of fact.keywords) {
            if (q.includes(keyword)) {
                return this.formatResponse(fact.fact);
            }
        }
    }
    
    // 3️⃣ Search first_meeting section
    if (q.includes('first') || q.includes('meet') || q.includes('saw')) {
        if (q.includes('where')) return this.memory.first_meeting.location;
        if (q.includes('when') || q.includes('date')) return this.memory.first_meeting.date;
        if (q.includes('hold') || q.includes('carry')) return this.memory.first_meeting.details.what_she_was_holding;
        if (q.includes('late')) return this.memory.first_meeting.details.what_he_was_late_for;
        if (q.includes('talk')) return this.memory.first_meeting.details.what_they_talked_about.join(' and ');
        return this.memory.first_meeting.story;
    }
    
    // 4️⃣ Search relationship_development section
    if (q.includes('second semester') || q.includes('food court') || q.includes('headphones')) {
        if (q.includes('where')) return this.memory.relationship_development.second_semester.shared_spot;
        if (q.includes('explain')) return this.memory.relationship_development.second_semester.bonz_explained;
        if (q.includes('correct')) return this.memory.relationship_development.second_semester.ella_corrected;
        if (q.includes('argue') || q.includes('lecturer')) return this.memory.relationship_development.second_semester.what_he_loves_about_her;
    }
    
    // 5️⃣ Search rainy evening confession
    if (q.includes('rain') || q.includes('shelter') || q.includes('confess') || q.includes('corridor')) {
        if (q.includes('where')) return this.memory.rainy_evening_confession.location;
        if (q.includes('building')) return this.memory.rainy_evening_confession.building;
        if (q.includes('say') || q.includes('bonz said')) return this.memory.rainy_evening_confession.what_bonz_said;
        if (q.includes('respond')) return this.memory.rainy_evening_confession.how_ella_responded;
        if (q.includes('firework')) return this.memory.rainy_evening_confession.fireworks ? "Yes" : "No, they didn't need fireworks";
        if (q.includes('walk back')) return this.memory.rainy_evening_confession.walk_back;
        if (q.includes('umbrella')) return this.memory.rainy_evening_confession.umbrellas;
        if (q.includes('smil')) return this.memory.rainy_evening_confession.were_they_smiling ? "Yes, they were smiling" : "No";
        return this.memory.rainy_evening_confession.story;
    }
    
    // 6️⃣ Search personality traits
    if (q.includes('tea') || q.includes('sugar')) {
        return "Bonz remembers that Ella's tea has no sugar";
    }
    if (q.includes('tap') || q.includes('pen') || q.includes('nervous')) {
        return "Ella taps her pen when she's nervous";
    }
    if (q.includes('remember small things')) {
        return "Bonz remembers small things, like Ella's tea preference and how she taps her pen when nervous";
    }
    
    // 7️⃣ Check for university/tree/chapati questions
    if (q.includes('university')) return `They attend ${this.memory.couple.university}`;
    if (q.includes('tree') && q.includes('jacaranda')) return "The tree near the library was a jacaranda tree";
    if (q.includes('chapati')) return "Ella was holding a chapati wrapped in paper";
    if (q.includes('politics 101')) return "Politics 101 is the class Bonz was late for";
    
    // 8️⃣ If nothing found, use fallback
    const fallbacks = this.memory.fallback_responses.no_memory;
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

// Helper to format responses nicely
formatResponse(response) {
    if (Array.isArray(response)) {
        return response.join(' and ');
    }
    if (typeof response === 'boolean') {
        return response ? "Yes" : "No";
    }
    return response;
}
