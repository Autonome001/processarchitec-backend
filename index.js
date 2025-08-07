const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://processarchitec.com',
    'https://processarchitec.netlify.app',
    process.env.FRONTEND_URL
  ]
}));

app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ProcessArchitec Backend Running', ai: !!process.env.ANTHROPIC_API_KEY });
});

// Main workflow generation endpoint
app.post('/api/generate-workflow', async (req, res) => {
  try {
    const { businessContext, workflowDescription } = req.body;
    
    console.log('Received request:', { 
      hasContext: !!businessContext, 
      description: workflowDescription?.substring(0, 100) 
    });

    // Build comprehensive context
    const contextSummary = `
Business: ${businessContext?.businessDescription || 'Not specified'}
Tools in use: ${businessContext?.disconnectedTools || businessContext?.currentTools || 'Not specified'}  
Automation needs: ${businessContext?.wishAutomated || 'Not specified'}
Pain points: ${businessContext?.errorPoints || 'Not specified'}
    `.trim();

    const prompt = `You are an n8n workflow expert. Create a sophisticated n8n workflow JSON.

CONTEXT:
${contextSummary}

REQUIREMENT:
${workflowDescription}

Generate a complete n8n workflow with:
1. Appropriate trigger (webhook, schedule, email, etc based on the requirement)
2. All necessary processing nodes
3. Real integrations mentioned in the requirement
4. Proper error handling nodes

Return ONLY valid JSON that can be imported to n8n. The response must be a JSON object with:
- name: descriptive workflow name
- nodes: array of node objects (each with id, name, type, position, parameters)
- connections: object defining how nodes connect
- settings: object with executionOrder

Make it sophisticated and production-ready, not a simple example.`;

    let workflow;

    // Use Claude if available
    if (process.env.ANTHROPIC_API_KEY) {
      console.log('Using Claude...');
      
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-sonnet-20240229', // Using Sonnet for faster response
          max_tokens: 4000,
          temperature: 0.7,
          messages: [{
            role: 'user',
            content: prompt
          }]
        })
      });

      if (response.ok) {
        const data = await response.json();
        const text = data.content[0].text;
        
        // Extract JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          workflow = JSON.parse(jsonMatch[0]);
          console.log('Claude generated workflow successfully');
        }
      } else {
        console.error('Claude API error:', response.status);
        throw new Error('Claude API failed');
      }
    }

    // If no workflow yet, use OpenAI
    if (!workflow && process.env.OPENAI_API_KEY) {
      console.log('Using OpenAI...');
      const OpenAI = require('openai');
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      
      const completion = await openai.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: [
          { role: "system", content: "You are an n8n expert. Return only valid JSON." },
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 3000,
        response_format: { type: "json_object" }
      });
      
      workflow = JSON.parse(completion.choices[0].message.content);
      console.log('OpenAI generated workflow successfully');
    }

    // If still no workflow, create a better fallback
    if (!workflow) {
      console.log('Using intelligent fallback...');
      
      // Parse the description to create a more relevant workflow
      const isEmailWorkflow = workflowDescription.toLowerCase().includes('email');
      const isScheduled = workflowDescription.toLowerCase().includes('daily') || 
                         workflowDescription.toLowerCase().includes('schedule');
      const needsGoogleSheets = workflowDescription.toLowerCase().includes('sheet') || 
                               workflowDescription.toLowerCase().includes('spreadsheet');
      
      workflow = {
        name: `ProcessArchitec - ${workflowDescription.substring(0, 50)}`,
        nodes: [
          {
            id: "trigger",
            name: isEmailWorkflow ? "Email Trigger" : isScheduled ? "Schedule Trigger" : "Webhook",
            type: isEmailWorkflow ? "n8n-nodes-base.emailReadImap" : 
                  isScheduled ? "n8n-nodes-base.scheduleTrigger" : 
                  "n8n-nodes-base.webhook",
            position: [250, 300],
            parameters: isEmailWorkflow ? {
              mailbox: "INBOX",
              postProcessAction: "nothing",
              options: {}
            } : isScheduled ? {
              rule: { interval: [{ field: "hours", hoursInterval: 24 }] }
            } : {
              path: "workflow-trigger",
              method: "POST"
            }
          },
          {
            id: "process",
            name: "Process Data",
            type: "n8n-nodes-base.code",
            position: [500, 300],
            parameters: {
              jsCode: `// Process the incoming data\nconst items = $input.all();\nreturn items.map(item => ({\n  json: {\n    ...item.json,\n    processed: true,\n    timestamp: new Date().toISOString()\n  }\n}));`
            }
          }
        ],
        connections: {
          "trigger": {
            main: [[{ node: "process", type: "main", index: 0 }]]
          }
        },
        settings: { executionOrder: "v1" }
      };

      // Add Google Sheets if mentioned
      if (needsGoogleSheets) {
        workflow.nodes.push({
          id: "sheets",
          name: "Google Sheets",
          type: "n8n-nodes-base.googleSheets",
          position: [750, 300],
          parameters: {
            operation: "append",
            sheetId: "your-sheet-id",
            range: "A:Z"
          }
        });
        workflow.connections["process"] = {
          main: [[{ node: "sheets", type: "main", index: 0 }]]
        };
      }
    }

    // Ensure valid structure
    workflow.name = workflow.name || `ProcessArchitec Workflow - ${Date.now()}`;
    workflow.settings = workflow.settings || { executionOrder: "v1" };
    
    res.json(workflow);
    
  } catch (error) {
    console.error('Generation error:', error);
    res.status(500).json({ 
      error: 'Generation failed', 
      details: error.message,
      hasAI: !!process.env.ANTHROPIC_API_KEY || !!process.env.OPENAI_API_KEY
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('AI configured:', {
    claude: !!process.env.ANTHROPIC_API_KEY,
    openai: !!process.env.OPENAI_API_KEY
  });
});