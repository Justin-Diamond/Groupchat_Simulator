const express = require('express');
const path = require('path');
const fetch = require('node-fetch');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.post('/login', (req, res) => {
    const enteredPassword = req.body.password;
    const secretPassword = process.env.SECRET_PASSWORD;

    if (enteredPassword === secretPassword) {
        res.status(200).json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Incorrect password' });
    }
});

app.post('/generate-response', async (req, res) => {
    const { prompt } = req.body;
    const apiKey = process.env.OPENAI_API_KEY;
    const assistantId = process.env.OPENAI_ASSISTANT_ID;

    // Log the system prompt
    console.log('System Prompt:', prompt);

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
                messages: [{ role: "user", content: prompt }]
            })
        });

        if (!createThreadResponse.ok) {
            const errorData = await createThreadResponse.json();
            console.error('Thread creation error:', errorData);
            return res.status(createThreadResponse.status).json({ error: 'Failed to create thread', details: errorData });
        }

        const thread = await createThreadResponse.json();
        console.log('Thread created:', thread);

        // Step 2: Run the assistant
        const runResponse = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'OpenAI-Beta': 'assistants=v1'
            },
            body: JSON.stringify({
                assistant_id: assistantId
            })
        });

        if (!runResponse.ok) {
            const errorData = await runResponse.json();
            console.error('Run creation error:', errorData);
            return res.status(runResponse.status).json({ error: 'Failed to run assistant', details: errorData });
        }

        const run = await runResponse.json();
        console.log('Run created:', run);

        // Step 3: Polling for completion
        let runStatus = await checkRunStatus(thread.id, run.id, apiKey);
        while (runStatus.status !== 'completed') {
            await new Promise(resolve => setTimeout(resolve, 1000));
            runStatus = await checkRunStatus(thread.id, run.id, apiKey);
        }

        // Step 4: Retrieve the messages
        const messagesResponse = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'OpenAI-Beta': 'assistants=v1'
            }
        });

        if (!messagesResponse.ok) {
            const errorData = await messagesResponse.json();
            console.error('Messages retrieval error:', errorData);
            return res.status(messagesResponse.status).json({ error: 'Failed to retrieve messages', details: errorData });
        }

        const messages = await messagesResponse.json();
        console.log('Messages retrieved:', messages);

        res.json({ response: messages.data[0].content[0].text.value });

    } catch (error) {
        console.error('Error:', error.stack || error);
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
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
