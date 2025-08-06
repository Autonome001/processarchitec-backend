const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://processarchitec.netlify.app',
    process.env.FRONTEND_URL
  ]
}));

app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'ProcessArchitec Backend Running' });
});

// Workflow generation endpoint
app.post('/api/generate-workflow', async (req, res) => {
  try {
    const { businessContext, workflowDescription } = req.body;
    
    // For now, return a sample workflow
    // TODO: Add OpenAI/Claude integration here
    const workflow = {
      name: "Generated Workflow - " + Date.now(),
      nodes: [
        {
          id: "start-node",
          name: "Start",
          type: "n8n-nodes-base.start",
          position: [250, 300],
          parameters: {}
        },
        {
          id: "webhook",
          name: "Webhook",
          type: "n8n-nodes-base.webhook",
          position: [500, 300],
          parameters: {
            path: "workflow-trigger",
            method: "POST"
          }
        }
      ],
      connections: {
        "start-node": {
          main: [[{
            node: "webhook",
            type: "main",
            index: 0
          }]]
        }
      }
    };
    
    console.log('Generated workflow for:', workflowDescription);
    res.json(workflow);
    
  } catch (error) {
    console.error('Error generating workflow:', error);
    res.status(500).json({ error: 'Failed to generate workflow' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});