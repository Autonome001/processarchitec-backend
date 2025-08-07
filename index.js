const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Initialize Anthropic (Claude)
const anthropic = process.env.ANTHROPIC_API_KEY ? {
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: 'https://api.anthropic.com',
  apiVersion: '2023-06-01'
} : null;

app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://processarchitec.com',
    'https://processarchitec.netlify.app',
    process.env.FRONTEND_URL
  ]
}));

app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ProcessArchitec Backend Running' });
});

// Claude API call function
async function callClaude(prompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-3-opus-20240229',
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      system: `You are an expert n8n workflow automation specialist. You MUST return ONLY valid JSON that can be imported directly into n8n. 
      No explanations, no markdown, no text before or after - ONLY the JSON object.
      The JSON must include: name, nodes (array), connections (object), and settings (object).
      Every node must have: id, name, type, position, and parameters.`
    })
  });

  if (!response.ok) {
    throw new Error(`Claude API error: ${response.status}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

// Main workflow generation endpoint
app.post('/api/generate-workflow', async (req, res) => {
  try {
    const { businessContext, workflowDescription } = req.body;
    
    // Create a detailed prompt
    const prompt = `Create a production-ready n8n workflow JSON for this requirement:

Business Context:
- Business: ${businessContext.businessDescription || 'Not specified'}
- Unique Value: ${businessContext.uniqueValue || 'Not specified'}
- Revenue Model: ${businessContext.revenueModel || 'Not specified'}
- Ideal Customer: ${businessContext.idealCustomer || 'Not specified'}
- Current Tools: ${businessContext.disconnectedTools || 'Not specified'}
- Pain Points: ${businessContext.wishAutomated || businessContext.painPoints || 'Not specified'}
- Manual Tasks Time: ${businessContext.repetitiveTime || 'Not specified'}
- Error Points: ${businessContext.errorPoints || 'Not specified'}

Specific Workflow Requirement:
${workflowDescription}

Create a complete n8n workflow that:
1. Uses appropriate trigger nodes (webhook, schedule, or specific app triggers)
2. Includes all necessary processing nodes
3. Has proper error handling
4. Includes relevant integrations based on the tools mentioned
5. Is production-ready and can be imported directly into n8n

Return ONLY the JSON object with this structure:
{
  "name": "workflow name",
  "nodes": [...],
  "connections": {...},
  "settings": {...}
}`;

    let workflow;
    
    // Try Claude first if available
    if (process.env.ANTHROPIC_API_KEY) {
      console.log('Using Claude for generation...');
      try {
        const claudeResponse = await callClaude(prompt);
        // Clean the response (remove any markdown or extra text)
        const jsonMatch = claudeResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          workflow = JSON.parse(jsonMatch[0]);
        } else {
          workflow = JSON.parse(claudeResponse);
        }
      } catch (claudeError) {
        console.error('Claude error, falling back to OpenAI:', claudeError.message);
        // Fall back to OpenAI
        const completion = await openai.chat.completions.create({
          model: "gpt-4-turbo-preview",
          messages: [
            {
              role: "system",
              content: "You are an n8n workflow expert. Return only valid JSON, no explanations or markdown."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.7,
          max_tokens: 3000,
          response_format: { type: "json_object" }
        });
        workflow = JSON.parse(completion.choices[0].message.content);
      }
    } else {
      // Use OpenAI if Claude not configured
      console.log('Using OpenAI for generation...');
      const completion = await openai.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: [
          {
            role: "system",
            content: "You are an n8n workflow expert. Return only valid JSON, no explanations or markdown."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 3000,
        response_format: { type: "json_object" }
      });
      workflow = JSON.parse(completion.choices[0].message.content);
    }

    // Ensure workflow has required fields
    workflow.name = workflow.name || `ProcessArchitec Workflow - ${Date.now()}`;
    workflow.nodes = workflow.nodes || [];
    workflow.connections = workflow.connections || {};
    workflow.settings = workflow.settings || { executionOrder: "v1" };
    
    // Add position to nodes if missing
    workflow.nodes = workflow.nodes.map((node, index) => ({
      ...node,
      position: node.position || [250 + (index * 250), 300]
    }));

    console.log('Successfully generated workflow');
    res.json(workflow);
    
  } catch (error) {
    console.error('Error generating workflow:', error);
    
    // Return a comprehensive fallback workflow
    const fallbackWorkflow = {
      name: `ProcessArchitec Workflow - ${Date.now()}`,
      nodes: [
        {
          id: "webhook_trigger",
          name: "Webhook Trigger",
          type: "n8n-nodes-base.webhook",
          position: [250, 300],
          parameters: {
            path: "process-trigger",
            method: "POST",
            responseMode: "onReceived",
            responseData: "allEntries"
          }
        },
        {
          id: "set_data",
          name: "Set Data",
          type: "n8n-nodes-base.set",
          position: [500, 300],
          parameters: {
            values: {
              string: [
                {
                  name: "status",
                  value: "processing"
                },
                {
                  name: "timestamp",
                  value: "={{$now}}"
                }
              ]
            }
          }
        },
        {
          id: "http_request",
          name: "Process Data",
          type: "n8n-nodes-base.httpRequest",
          position: [750, 300],
          parameters: {
            url: "https://api.example.com/process",
            method: "POST",
            sendBody: true,
            bodyParameters: {
              parameters: [
                {
                  name: "data",
                  value: "={{$json}}"
                }
              ]
            }
          }
        },
        {
          id: "respond",
          name: "Respond to Webhook",
          type: "n8n-nodes-base.respondToWebhook",
          position: [1000, 300],
          parameters: {
            respondWith: "json",
            responseBody: '{"success": true, "message": "Workflow completed successfully"}'
          }
        }
      ],
      connections: {
        "webhook_trigger": {
          main: [[{ node: "set_data", type: "main", index: 0 }]]
        },
        "set_data": {
          main: [[{ node: "http_request", type: "main", index: 0 }]]
        },
        "http_request": {
          main: [[{ node: "respond", type: "main", index: 0 }]]
        }
      },
      settings: {
        executionOrder: "v1"
      }
    };
    
    res.json(fallbackWorkflow);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('AI Providers configured:', {
    openai: !!process.env.OPENAI_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY
  });
});