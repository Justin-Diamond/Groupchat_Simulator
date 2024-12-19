const express = require('express');
const path = require('path');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Endpoint to handle report generation
app.post('/generate-report', async (req, res) => {
    const { prompt } = req.body;
    const apiKey = process.env.OPENAI_API_KEY;
    const assistantId = process.env.OPENAI_ASSISTANT_ID;

    try {
        // Step 1: Create a Thread
        const threadResponse = await fetch('https://api.openai.com/v1/threads', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'OpenAI-Beta': 'assistants=v2'
            },
            body: JSON.stringify({
                metadata: {},
                tools: [
                    { type: "file_search" },
                    { type: "code_interpreter" }
                ],
                tool_resources: {
                    file_search: {
                        vector_store_ids: [] // Add vector store IDs if applicable
                    },
                    code_interpreter: {
                        file_ids: [] // Add file IDs if using a code interpreter
                    }
                }
            })
        });

        if (!threadResponse.ok) {
            const errorText = await threadResponse.text();
            throw new Error(`Thread creation failed: ${errorText}`);
        }

        const threadData = await threadResponse.json();
        const threadId = threadData.id;
        console.log('Thread Created:', threadId);

        // Step 2: Add Message to Thread
        const messageResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'OpenAI-Beta': 'assistants=v2'
            },
            body: JSON.stringify({
                role: "user",
                content: [{ type: "text", text: { value: prompt } }]
            })
        });

        if (!messageResponse.ok) {
            const errorText = await messageResponse.text();
            throw new Error(`Message addition failed: ${errorText}`);
        }

        console.log('Message added to thread');

        // Step 3: Start Assistant Run
        const runResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'OpenAI-Beta': 'assistants=v2'
            },
            body: JSON.stringify({
                assistant_id: assistantId,
                tool_resources: {
                    file_search: { vector_store_ids: [] },
                    code_interpreter: { file_ids: [] }
                }
            })
        });

        if (!runResponse.ok) {
            const errorText = await runResponse.text();
            console.error('Run initiation failed:', errorText);
            throw new Error(`Run initiation failed: ${errorText}`);
        }

        const runData = await runResponse.json();
        const runId = runData.id;
        console.log('Run Started:', runId);

        // Step 4: Poll for Completion
        let runStatus = 'in_progress';
        while (runStatus === 'in_progress' || runStatus === 'queued') {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const statusResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'OpenAI-Beta': 'assistants=v2'
                }
            });

            if (!statusResponse.ok) throw new Error('Failed to fetch run status.');

            const statusData = await statusResponse.json();
            runStatus = statusData.status;

            if (statusData.last_error) {
                throw new Error(`Run failed: ${statusData.last_error.message}`);
            }
        }

        // Step 5: Retrieve Assistant Response
        const messagesResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'OpenAI-Beta': 'assistants=v2'
            }
        });

        if (!messagesResponse.ok) throw new Error('Failed to retrieve messages.');

        const messagesData = await messagesResponse.json();
        const assistantMessage = messagesData.data.find(msg => msg.role === 'assistant');
        const responseContent = assistantMessage?.content[0]?.text?.value || 'No content received.';

        res.json({ response: responseContent });
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
