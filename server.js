const express = require('express');
const session = require('express-session');
const path = require('path');
const fetch = require('node-fetch');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Session middleware
app.use(session({
    secret: process.env.SESSION_SECRET || 'your_session_secret',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: process.env.NODE_ENV === 'production' }
}));

const MAX_HISTORY = 5;

app.post('/login', (req, res) => {
    const enteredPassword = req.body.password;
    const secretPassword = process.env.SECRET_PASSWORD;

    if (enteredPassword === secretPassword) {
        req.session.authenticated = true;
        res.status(200).json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Incorrect password' });
    }
});

app.post('/generate-response', async (req, res) => {
    if (!req.session.authenticated) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { prompt } = req.body;
    const apiKey = process.env.OPENAI_API_KEY;
    const assistantId = process.env.OPENAI_ASSISTANT_ID;

    // Initialize message history for the session if it doesn't exist
    if (!req.session.messageHistory) {
        req.session.messageHistory = [];
    }

    // Add the new message to history
    req.session.messageHistory.push(prompt);
    if (req.session.messageHistory.length > MAX_HISTORY) {
        req.session.messageHistory.shift(); // Remove the oldest message if we exceed MAX_HISTORY
    }

    // Create a context-rich prompt
    const contextPrompt = req.session.messageHistory.join('\n');

    // Log the full context prompt
    console.log(`System Prompt for session ${req.session.id}:`, contextPrompt);

    try {
        // Step 1: Create a thread
        const createThreadResponse = await fetch('https://api.openai.com/v1/threads', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'OpenAI-Beta': 'assistants=v1'
            },
            body: JSON.stringify({
                messages: [{ role: "user", content: contextPrompt }]
            })
        });

        if (!createThreadResponse.ok) {
            const errorData = await createThreadResponse.json();
            console.error('Thread creation error:', errorData);
            return res.status(createThreadResponse.status).json({ error: 'Failed to create thread', details: errorData });
        }

        const thread = await createThreadResponse.json();
        console.log(`Thread created for session ${req.session.id}:`, thread);

        // ... (rest of the generate-response code remains the same) ...

    } catch (error) {
        console.error(`Error for session ${req.session.id}:`, error.stack || error);
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
});

app.post('/clear-context', (req, res) => {
    if (!req.session.authenticated) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    req.session.messageHistory = []; // Clear the message history for this session
    console.log(`Context cleared for session ${req.session.id}`);
    res.json({ success: true });
});

// Helper function to check the run status
async function checkRunStatus(threadId, runId, apiKey) {
    const response = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'OpenAI-Beta': 'assistants=v1'
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to check run status: ${response.status} ${response.statusText}`);
    }

    return await response.json();
}

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
