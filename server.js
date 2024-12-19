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
        // Step 1: Start Assistant Run
        const runResponse = await fetch(`https://api.openai.com/v2/assistants/${assistantId}/runs`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'OpenAI-Beta': 'assistants=v2'
            },
            body: JSON.stringify({
                input: {
                    content: [{ type: "text", text: { value: prompt } }]
                },
                tool_resources: {
                    file_search: { vector_store_ids: [] },
                    code_interpreter: { file_ids: [] }
                }
            })
        });

        if (!runResponse.ok) {
            const errorText = await runResponse.text();
            throw new Error(`Run initiation failed: ${errorText}`);
        }

        const runData = await runResponse.json();
        const runId = runData.id;
        console.log('Run Started:', runId);

        // Step 2: Poll for Completion
        let runStatus = 'in_progress';
        while (runStatus === 'in_progress' || runStatus === 'queued') {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const statusResponse = await fetch(`https://api.openai.com/v2/assistants/${assistantId}/runs/${runId}`, {
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

        // Step 3: Retrieve Assistant Response
        const resultResponse = await fetch(`https://api.openai.com/v2/assistants/${assistantId}/runs/${runId}/result`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'OpenAI-Beta': 'assistants=v2'
            }
        });

        if (!resultResponse.ok) throw new Error('Failed to retrieve run result.');

        const resultData = await resultResponse.json();
        const responseContent = resultData.result.content[0]?.text?.value || 'No content received.';

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
