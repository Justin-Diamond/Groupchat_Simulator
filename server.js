const express = require('express');
const session = require('express-session');
const path = require('path');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Session middleware
app.use(
    session({
        secret: process.env.SESSION_SECRET || 'your_session_secret',
        resave: false,
        saveUninitialized: true,
        cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true },
    })
);

const MAX_HISTORY = 5;

// Middleware for session management
app.use((req, res, next) => {
    if (!req.session.messageHistory) {
        req.session.messageHistory = [];
    }
    next();
});

// Helper to check run status
async function checkRunStatus(threadId, runId, apiKey) {
    const response = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'OpenAI-Beta': 'assistants=v2',
        },
    });
    if (!response.ok) throw new Error('Failed to check run status.');
    return await response.json();
}

// Endpoint to generate report
app.post('/generate-report', async (req, res) => {
    if (!req.session.authenticated) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { prompt } = req.body;
    const apiKey = process.env.OPENAI_API_KEY;
    const assistantId = process.env.OPENAI_ASSISTANT_ID;

    // Add prompt to history and manage session context
    req.session.messageHistory.push(prompt);
    if (req.session.messageHistory.length > MAX_HISTORY) {
        req.session.messageHistory.shift();
    }

    try {
        // Step 1: Create thread
        const threadResponse = await fetch('https://api.openai.com/v1/threads', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'OpenAI-Beta': 'assistants=v2',
            },
            body: JSON.stringify({}),
        });

        if (!threadResponse.ok) throw new Error('Failed to create thread.');
        const threadData = await threadResponse.json();
        const threadId = threadData.id;

        // Step 2: Add message to thread
        await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'OpenAI-Beta': 'assistants=v2',
            },
            body: JSON.stringify({ role: 'user', content: req.session.messageHistory.join('\n') }),
        });

        // Step 3: Start assistant run
        const runResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'OpenAI-Beta': 'assistants=v2',
            },
            body: JSON.stringify({
                assistant_id: assistantId,
                tool_resources: {}, // Add resources if applicable
            }),
        });

        if (!runResponse.ok) throw new Error('Failed to start assistant run.');
        const runData = await runResponse.json();
        const runId = runData.id;

        // Step 4: Poll for run completion
        let runStatus = 'in_progress';
        while (runStatus === 'in_progress' || runStatus === 'queued') {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            const statusData = await checkRunStatus(threadId, runId, apiKey);
            runStatus = statusData.status;
            if (statusData.last_error) {
                throw new Error(`Run failed: ${statusData.last_error.message}`);
            }
        }

        // Step 5: Retrieve assistant response
        const messagesResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'OpenAI-Beta': 'assistants=v2',
            },
        });

        if (!messagesResponse.ok) throw new Error('Failed to retrieve messages.');
        const messagesData = await messagesResponse.json();
        const assistantMessage = messagesData.data.find((msg) => msg.role === 'assistant');
        const responseContent = assistantMessage?.content[0]?.text?.value || 'No response received.';

        res.json({ response: responseContent });
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Login endpoint
app.post('/login', (req, res) => {
    const { password } = req.body;
    if (password === process.env.SECRET_PASSWORD) {
        req.session.authenticated = true;
        req.session.messageHistory = [];
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false });
    }
});

// Context clearing
app.post('/clear-context', (req, res) => {
    req.session.messageHistory = [];
    res.json({ success: true });
});

// Start server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
