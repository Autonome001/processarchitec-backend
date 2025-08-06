const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize OpenAI (we'll use GPT-4 for now, can switch to Claude later)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

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

// Main workflow generation endpoint
app.post('/api/generate-workflow', async (req, res) => {
  try {
    const { businessContext, workflowDescription } = req.body;
    
    // Create a detailed prompt for the AI
    const prompt = `You are an expert n8n workflow automation specialist. Create a production-ready n8n workflow JSON based on the following requirements:

Business Context:
- Business: ${businessContext.businessDescription}
- Current Tools: ${businessContext.currentTools || 'Not specified'}
- Pain Points: ${businessContext.painPoints || businessContext.wishAutomated}
- Repetitive Tasks: ${businessContext.repetitiveTime} spent on manual tasks

Workflow Requirement:
${workflowDescription}

Generate a complete n8n workflow JSON that includes:
1. Appropriate trigger node(s)
2. Processing nodes for the business logic
3. Integration nodes for mentioned tools
4. Error handling where appropriate
5. Proper connections between nodes

Return ONLY valid JSON in n8n format with nodes and connections. Include realistic node configurations.
The JSON must be valid and importable directly into n8n.`;

    // Call OpenAI
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

    // Parse the AI response
    let workflow;
    try {
      const aiResponse = completion.choices[0].message.content;
      workflow = JSON.parse(aiResponse);
    } catch (parseError) {
      // Fallback to a basic workflow if parsing fails
      workflow = generateBasicWorkflow(workflowDescription);
    }

    // Add metadata
    workflow.name = workflow.name || `Generated Workflow - ${Date.now()}`;
    workflow.settings = workflow.settings || {
      executionOrder: "v1"
    };

    console.log('Generated workflow for:', workflowDescription);
    res.json(workflow);
    
  } catch (error) {
    console.error('Error generating workflow:', error);
    
    // Return a basic workflow as fallback
    const fallbackWorkflow = generateBasicWorkflow(req.body.workflowDescription);
    res.json(fallbackWorkflow);
  }
});

// Helper function for basic workflow generation
function generateBasicWorkflow(description) {
  return {
    name: `Workflow - ${Date.now()}`,
    nodes: [
      {
        id: "start-node",
        name: "Start",
        type: "n8n-nodes-base.start",
        position: [250, 300],
        parameters: {}
      },
      {
        id: "webhook-node",
        name: "Webhook Trigger",
        type: "n8n-nodes-base.webhook",
        position: [500, 300],
        parameters: {
          path: "workflow-webhook",
          method: "POST",
          responseMode: "onReceived",
          responseData: "allEntries"
        }
      },
      {
        id: "http-request",
        name: "HTTP Request",
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
      }
    ],
    connections: {
      "webhook-node": {
        main: [
          [
            {
              node: "http-request",
              type: "main",
              index: 0
            }
          ]
        ]
      }
    },
    settings: {
      executionOrder: "v1"
    }
  };
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});