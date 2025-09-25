//index file by Sapto
import express from 'express';
import { OpenAPIBackend } from 'openapi-backend';
import swaggerUi from 'swagger-ui-express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import yaml from 'js-yaml';
import { v4 as uuidv4 } from 'uuid';
import cors from 'cors'
import axios from 'axios';
import multer from 'multer';
import { handlers as dynamodbHandlers } from './lib/dynamodb-handlers.js';
import dotenv from 'dotenv';
import { exec } from 'child_process';

import { handlers as unifiedHandlers } from './lib/unified-handlers.js';
import { DynamoDBClient, DescribeTableCommand, CreateTableCommand } from '@aws-sdk/client-dynamodb';
import pkg from '@aws-sdk/lib-dynamodb';
const { DynamoDBDocumentClient } = pkg;

import { aiAgentHandler, aiAgentStreamHandler } from './lib/ai-agent-handlers.js';
import { agentSystem, handleLambdaCodegen } from './lib/llm-agent-system.js';
import { lambdaDeploymentManager } from './lib/lambda-deployment.js';
import { 
  cacheTableHandler, 
  getCachedDataHandler, 
  getPaginatedCacheKeysHandler,
  clearCacheHandler, 
  getCacheStatsHandler, 
  cacheHealthHandler,
  testCacheConnection,
  clearUnwantedOrderDataHandler,
  cleanupTimestampChunksHandler,
  getCachedDataInSequenceHandler,
  getActiveBulkCacheOperations,
  clearActiveBulkCacheOperations,
  getPendingCacheUpdates,
  clearPendingCacheUpdates
} from './utils/cache.js';

import { updateCacheFromLambdaHandler } from './utils/cache.js';

import {
  indexTableHandler,
  searchIndexHandler,
  listIndicesHandler,
  deleteIndicesHandler,
  searchHealthHandler,
  updateIndexingFromLambdaHandler
} from './utils/search-indexing.js';

import * as crud from './utils/crud.js';
import { execute } from './utils/execute.js';

import { mockDataAgent } from './lib/mock-data-agent.js';
import { fetchOrdersWithShortIdsHandler } from './utils/fetchOrder.js';
import brmhDrive from './utils/brmh-drive.js';
import { registerNotificationRoutes, notifyEvent, buildCrudEvent, buildUnifiedNamespaceEvent } from './utils/notifications.js';

import { 
  loginHandler,
  signupHandler,
  phoneSignupHandler,
  phoneLoginHandler,
  verifyPhoneHandler,
  resendOtpHandler,
  generateOAuthUrlHandler,
  exchangeTokenHandler,
  refreshTokenHandler,
  validateTokenHandler,
  debugPkceStoreHandler,
  logoutHandler,
  getLogoutUrlHandler
} from './utils/brmh-auth.js';

// Load environment variables
dotenv.config();
// Only log AWS config in development
if (process.env.NODE_ENV !== 'production') {
  console.log("AWS_ACCESS_KEY_ID", process.env.AWS_ACCESS_KEY_ID ? 'SET' : 'NOT SET');
  console.log("AWS_SECRET_ACCESS_KEY", process.env.AWS_SECRET_ACCESS_KEY ? 'SET' : 'NOT SET');
  console.log("AWS_REGION", process.env.AWS_REGION);
}



// Initialize DynamoDB client
const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

// Log AWS configuration status
console.log('AWS Configuration Check:', {
  hasAccessKeyId: !!process.env.AWS_ACCESS_KEY_ID ? 'Yes' : 'No',
  hasSecretKey: !!process.env.AWS_SECRET_ACCESS_KEY ? 'Yes' : 'No',
  hasRegion: !!process.env.AWS_REGION ? 'Yes' : 'No',
  nodeEnv: process.env.NODE_ENV
});

const app = express();
app.use(cors());
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));
app.use(express.text({ limit: '200mb' })); // Add support for text/plain

// Add specific middleware for cache endpoints to handle large responses
app.use('/cache/data', (req, res, next) => {
  // Remove any existing content-length header to let Express handle it
  res.removeHeader('content-length');
  next();
});

// Configure multer for file uploads (allow all types, up to 100MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }
});
// File storage configuration
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let prismProcess = null;

// Utility to check if a port is in use
async function checkPortInUse(port) {
  const net = await import('net');
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', err => (err.code === 'EADDRINUSE' ? resolve(true) : resolve(false)))
      .once('listening', () => tester.once('close', () => resolve(false)).close())
      .listen(port);
  });
}



// Start Prism mock server
app.post('/api/mock-server/start', async (req, res) => {
  const { port = 4010, specPath = './openapi.yaml' } = req.body;
  const isPortInUse = await checkPortInUse(port);
  if (isPortInUse) {
    return res.status(400).json({ error: `Port ${port} is already in use.` });
  }
  if (prismProcess) {
    return res.status(400).json({ error: 'Mock server already running.' });
  }
  console.log(`[MOCK SERVER] Starting Prism mock server on port ${port} with spec: ${specPath}`);
  prismProcess = exec(`npx prism mock ${specPath} -p ${port}`, (err) => {
    if (err) {
      console.error('Prism error:', err);
      prismProcess = null;
    }
  });
  res.json({ success: true, port });
});

// Stop Prism mock server
app.post('/api/mock-server/stop', (req, res) => {
  if (prismProcess) {
    prismProcess.kill();
    prismProcess = null;
    console.log('[MOCK SERVER] Prism mock server stopped.');
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'No mock server running.' });
  }
});

// Root route with animated landing page
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BRMH - AI • Tech • Project</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #0f0f23 0%, #1a1a2e 50%, #16213e 100%);
            height: 100vh;
            overflow: hidden;
            position: relative;
        }

        /* Animated background particles */
        .particles {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            z-index: 1;
        }

        .particle {
            position: absolute;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 50%;
            animation: float 6s ease-in-out infinite;
        }

        .particle:nth-child(1) { width: 4px; height: 4px; left: 10%; animation-delay: 0s; }
        .particle:nth-child(2) { width: 6px; height: 6px; left: 20%; animation-delay: 1s; }
        .particle:nth-child(3) { width: 3px; height: 3px; left: 30%; animation-delay: 2s; }
        .particle:nth-child(4) { width: 5px; height: 5px; left: 40%; animation-delay: 3s; }
        .particle:nth-child(5) { width: 4px; height: 4px; left: 50%; animation-delay: 4s; }
        .particle:nth-child(6) { width: 7px; height: 7px; left: 60%; animation-delay: 5s; }
        .particle:nth-child(7) { width: 3px; height: 3px; left: 70%; animation-delay: 0.5s; }
        .particle:nth-child(8) { width: 5px; height: 5px; left: 80%; animation-delay: 1.5s; }
        .particle:nth-child(9) { width: 4px; height: 4px; left: 90%; animation-delay: 2.5s; }

        @keyframes float {
            0%, 100% { transform: translateY(100vh) rotate(0deg); opacity: 0; }
            10% { opacity: 1; }
            90% { opacity: 1; }
            50% { transform: translateY(-100px) rotate(180deg); }
        }

        /* Neural network lines */
        .neural-lines {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 2;
        }

        .neural-line {
            position: absolute;
            background: linear-gradient(45deg, rgba(0, 255, 255, 0.3), rgba(255, 0, 255, 0.3));
            height: 1px;
            animation: neural-pulse 4s ease-in-out infinite;
        }

        .neural-line:nth-child(1) { top: 20%; left: 0; width: 30%; animation-delay: 0s; }
        .neural-line:nth-child(2) { top: 40%; right: 0; width: 25%; animation-delay: 1s; }
        .neural-line:nth-child(3) { top: 60%; left: 0; width: 40%; animation-delay: 2s; }
        .neural-line:nth-child(4) { top: 80%; right: 0; width: 35%; animation-delay: 3s; }

        @keyframes neural-pulse {
            0%, 100% { opacity: 0; transform: scaleX(0); }
            50% { opacity: 1; transform: scaleX(1); }
        }

        /* Main container */
        .container {
            position: relative;
            z-index: 10;
            height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            text-align: center;
            padding: 2rem;
        }

        /* Logo and title */
        .logo {
            font-size: clamp(4rem, 12vw, 8rem);
            font-weight: 900;
            background: linear-gradient(45deg, #00ffff, #ff00ff, #ffff00, #00ff00);
            background-size: 400% 400%;
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            animation: gradient-shift 3s ease-in-out infinite, logo-glow 2s ease-in-out infinite alternate;
            margin-bottom: 2rem;
            text-shadow: 0 0 30px rgba(0, 255, 255, 0.5);
            letter-spacing: -0.02em;
        }

        @keyframes gradient-shift {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
        }

        @keyframes logo-glow {
            0% { filter: drop-shadow(0 0 20px rgba(0, 255, 255, 0.3)); }
            100% { filter: drop-shadow(0 0 40px rgba(255, 0, 255, 0.5)); }
        }

        /* Subtitle */
        .subtitle {
            font-size: clamp(1.2rem, 3vw, 1.8rem);
            color: rgba(255, 255, 255, 0.8);
            margin-bottom: 3rem;
            font-weight: 300;
            letter-spacing: 0.1em;
            animation: fade-in-up 1s ease-out 0.5s both;
        }

        @keyframes fade-in-up {
            0% { opacity: 0; transform: translateY(30px); }
            100% { opacity: 1; transform: translateY(0); }
        }

        /* Feature cards */
        .features {
            display: flex;
            gap: 2rem;
            margin-bottom: 3rem;
            flex-wrap: wrap;
            justify-content: center;
        }

        .feature-card {
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 20px;
            padding: 2rem;
            min-width: 200px;
            animation: card-float 3s ease-in-out infinite;
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }

        .feature-card:nth-child(1) { animation-delay: 0s; }
        .feature-card:nth-child(2) { animation-delay: 0.5s; }
        .feature-card:nth-child(3) { animation-delay: 1s; }

        .feature-card:hover {
            transform: translateY(-10px);
            border-color: rgba(0, 255, 255, 0.5);
            box-shadow: 0 20px 40px rgba(0, 255, 255, 0.1);
        }

        .feature-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
            animation: shimmer 3s infinite;
        }

        @keyframes shimmer {
            0% { left: -100%; }
            100% { left: 100%; }
        }

        @keyframes card-float {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-10px); }
        }

        .feature-title {
            font-size: 1.2rem;
            font-weight: 600;
            color: #00ffff;
            margin-bottom: 0.5rem;
        }

        .feature-desc {
            font-size: 0.9rem;
            color: rgba(255, 255, 255, 0.7);
            line-height: 1.4;
        }

        /* Animated dots */
        .dots {
            display: flex;
            gap: 1rem;
            margin-top: 2rem;
        }

        .dot {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: linear-gradient(45deg, #00ffff, #ff00ff);
            animation: dot-pulse 2s ease-in-out infinite;
        }

        .dot:nth-child(1) { animation-delay: 0s; }
        .dot:nth-child(2) { animation-delay: 0.3s; }
        .dot:nth-child(3) { animation-delay: 0.6s; }

        @keyframes dot-pulse {
            0%, 100% { transform: scale(1); opacity: 0.7; }
            50% { transform: scale(1.5); opacity: 1; }
        }

        /* Responsive design */
        @media (max-width: 768px) {
            .features {
                flex-direction: column;
                align-items: center;
            }
            
            .feature-card {
                min-width: 250px;
            }
        }

        /* Loading animation */
        .loading {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 1000;
            opacity: 0;
            animation: loading-fade 2s ease-in-out;
        }

        @keyframes loading-fade {
            0% { opacity: 1; }
            90% { opacity: 1; }
            100% { opacity: 0; }
        }

        .spinner {
            width: 50px;
            height: 50px;
            border: 3px solid rgba(255, 255, 255, 0.1);
            border-top: 3px solid #00ffff;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <!-- Loading animation -->
    <div class="loading">
        <div class="spinner"></div>
    </div>

    <!-- Animated background particles -->
    <div class="particles">
        <div class="particle"></div>
        <div class="particle"></div>
        <div class="particle"></div>
        <div class="particle"></div>
        <div class="particle"></div>
        <div class="particle"></div>
        <div class="particle"></div>
        <div class="particle"></div>
        <div class="particle"></div>
    </div>

    <!-- Neural network lines -->
    <div class="neural-lines">
        <div class="neural-line"></div>
        <div class="neural-line"></div>
        <div class="neural-line"></div>
        <div class="neural-line"></div>
    </div>

    <!-- Main content -->
    <div class="container">
        <h1 class="logo">BRMH</h1>
        <p class="subtitle">AI • Tech • Project</p>
        
        <div class="features">
            <div class="feature-card">
                <h3 class="feature-title">Unified</h3>
                <p class="feature-desc">One hub for data, compute and automation. Built for scale.</p>
            </div>
            <div class="feature-card">
                <h3 class="feature-title">Intelligent</h3>
                <p class="feature-desc">Agentic flows, smart caching and on-demand codegen.</p>
            </div>
            <div class="feature-card">
                <h3 class="feature-title">Precise</h3>
                <p class="feature-desc">Typed interfaces, deterministic pipelines, observable by design.</p>
            </div>
        </div>

        <div class="dots">
            <div class="dot"></div>
            <div class="dot"></div>
            <div class="dot"></div>
        </div>
    </div>

    <script>
        // Add interactive effects
        document.addEventListener('mousemove', (e) => {
            const particles = document.querySelectorAll('.particle');
            const x = e.clientX / window.innerWidth;
            const y = e.clientY / window.innerHeight;
            
            particles.forEach((particle, index) => {
                const speed = (index + 1) * 0.5;
                particle.style.transform = \`translate(\${x * speed * 10}px, \${y * speed * 10}px)\`;
            });
        });

        // Add click effects
        document.addEventListener('click', (e) => {
            const ripple = document.createElement('div');
            ripple.style.position = 'absolute';
            ripple.style.left = e.clientX + 'px';
            ripple.style.top = e.clientY + 'px';
            ripple.style.width = '0px';
            ripple.style.height = '0px';
            ripple.style.borderRadius = '50%';
            ripple.style.background = 'rgba(0, 255, 255, 0.3)';
            ripple.style.transform = 'translate(-50%, -50%)';
            ripple.style.animation = 'ripple 0.6s ease-out';
            ripple.style.pointerEvents = 'none';
            ripple.style.zIndex = '1000';
            
            document.body.appendChild(ripple);
            
            setTimeout(() => {
                ripple.remove();
            }, 600);
        });

        // Add ripple animation
        const style = document.createElement('style');
        style.textContent = \`
            @keyframes ripple {
                0% { width: 0px; height: 0px; opacity: 1; }
                100% { width: 200px; height: 200px; opacity: 0; }
            }
        \`;
        document.head.appendChild(style);

        // Add keyboard interaction
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                document.body.style.filter = 'hue-rotate(180deg)';
                setTimeout(() => {
                    document.body.style.filter = 'none';
                }, 500);
            }
        });

        // Add scroll effect (even though no scroll)
        let scrollY = 0;
        document.addEventListener('wheel', (e) => {
            scrollY += e.deltaY * 0.1;
            document.body.style.transform = \`translateY(\${scrollY}px)\`;
            
            setTimeout(() => {
                document.body.style.transform = 'translateY(0)';
                scrollY = 0;
            }, 1000);
        });
    </script>
</body>
</html>
  `);
});

app.get("/test",(req,res)=>{res.send("hello! world");
})
// Register Notifications routes
registerNotificationRoutes(app, docClient);



// Initialize AWS DynamoDB OpenAPI backend
const awsApi = new OpenAPIBackend({
  definition: './swagger/aws-dynamodb.yaml',
  quick: true,
  handlers: {
    validationFail: async (c, req, res) => ({
      statusCode: 400,
      error: c.validation.errors
    }),
    notFound: async (c, req, res) => ({
      statusCode: 404,
      error: 'Not Found'
    }),
    // Table Operations
    listTables: dynamodbHandlers.listTables,
    createTable: dynamodbHandlers.createTable,
    deleteTable: dynamodbHandlers.deleteTable,
    // Item Operations
    getItems: dynamodbHandlers.getItems,
    createItem: dynamodbHandlers.createItem,
    getItem: dynamodbHandlers.getItem,
    updateItem: dynamodbHandlers.updateItem,
    deleteItem: dynamodbHandlers.deleteItem,
    queryItems: dynamodbHandlers.queryItems,
    // New PK-only Operations
    getItemsByPk: dynamodbHandlers.getItemsByPk,
    updateItemsByPk: dynamodbHandlers.updateItemsByPk,
    deleteItemsByPk: dynamodbHandlers.deleteItemsByPk,
    // Loop Operations
    getItemsInLoop: dynamodbHandlers.getItemsInLoop
  }
});


// Define unifiedApiHandlers FIRST
const unifiedApiHandlers = {
    // Namespace Operations
    getNamespaces: unifiedHandlers.getNamespaces,
    createNamespace: unifiedHandlers.createNamespace,
    updateNamespace: unifiedHandlers.updateNamespace,
    deleteNamespace: unifiedHandlers.deleteNamespace,
  getNamespaceById: unifiedHandlers.getNamespaceById,

  // Schema Operations
  listSchemas: unifiedHandlers.listSchemas,
  listSchemasByNamespace: unifiedHandlers.listSchemasByNamespace,
  getSchemas: unifiedHandlers.listSchemas, // Alias for listSchemas
  createSchema: unifiedHandlers.createSchema,
  updateSchema: unifiedHandlers.updateSchema,
  deleteSchema: unifiedHandlers.deleteSchema,
  getSchemaById: unifiedHandlers.getSchemaById,
  saveSchema: unifiedHandlers.saveSchema,
  getSchemasForSelection: unifiedHandlers.getSchemasForSelection,
  getSchemaWithReferences: unifiedHandlers.getSchemaWithReferences,
  // Register the createSchemasTable handler
  createSchemasTable: unifiedHandlers.createSchemasTable,

    // Namespace Method Operations
    getNamespaceMethods: unifiedHandlers.getNamespaceMethods,
    createNamespaceMethod: unifiedHandlers.createNamespaceMethod,
    updateNamespaceMethod: unifiedHandlers.updateNamespaceMethod,
    deleteNamespaceMethod: unifiedHandlers.deleteNamespaceMethod,
    getNamespaceMethodById: unifiedHandlers.getNamespaceMethodById,
  createTableItem: unifiedHandlers.createTableItem,

    // Namespace Account Operations
    getNamespaceAccounts: unifiedHandlers.getNamespaceAccounts,
    getNamespaceAccountById: unifiedHandlers.getNamespaceAccountById,
    createNamespaceAccount: unifiedHandlers.createNamespaceAccount,
    updateNamespaceAccount: unifiedHandlers.updateNamespaceAccount,
    deleteNamespaceAccount: unifiedHandlers.deleteNamespaceAccount,
  // Execute Namespace Request
  executeNamespaceRequest: unifiedHandlers.executeNamespaceRequest,
  executeNamespacePaginatedRequest: unifiedHandlers.executeNamespacePaginatedRequest,


  // Webhook Operations
  createWebhook: unifiedHandlers.createWebhook,
  getWebhookById: unifiedHandlers.getWebhookById,
  updateWebhook: unifiedHandlers.updateWebhook,
  deleteWebhook: unifiedHandlers.deleteWebhook,
  listWebhooks: unifiedHandlers.listWebhooks,
  getWebhooksByTableName: unifiedHandlers.getWebhooksByTableName,
  getWebhooksByNamespace: unifiedHandlers.getWebhooksByNamespace,
  getWebhooksByMethod: unifiedHandlers.getWebhooksByMethod,
  getActiveWebhooks: unifiedHandlers.getActiveWebhooks,

  // Table Operations
  validateTable: unifiedHandlers.validateTable,

 
}; 

// THEN initialize OpenAPIBackend
const unifiedApi = new OpenAPIBackend({
  definition: path.join(__dirname, 'swagger/unified-api.yaml'),
  handlers: unifiedApiHandlers,
});

// Define AI Agent API Handlers
const aiAgentApiHandlers = {
  aiAgent: aiAgentHandler,
  aiAgentStream: aiAgentStreamHandler,
  // Add more as needed
};

// Initialize AI Agent OpenAPI backend
const aiAgentApi = new OpenAPIBackend({
  definition: path.join(__dirname, 'swagger/ai-agent-api.yaml'),
  handlers: aiAgentApiHandlers,
});

// Initialize all APIs
Promise.all([
  awsApi.init(),
  unifiedApi.init(),
  aiAgentApi.init()
]).catch(error => {
  console.error('Error initializing OpenAPI backends:', error);
});

// --- Lambda Deployment API Routes ---
app.post('/lambda/deploy', async (req, res) => {
  try {
    const { functionName, code, runtime = 'nodejs18.x', handler = 'index.handler', memorySize = 128, timeout = 30, dependencies = {}, environment = '', createApiGateway = true } = req.body;
    
    if (!functionName || !code) {
      return res.status(400).json({ error: 'functionName and code are required' });
    }

    console.log(`[Lambda Deployment] Deploying function: ${functionName}`);
    console.log(`[Lambda Deployment] Request body:`, { functionName, runtime, handler, memorySize, timeout, dependencies, environment, createApiGateway });
    
    // Set timeout for the entire deployment process (15 minutes)
    const deploymentPromise = lambdaDeploymentManager.deployLambdaFunction(
      functionName, 
      code, 
      runtime, 
      handler, 
      memorySize, 
      timeout,
      dependencies,
      environment,
      createApiGateway
    );
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Deployment timed out after 15 minutes')), 15 * 60 * 1000);
    });
    
    const result = await Promise.race([deploymentPromise, timeoutPromise]);

    console.log(`[Lambda Deployment] Real deployment result:`, result);
    res.json(result);
  } catch (error) {
    console.error('[Lambda Deployment] Error:', error);
    res.status(500).json({ 
      error: 'Failed to deploy Lambda function', 
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/lambda/invoke', async (req, res) => {
  try {
    console.log(`[Lambda Invoke] Raw request body:`, req.body);
    const { functionName, payload = {} } = req.body;
    
    if (!functionName) {
      return res.status(400).json({ error: 'functionName is required' });
    }

    console.log(`[Lambda Invoke] Invoking function: ${functionName}`);
    console.log(`[Lambda Invoke] Payload:`, payload);
    
    // Invoke real AWS Lambda function
    const result = await lambdaDeploymentManager.invokeLambdaFunction(functionName, payload);
    console.log(`[Lambda Invoke] Real invoke result:`, result);
    res.json(result);
  } catch (error) {
    console.error('[Lambda Invoke] Error:', error);
    console.error('[Lambda Invoke] Error details:', {
      name: error.name,
      message: error.message,
      code: error.$metadata?.httpStatusCode,
      requestId: error.$metadata?.requestId
    });
    res.status(500).json({ 
      error: 'Failed to invoke Lambda function', 
      details: error.message,
      errorCode: error.name,
      requestId: error.$metadata?.requestId
    });
  }
});

app.post('/lambda/cleanup', async (req, res) => {
  try {
    const { functionName } = req.body;
    
    if (!functionName) {
      return res.status(400).json({ error: 'functionName is required' });
    }

    console.log(`[Lambda Deployment] Cleaning up temp files for: ${functionName}`);
    
    await lambdaDeploymentManager.cleanupTempFiles(functionName);
    res.json({ success: true, message: 'Temp files cleaned up successfully' });
  } catch (error) {
    console.error('[Lambda Deployment] Error:', error);
    res.status(500).json({ 
      error: 'Failed to cleanup temp files', 
      details: error.message 
    });
  }
});

// API Gateway creation endpoint
app.post('/lambda/create-api-gateway', async (req, res) => {
  try {
    const { functionName, functionArn, runtime, handler, deploymentId } = req.body;
    
    if (!functionName || !functionArn) {
      return res.status(400).json({ error: 'Function name and ARN are required' });
    }
    
    console.log(`[API Gateway] Creating API Gateway for function: ${functionName}`);
    console.log(`[API Gateway] Function ARN: ${functionArn}`);
    console.log(`[API Gateway] Deployment ID: ${deploymentId}`);
    
    const result = await lambdaDeploymentManager.createApiGateway(
      functionName,
      functionArn,
      runtime || 'nodejs18.x',
      handler || 'index.handler',
      deploymentId
    );
    
    console.log(`[API Gateway] API Gateway creation result:`, result);
    
    res.json(result);
  } catch (error) {
    console.error('[API Gateway] Error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to create API Gateway',
      details: error.message 
    });
  }
});

// Get deployment metadata endpoint
app.get('/lambda/deployments/:deploymentId', async (req, res) => {
  try {
    const { deploymentId } = req.params;
    
    console.log(`[Deployments] Getting metadata for deployment: ${deploymentId}`);
    
    const metadata = await lambdaDeploymentManager.getDeploymentMetadata(deploymentId);
    
    if (!metadata) {
      return res.status(404).json({ error: 'Deployment not found' });
    }
    
    res.json(metadata);
  } catch (error) {
    console.error('[Deployments] Error:', error);
    res.status(500).json({ 
      error: 'Failed to get deployment metadata',
      details: error.message 
    });
  }
});

// List deployments endpoint
app.get('/lambda/deployments', async (req, res) => {
  try {
    const { functionName } = req.query;
    
    console.log(`[Deployments] Listing deployments${functionName ? ` for function: ${functionName}` : ''}`);
    
    const deployments = await lambdaDeploymentManager.listDeployments(functionName);
    
    res.json({ deployments });
  } catch (error) {
    console.error('[Deployments] Error:', error);
    res.status(500).json({ 
      error: 'Failed to list deployments',
      details: error.message 
    });
  }
});

// Save files to S3 endpoint
app.post('/workspace/save-files-to-s3', async (req, res) => {
  try {
    const { namespaceId, projectName, zipData, fileCount, files } = req.body;
    
    if (!namespaceId || !zipData) {
      return res.status(400).json({ error: 'namespaceId and zipData are required' });
    }
    
    console.log(`[Workspace] Saving files to S3 for namespace: ${namespaceId}`);
    console.log(`[Workspace] Project name: ${projectName}`);
    console.log(`[Workspace] File count: ${fileCount}`);
    
    const result = await lambdaDeploymentManager.saveFilesToS3(
      namespaceId,
      projectName,
      zipData,
      fileCount,
      files
    );
    
    console.log(`[Workspace] S3 save result:`, result);
    
    res.json(result);
  } catch (error) {
    console.error('[Workspace] Error saving files to S3:', error);
    res.status(500).json({ 
      error: 'Failed to save files to S3',
      details: error.message 
    });
  }
});

// Save Lambda function to namespace library endpoint
app.post('/workspace/save-lambda', async (req, res) => {
  try {
    const { namespaceId, lambdaData } = req.body;
    
    if (!namespaceId || !lambdaData) {
      return res.status(400).json({ error: 'namespaceId and lambdaData are required' });
    }
    
    console.log(`[Workspace] Saving Lambda function to namespace: ${namespaceId}`);
    console.log(`[Workspace] Function name: ${lambdaData.functionName}`);
    console.log(`[Workspace] Lambda ID: ${lambdaData.id}`);
    
    // Save Lambda metadata to DynamoDB
    const result = await lambdaDeploymentManager.saveLambdaToNamespace(
      namespaceId,
      lambdaData
    );
    
    console.log(`[Workspace] Lambda save result:`, result);
    
    res.json(result);
  } catch (error) {
    console.error('[Workspace] Error saving Lambda to namespace:', error);
    res.status(500).json({ 
      error: 'Failed to save Lambda to namespace',
      details: error.message 
    });
  }
});

// Get saved Lambda functions for a namespace
app.get('/workspace/lambdas/:namespaceId', async (req, res) => {
  try {
    const { namespaceId } = req.params;
    
    if (!namespaceId) {
      return res.status(400).json({ error: 'namespaceId is required' });
    }
    
    console.log(`[Workspace] Fetching Lambda functions for namespace: ${namespaceId}`);
    
    // Get Lambda functions from DynamoDB
    const result = await lambdaDeploymentManager.getLambdasForNamespace(namespaceId);
    
    console.log(`[Workspace] Found ${result.lambdas.length} Lambda functions`);
    
    res.json(result);
  } catch (error) {
    console.error('[Workspace] Error fetching Lambda functions:', error);
    res.status(500).json({ 
      error: 'Failed to fetch Lambda functions',
      details: error.message 
    });
  }
});

// Serve Swagger UI for all APIs
const awsOpenapiSpec = yaml.load(fs.readFileSync(path.join(__dirname, 'swagger/aws-dynamodb.yaml'), 'utf8'));
const mainOpenapiSpec = yaml.load(fs.readFileSync(path.join(__dirname, 'swagger/unified-api.yaml'), 'utf8'));




// Serve AWS API docs
app.use('/aws-api-docs', swaggerUi.serve);
app.get('/aws-api-docs', (req, res) => {
  res.send(
    swaggerUi.generateHTML(awsOpenapiSpec, {
      customSiteTitle: "AWS DynamoDB API Documentation",
      customfavIcon: "/favicon.ico",
      customCss: '.swagger-ui .topbar { display: none }',
      swaggerUrl: "/aws-api-docs/swagger.json"
    })
  );
});

// Serve AWS API docs at the DynamoDB base URL
app.use('/api/dynamodb', swaggerUi.serve);
app.get('/api/dynamodb', (req, res) => {
  res.send(
    swaggerUi.generateHTML(awsOpenapiSpec, {
      customSiteTitle: "AWS DynamoDB API Documentation",
      customfavIcon: "/favicon.ico",
      customCss: '.swagger-ui .topbar { display: none }',
      swaggerUrl: "/api/dynamodb/swagger.json"
    })
  );
});

// Serve DynamoDB OpenAPI specification
app.get('/api/dynamodb/swagger.json', (req, res) => {
  res.json(awsOpenapiSpec);
});

// Serve AI Agent API docs
const aiAgentOpenapiSpec = yaml.load(fs.readFileSync(path.join(__dirname, 'swagger/ai-agent-api.yaml'), 'utf8'));
app.use('/ai-agent-docs', swaggerUi.serve);
app.get('/ai-agent-docs', (req, res) => {
  res.send(
    swaggerUi.generateHTML(aiAgentOpenapiSpec, {
      customSiteTitle: "AI Agent API Documentation",
      customfavIcon: "/favicon.ico",
      customCss: '.swagger-ui .topbar { display: none }',
      swaggerUrl: "/ai-agent-docs/swagger.json"
    })
  );
});

// Serve BRMH Drive API docs
const driveOpenapiSpec = yaml.load(fs.readFileSync(path.join(__dirname, 'swagger/brmh-drive-api.yaml'), 'utf8'));
app.use('/drive-api-docs', swaggerUi.serve);
app.get('/drive-api-docs', (req, res) => {
  res.send(
    swaggerUi.generateHTML(driveOpenapiSpec, {
      customSiteTitle: "BRMH Drive API Documentation",
      customfavIcon: "/favicon.ico",
      customCss: '.swagger-ui .topbar { display: none }',
      swaggerUrl: "/drive-api-docs/swagger.json"
    })
  );
});

// Serve BRMH Drive API specification
app.get('/drive-api-docs/swagger.json', (req, res) => {
  res.json(driveOpenapiSpec);
});

// Serve Unified API docs
app.use('/unified-api-docs', swaggerUi.serve);
app.get('/unified-api-docs', (req, res) => {
  res.send(
    swaggerUi.generateHTML(mainOpenapiSpec, {
      customSiteTitle: "Unified API Documentation",
      customfavIcon: "/favicon.ico",
      customCss: '.swagger-ui .topbar { display: none }',
      swaggerUrl: "/unified-api-docs/swagger.json"
    })
  );
});

// Serve Unified API specification
app.get('/unified-api-docs/swagger.json', (req, res) => {
  res.json(mainOpenapiSpec);
});

// Route AI Agent endpoints
app.post('/ai-agent', (req, res) => aiAgentHandler({ request: { requestBody: req.body } }, req, res));

// AI Agent streaming endpoint for chat and schema editing
app.post('/ai-agent/stream', async (req, res) => {
  console.log('[AI Agent] !!! STREAMING ENDPOINT CALLED !!!');
  const { message, namespace, history, schema } = req.body;
  
  // Import the intent detection function
  const { detectIntent } = await import('./lib/llm-agent-system.js');
  
  // Log the intent detection for debugging
  const intent = detectIntent(message);
  console.log('[AI Agent] Streaming request intent analysis:', {
    message,
    intent: intent.intent,
    shouldGenerateLambda: intent.shouldGenerateLambda,
    shouldGenerateSchema: intent.shouldGenerateSchema,
    isQuestion: intent.isQuestion,
    isCasualMention: intent.isCasualMention,
    isExplanatory: intent.isExplanatory
  });
  
  try {
    await agentSystem.handleStreamingWithAgents(res, namespace, message, history, schema);
  } catch (error) {
    console.error('AI Agent streaming error:', error);
    res.status(500).json({ error: 'Failed to handle AI Agent streaming request' });
  }
});

// AI Agent Lambda codegen endpoint
app.post('/ai-agent/lambda-codegen', async (req, res) => {
  console.log('[AI Agent] !!! LAMBDA CODEGEN ENDPOINT CALLED !!!');
  const { message, originalMessage, namespace, selectedSchema, functionName, runtime, handler, memory, timeout, environment } = req.body;
  console.log('[AI Agent] Lambda codegen request received:', { message, originalMessage, selectedSchema, functionName, runtime, handler, memory, timeout, environment, namespace });

  // Import the intent detection function
  const { detectIntent } = await import('./lib/llm-agent-system.js');
  
  // Use robust intent detection to validate the request - use original message for intent detection
  const intent = detectIntent(originalMessage || message);
  
  console.log('[AI Agent] Intent validation for lambda generation:', {
    originalMessage: originalMessage || message,
    intent: intent.intent,
    shouldGenerateLambda: intent.shouldGenerateLambda,
    isQuestion: intent.isQuestion,
    isCasualMention: intent.isCasualMention,
    isExplanatory: intent.isExplanatory
  });

  // Only proceed with lambda generation if explicitly requested
  if (!intent.shouldGenerateLambda) {
    console.log('[AI Agent] Rejecting lambda generation request - not explicitly requested');
    res.write(`data: ${JSON.stringify({ 
      error: 'Lambda generation not requested', 
      details: 'This message does not contain an explicit request to generate a lambda function. Please use explicit action words like "generate", "create", "build", etc. along with lambda-related keywords.',
      intent: intent.intent
    })}\n\n`);
    res.end();
    return;
  }

  try {
    // Use the enhanced lambda codegen handler with streaming and automatic schema selection
    await handleLambdaCodegen({
      message,
      selectedSchema,
      functionName,
      runtime,
      handler,
      memory,
      timeout,
      environment,
      namespace, // Pass namespace for automatic schema selection
      res // Pass the response object for streaming
    });

  } catch (error) {
    console.error('[AI Agent] Lambda codegen error:', error);
    res.write(`data: ${JSON.stringify({ error: 'Failed to generate Lambda code', details: error.message })}\n\n`);
    res.end();
  }
});



// Schema upload and Lambda generation endpoint
app.post('/ai-agent/schema-lambda-generation', async (req, res) => {
  try {
    const { message, schemas, namespaceId, functionName, runtime, handler, memory, timeout, environment } = req.body;
    console.log('[Schema Lambda Generation] Request received:', { 
      message, 
      schemaCount: schemas?.length || 0, 
      namespaceId, 
      functionName 
    });

    // Import the Lambda generation functions
    const { handleLambdaCodegen, analyzeSchemas } = await import('./lib/llm-agent-system.js');
    
    // Set up streaming response
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Analyze uploaded schemas
    let schemaAnalysis = null;
    if (schemas && schemas.length > 0) {
      console.log('[Schema Lambda Generation] Analyzing uploaded schemas...');
      schemaAnalysis = await analyzeSchemas(schemas, message);
      
      // Send schema analysis to frontend
      const analysisResponse = {
        type: 'schema_analysis',
        analysis: schemaAnalysis,
        route: 'chat'
      };
      
      res.write(`data: ${JSON.stringify(analysisResponse)}\n\n`);
    }

    // Generate Lambda function
    const lambdaCodegenParams = {
      message: message,
      selectedSchema: null,
      functionName: functionName || 'SchemaHandler',
      runtime: runtime || 'nodejs18.x',
      handler: handler || 'index.handler',
      memory: memory || 256,
      timeout: timeout || 30,
      environment: environment || null,
      namespace: namespaceId,
      res: null,
      uploadedSchemas: schemas || []
    };

    const result = await handleLambdaCodegen(lambdaCodegenParams);

    if (result.generatedCode) {
      // Send Lambda code generation response
      const lambdaResponse = {
        type: 'lambda_code',
        schemaName: schemaAnalysis ? `MultiSchema_${schemaAnalysis.totalSchemas}` : 'SchemaHandler',
        schema: schemaAnalysis ? { 
          name: 'MultiSchema', 
          schemas: schemas,
          analysis: schemaAnalysis 
        } : null,
        code: result.generatedCode,
        route: 'lambda'
      };
      
      res.write(`data: ${JSON.stringify(lambdaResponse)}\n\n`);
      
      // Send success message
      const chatMessage = {
        type: 'chat',
        content: `✅ Generated Lambda function using ${schemas?.length || 0} uploaded schemas!\n\nCheck the Lambda tab to see the generated code!`,
        route: 'chat'
      };
      
      res.write(`data: ${JSON.stringify(chatMessage)}\n\n`);
    } else {
      // Send error message
      const errorMessage = {
        type: 'chat',
        content: `❌ Failed to generate Lambda function: ${result.error || 'Unknown error'}`,
        route: 'chat'
      };
      
      res.write(`data: ${JSON.stringify(errorMessage)}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error('[Schema Lambda Generation] Error:', error);
    res.write(`data: ${JSON.stringify({ 
      type: 'chat',
      content: `❌ Error generating Lambda function: ${error.message}`,
      route: 'chat'
    })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// Workspace Guidance and Navigation endpoint
app.post('/ai-agent/workspace-guidance', async (req, res) => {
  try {
    const { message, namespaceId } = req.body;
    console.log('[Workspace Guidance] Request received:', { message, namespaceId });

    // Import the guidance functions
    const { detectIntentWithGuidance, generateWorkspaceGuidance, getRealNamespaceData } = await import('./lib/llm-agent-system.js');
    
    // Detect intent and check for guidance requests
    const intentWithGuidance = detectIntentWithGuidance(message);
    
    if (!intentWithGuidance.shouldProvideGuidance) {
      return res.status(400).json({ 
        error: 'Not a guidance request', 
        message: 'This endpoint is for workspace guidance requests only' 
      });
    }

    // Get namespace context for personalized guidance
    let namespaceData = null;
    if (namespaceId) {
      try {
        namespaceData = await getRealNamespaceData(namespaceId);
      } catch (err) {
        console.warn('[Workspace Guidance] Failed to get namespace data:', err.message);
      }
    }
    
    // Generate workspace guidance
    const guidance = generateWorkspaceGuidance(intentWithGuidance.intent, intentWithGuidance.feature, namespaceData);
    
    res.json({
      success: true,
      guidance: {
        feature: intentWithGuidance.feature,
        suggestions: guidance.suggestions,
        nextSteps: guidance.nextSteps,
        uiActions: guidance.uiActions,
        context: guidance.context
      }
    });
    
  } catch (error) {
    console.error('[Workspace Guidance] Error:', error);
    res.status(500).json({ error: 'Failed to generate workspace guidance' });
  }
});

// AI Agent Workspace State endpoints
app.post('/ai-agent/get-workspace-state', async (req, res) => {
  try {
    const { sessionId, namespaceId } = req.body;
    if (!sessionId || !namespaceId) {
      return res.status(400).json({ error: 'Missing sessionId or namespaceId' });
    }
    
    // For now, return a default workspace state
    // In a real implementation, you would load this from a database or cache
    const workspaceState = {
      files: [],
      schemas: [],
      apis: [],
      projectType: 'nodejs',
      lastGenerated: null
    };
    
    res.json({ success: true, workspaceState });
  } catch (error) {
    console.error('Error getting workspace state:', error);
    res.status(500).json({ error: 'Failed to get workspace state' });
  }
});

app.post('/ai-agent/save-workspace-state', async (req, res) => {
  try {
    const { sessionId, namespaceId, workspaceState } = req.body;
    if (!sessionId || !namespaceId || !workspaceState) {
      return res.status(400).json({ error: 'Missing sessionId, namespaceId, or workspaceState' });
    }
    
    // For now, just acknowledge the save
    // In a real implementation, you would save this to a database or cache
    console.log('Saving workspace state:', { sessionId, namespaceId, workspaceState });
    
    res.json({ success: true, message: 'Workspace state saved' });
  } catch (error) {
    console.error('Error saving workspace state:', error);
    res.status(500).json({ error: 'Failed to save workspace state' });
  }
});

// AI Agent Chat History endpoints
app.post('/ai-agent/chat-history', async (req, res) => {
  try {
    const { sessionId, userId, limit = 50 } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: 'Missing sessionId' });
    }
    
    // For now, return empty history
    // In a real implementation, you would load this from a database
    res.json({ success: true, history: [] });
  } catch (error) {
    console.error('Error getting chat history:', error);
    res.status(500).json({ error: 'Failed to get chat history' });
  }
});

app.post('/ai-agent/clear-history', async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: 'Missing sessionId' });
    }
    
    // For now, just acknowledge the clear
    // In a real implementation, you would clear this from a database
    console.log('Clearing chat history for session:', sessionId);
    
    res.json({ success: true, message: 'Chat history cleared' });
  } catch (error) {
    console.error('Error clearing chat history:', error);
    res.status(500).json({ error: 'Failed to clear chat history' });
  }
});

// Code Generation endpoints
app.get('/code-generation/files/:namespaceId', async (req, res) => {
  try {
    const { namespaceId } = req.params;
    
    // For now, return empty file list
    // In a real implementation, you would load this from a database or file system
    res.json({ success: true, files: [] });
  } catch (error) {
    console.error('Error getting files:', error);
    res.status(500).json({ error: 'Failed to get files' });
  }
});

app.get('/code-generation/files/:namespaceId/*', async (req, res) => {
  try {
    const { namespaceId } = req.params;
    const filePath = req.params[0];
    
    // For now, return empty content
    // In a real implementation, you would load this from a file system
    res.json({ success: true, content: '' });
  } catch (error) {
    console.error('Error getting file content:', error);
    res.status(500).json({ error: 'Failed to get file content' });
  }
});

app.post('/code-generation/generate-backend', async (req, res) => {
  try {
    const { schemas, apis, projectType } = req.body;
    
    // For now, return a placeholder response
    // In a real implementation, you would generate backend code
    res.json({ 
      success: true, 
      message: 'Backend code generation not yet implemented',
      files: []
    });
  } catch (error) {
    console.error('Error generating backend code:', error);
    res.status(500).json({ error: 'Failed to generate backend code' });
  }
});

// Save to namespace endpoints
app.post('/save-api-to-namespace', async (req, res) => {
  try {
    const { namespaceId, apiData } = req.body;
    
    // For now, just acknowledge the save
    // In a real implementation, you would save this to a database
    console.log('Saving API to namespace:', { namespaceId, apiData });
    
    res.json({ success: true, message: 'API saved to namespace' });
  } catch (error) {
    console.error('Error saving API to namespace:', error);
    res.status(500).json({ error: 'Failed to save API to namespace' });
  }
});

// Endpoint to add a schemaId to a namespace's schemaIds array
debugger;
app.post('/unified/namespace/:namespaceId/add-schema', async (req, res) => {
  try {
    const { namespaceId } = req.params;
    const { schemaId } = req.body;
    if (!namespaceId || !schemaId) {
      return res.status(400).json({ success: false, error: 'Missing namespaceId or schemaId' });
    }
    const result = await unifiedHandlers.updateNamespace(namespaceId, { schemaId });
    return res.json({ success: true, updatedNamespace: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Web Scraping Agent endpoints
import WebScrapingAgent from './lib/web-scraping-agent.js';

const webScrapingAgent = new WebScrapingAgent();

// Get supported services
app.get('/web-scraping/supported-services', async (req, res) => {
  try {
    const services = webScrapingAgent.getSupportedServices();
    res.json({ success: true, services });
  } catch (error) {
    console.error('Error getting supported services:', error);
    res.status(500).json({ error: 'Failed to get supported services' });
  }
});

// Scrape service and save to namespace (with automatic namespace management)
app.post('/web-scraping/scrape-and-save', async (req, res) => {
  try {
    const { serviceName, namespaceId, options = {} } = req.body;
    
    if (!serviceName) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required field: serviceName' 
      });
    }

    console.log(`[Web Scraping] Starting scrape for ${serviceName}${namespaceId ? ` to namespace ${namespaceId}` : ' (will auto-manage namespace)'}`);
    
    // Set up streaming response
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    // Send initial status
    res.write(`data: ${JSON.stringify({ 
      type: 'status', 
      message: `Starting web scraping for ${serviceName}...`,
      timestamp: new Date().toISOString()
    })}\n\n`);

    try {
      // Scrape the service with namespace management
      const scrapedData = await webScrapingAgent.scrapeService(serviceName, options, docClient, namespaceId);
      
      // Handle namespace information
      let namespaceMessage = '';
      if (scrapedData.namespaceInfo) {
        if (namespaceId && scrapedData.namespaceInfo['namespace-id'] === namespaceId) {
          namespaceMessage = `Using existing namespace: ${namespaceId}`;
        } else if (namespaceId) {
          namespaceMessage = `Found existing namespace: ${scrapedData.namespaceInfo['namespace-id']} (different from requested: ${namespaceId})`;
        } else {
          namespaceMessage = `Created new namespace: ${scrapedData.namespaceInfo['namespace-id']}`;
        }
      }
      
      res.write(`data: ${JSON.stringify({ 
        type: 'status', 
        message: `Scraping completed. Found ${scrapedData.apis.length} APIs, ${scrapedData.schemas.length} schemas, ${scrapedData.documentation.length} docs. ${namespaceMessage}`,
        timestamp: new Date().toISOString(),
        results: {
          apis: scrapedData.apis.length,
          schemas: scrapedData.schemas.length,
          documentation: scrapedData.documentation.length,
          namespaceInfo: scrapedData.namespaceInfo
        }
      })}\n\n`);

      // Save to namespace
      res.write(`data: ${JSON.stringify({ 
        type: 'status', 
        message: 'Saving scraped data to namespace...',
        timestamp: new Date().toISOString()
      })}\n\n`);

      // Use the namespace from scraping results or the provided namespaceId
      const targetNamespaceId = namespaceId || (scrapedData.namespaceInfo ? scrapedData.namespaceInfo['namespace-id'] : null);
      const saveResult = await webScrapingAgent.saveToNamespace(scrapedData, targetNamespaceId, docClient);
      
      if (saveResult.success) {
        res.write(`data: ${JSON.stringify({ 
          type: 'success', 
          message: 'Successfully saved scraped data to namespace!',
          timestamp: new Date().toISOString(),
          summary: saveResult.summary
        })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ 
          type: 'error', 
          message: `Error saving data: ${saveResult.error}`,
          timestamp: new Date().toISOString()
        })}\n\n`);
      }

    } catch (error) {
      console.error(`[Web Scraping] Error:`, error);
      res.write(`data: ${JSON.stringify({ 
        type: 'error', 
        message: `Scraping failed: ${error.message}`,
        timestamp: new Date().toISOString()
      })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error('Error in web scraping endpoint:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to process web scraping request' 
    });
  }
});

// Scrape service with automatic namespace management (no namespaceId required)
app.post('/web-scraping/scrape-auto-namespace', async (req, res) => {
  try {
    const { serviceName, options = {} } = req.body;
    
    if (!serviceName) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required field: serviceName' 
      });
    }

    console.log(`[Web Scraping] Starting auto-namespace scrape for ${serviceName}`);
    
    // Set up streaming response
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    // Send initial status
    res.write(`data: ${JSON.stringify({ 
      type: 'status', 
      message: `Starting web scraping for ${serviceName} with automatic namespace management...`,
      timestamp: new Date().toISOString()
    })}\n\n`);

    try {
      // Scrape the service with automatic namespace management
      const scrapedData = await webScrapingAgent.scrapeService(serviceName, options, docClient, null);
      
      // Handle namespace information
      let namespaceMessage = '';
      if (scrapedData.namespaceInfo) {
        namespaceMessage = `Using namespace: ${scrapedData.namespaceInfo['namespace-id']} (${scrapedData.namespaceInfo['created-via'] === 'web-scraping' ? 'newly created' : 'existing'})`;
      }
      
      res.write(`data: ${JSON.stringify({ 
        type: 'status', 
        message: `Scraping completed. Found ${scrapedData.apis.length} APIs, ${scrapedData.schemas.length} schemas, ${scrapedData.documentation.length} docs. ${namespaceMessage}`,
        timestamp: new Date().toISOString(),
        results: {
          apis: scrapedData.apis.length,
          schemas: scrapedData.schemas.length,
          documentation: scrapedData.documentation.length,
          namespaceInfo: scrapedData.namespaceInfo
        }
      })}\n\n`);

      // Save to namespace
      res.write(`data: ${JSON.stringify({ 
        type: 'status', 
        message: 'Saving scraped data to namespace...',
        timestamp: new Date().toISOString()
      })}\n\n`);

      const saveResult = await webScrapingAgent.saveToNamespace(scrapedData, null, docClient);
      
      if (saveResult.success) {
        res.write(`data: ${JSON.stringify({ 
          type: 'success', 
          message: 'Successfully saved scraped data to namespace!',
          timestamp: new Date().toISOString(),
          summary: saveResult.summary
        })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ 
          type: 'error', 
          message: `Error saving data: ${saveResult.error}`,
          timestamp: new Date().toISOString()
        })}\n\n`);
      }

    } catch (error) {
      console.error(`[Web Scraping] Error:`, error);
      res.write(`data: ${JSON.stringify({ 
        type: 'error', 
        message: `Scraping failed: ${error.message}`,
        timestamp: new Date().toISOString()
      })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error('Error in web scraping auto-namespace endpoint:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to process web scraping auto-namespace request' 
    });
  }
});

// Scrape service without saving (for preview)
app.post('/web-scraping/scrape-preview', async (req, res) => {
  try {
    const { serviceName, options = {} } = req.body;
    
    if (!serviceName) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required field: serviceName' 
      });
    }

    console.log(`[Web Scraping] Starting preview scrape for ${serviceName}`);
    
    const scrapedData = await webScrapingAgent.scrapeService(serviceName, options, null, null);
    
    res.json({ 
      success: true, 
      data: scrapedData,
      summary: {
        service: scrapedData.service,
        apis: scrapedData.apis.length,
        schemas: scrapedData.schemas.length,
        documentation: scrapedData.documentation.length,
        errors: scrapedData.errors
      }
    });

  } catch (error) {
    console.error('Error in web scraping preview endpoint:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to process web scraping preview request' 
    });
  }
});

// Endpoint to migrate existing namespaces (create missing methods for scraped APIs)
app.post('/web-scraping/migrate-existing-namespaces', async (req, res) => {
  try {
    console.log('[Web Scraping] Starting migration of existing namespaces...');
    
    // Set up streaming response
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    // Send initial status
    res.write(`data: ${JSON.stringify({ 
      type: 'status', 
      message: 'Starting migration of existing namespaces...',
      timestamp: new Date().toISOString()
    })}\n\n`);

    try {
      // Run the migration
      const migrationResult = await webScrapingAgent.migrateExistingNamespaces(docClient);
      
      if (migrationResult.success) {
        res.write(`data: ${JSON.stringify({ 
          type: 'success', 
          message: 'Migration completed successfully!',
          timestamp: new Date().toISOString(),
          summary: migrationResult.summary
        })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ 
          type: 'error', 
          message: `Migration failed: ${migrationResult.error}`,
          timestamp: new Date().toISOString()
        })}\n\n`);
      }

    } catch (error) {
      console.error(`[Web Scraping] Migration error:`, error);
      res.write(`data: ${JSON.stringify({ 
        type: 'error', 
        message: `Migration failed: ${error.message}`,
        timestamp: new Date().toISOString()
      })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error('Error in migration endpoint:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to process migration request' 
    });
  }
});

// Endpoint to save a schema to a namespace
app.post('/save-schema-to-namespace', async (req, res) => {
  try {
    console.log('Received /save-schema-to-namespace:', req.body);
    const { namespaceId, schemaName, schemaType, schema, isArray, originalType, url } = req.body;
    if (!namespaceId || !schemaName || !schemaType || !schema) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    
    // Use the unifiedHandlers.saveSchema handler
    const result = await unifiedHandlers.saveSchema({ request: { requestBody: { namespaceId, schemaName, schemaType, schema, isArray, originalType, url } } }, req, res);
    console.log('Result from saveSchema:', result);
    if (result.statusCode === 200) {
      return res.json({ success: true, schemaId: result.body.schemaId });
    } else {
      return res.status(result.statusCode).json({ success: false, error: result.body.error });
    }
  } catch (error) {
    console.error('Error in /save-schema-to-namespace:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- API Testing Endpoint: Test OpenAPI endpoint and stream result to frontend console ---
app.post('/api/test-openapi-endpoint', async (req, res) => {
  try {
    const { openapiJson, path: testPath, method, body, headers, query } = req.body;
    if (!openapiJson || !testPath || !method) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Validate request against OpenAPI spec
    const tempApi = new OpenAPIBackend({ definition: openapiJson, quick: true });
    await tempApi.init();
    const validation = tempApi.validateRequest({
      method: method.toLowerCase(),
      path: testPath,
      body,
      query,
      headers
    });
    if (!validation.valid) {
      return res.status(400).json({ error: 'Request does not match OpenAPI spec', details: validation.errors });
    }

    // Make the real HTTP request (assume baseUrl is in servers[0].url)
    const baseUrl = openapiJson.servers && openapiJson.servers[0] && openapiJson.servers[0].url ? openapiJson.servers[0].url : '';
    if (!baseUrl) {
      return res.status(400).json({ error: 'No baseUrl found in OpenAPI spec' });
    }
    const url = baseUrl.replace(/\/$/, '') + testPath;

    // Stream response
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    try {
      const response = await axios({
        method: method.toLowerCase(),
        url,
        headers,
        params: query,
        data: body,
        validateStatus: () => true // Don't throw on any status
      });
      res.write(JSON.stringify({ status: response.status, statusText: response.statusText, headers: response.headers, body: response.data }) + '\n');
    } catch (err) {
      res.write(JSON.stringify({ error: err.message }) + '\n');
    }
    res.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/cache/table', cacheTableHandler);
app.get('/cache/data', getCachedDataHandler);
app.get('/cache/keys', getPaginatedCacheKeysHandler);
app.get('/cache/clear', clearCacheHandler);
app.get('/cache/stats', getCacheStatsHandler);
app.get('/cache/health', cacheHealthHandler);
app.get('/cache/test', testCacheConnection);
app.post('/cache/clear-unwanted-order-data', clearUnwantedOrderDataHandler);
app.post('/cache/cleanup-timestamp-chunks', cleanupTimestampChunksHandler);
app.get('/cache/data-in-sequence', getCachedDataInSequenceHandler);

// Debug endpoint for testing cache responses
app.get('/cache/debug/:project/:table/:key', async (req, res) => {
  try {
    const { project, table, key } = req.params;
    console.log(`🔍 Debug cache request: ${project}:${table}:${key}`);
    
    // Set headers to prevent browser issues
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    const cacheKey = `${project}:${table}:${key}`;
    const value = await redis.get(cacheKey);
    
    if (!value) {
      return res.status(404).json({
        message: "Key not found",
        key: cacheKey,
        timestamp: new Date().toISOString()
      });
    }
    
    // Try to parse JSON
    let parsedData;
    try {
      parsedData = JSON.parse(value);
    } catch (error) {
      return res.status(500).json({
        message: "Invalid JSON in cache",
        key: cacheKey,
        error: error.message,
        rawValue: value.substring(0, 500) + (value.length > 500 ? '...' : ''),
        timestamp: new Date().toISOString()
      });
    }
    
    const responseData = {
      message: "Debug cache data retrieved",
      key: cacheKey,
      data: parsedData,
      size: Buffer.byteLength(JSON.stringify(parsedData), 'utf8'),
      timestamp: new Date().toISOString()
    };
    
    console.log(`✅ Debug response size: ${responseData.size} bytes`);
    return res.status(200).json(responseData);
    
  } catch (error) {
    console.error('❌ Debug cache error:', error);
    return res.status(500).json({
      message: "Debug cache error",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Add a simple connection test endpoint
app.get('/test-valkey-connection', async (req, res) => {
  try {
    console.log('🔍 Testing Valkey connection...');
    console.log('📋 Connection config:', {
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT,
      tls: process.env.REDIS_TLS === 'true' ? 'enabled' : 'disabled',
      password: process.env.REDIS_PASSWORD ? '***' : 'none'
    });
    
    await redis.ping();
    console.log('✅ Valkey ping successful');
    res.json({
      status: 'success',
      message: 'Valkey connection test passed',
      config: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT,
        tls: process.env.REDIS_TLS === 'true' ? 'enabled' : 'disabled'
      }
    });
  } catch (error) {
    console.error('❌ Valkey connection test failed:', error);
    res.status(500).json({
      status: 'error',
      message: 'Valkey connection test failed',
      error: error.message,
      config: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT,
        tls: process.env.REDIS_TLS === 'true' ? 'enabled' : 'disabled'
      }
    });
  }
});

// Cache update from Lambda function
app.post('/cache-data', updateCacheFromLambdaHandler);

// Bulk cache operation management
app.get('/cache/bulk-operations', getActiveBulkCacheOperations);
app.delete('/cache/bulk-operations', clearActiveBulkCacheOperations);

// Pending cache updates management
app.get('/cache/pending-updates', getPendingCacheUpdates);
app.delete('/cache/pending-updates', clearPendingCacheUpdates);

// --- Search Indexing API Routes ---
app.post('/search/index', indexTableHandler);
app.post('/search/query', searchIndexHandler);
app.post('/search/indices', listIndicesHandler);
app.post('/search/delete', deleteIndicesHandler);
app.post('/search/update', updateIndexingFromLambdaHandler);
app.get('/search/health', searchHealthHandler);

// Test endpoint
app.get('/test', (req, res) => {
  res.json({ message: 'Server is working!' });
});



// Streaming Lambda deployment endpoint
app.post('/lambda/deploy-stream', async (req, res) => {
  try {
    const { functionName, code, runtime = 'nodejs18.x', handler = 'index.handler', memorySize = 128, timeout = 30 } = req.body;
    
    if (!functionName || !code) {
      return res.status(400).json({ error: 'functionName and code are required' });
    }

    console.log(`[Lambda Deployment] Starting streaming deployment for: ${functionName}`);
    
    // Set up streaming response
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Send initial status
    res.write(`data: ${JSON.stringify({ type: 'status', message: 'Starting Lambda deployment...', functionName })}\n\n`);
    
    try {
      // Real deployment steps
      res.write(`data: ${JSON.stringify({ type: 'progress', message: 'Creating deployment package...', step: 1, totalSteps: 7, functionName })}\n\n`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      res.write(`data: ${JSON.stringify({ type: 'progress', message: 'Installing dependencies...', step: 2, totalSteps: 7, functionName })}\n\n`);
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      res.write(`data: ${JSON.stringify({ type: 'progress', message: 'Creating deployment ZIP file...', step: 3, totalSteps: 7, functionName })}\n\n`);
      await new Promise(resolve => setTimeout(resolve, 800));
      
      res.write(`data: ${JSON.stringify({ type: 'progress', message: 'Checking if function exists...', step: 4, totalSteps: 7, functionName })}\n\n`);
      await new Promise(resolve => setTimeout(resolve, 500));
      
      res.write(`data: ${JSON.stringify({ type: 'progress', message: 'Creating/updating Lambda function...', step: 5, totalSteps: 7, functionName })}\n\n`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      res.write(`data: ${JSON.stringify({ type: 'progress', message: 'Configuring function settings...', step: 6, totalSteps: 7, functionName })}\n\n`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Perform actual deployment
      const result = await lambdaDeploymentManager.deployLambdaFunction(
        functionName, 
        code, 
        runtime, 
        handler, 
        memorySize, 
        timeout
      );
      
      res.write(`data: ${JSON.stringify({ type: 'progress', message: 'Deployment completed successfully!', step: 7, totalSteps: 7, functionName })}\n\n`);
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Send final result
      res.write(`data: ${JSON.stringify({ type: 'result', data: result, functionName })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();

      console.log(`[Lambda Deployment] Streaming deployment completed for: ${functionName}`);
    } catch (deploymentError) {
      console.error('[Lambda Deployment] Deployment error:', deploymentError);
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Deployment failed: ' + deploymentError.message, functionName })}\n\n`);
      res.end();
    }
  } catch (error) {
    console.error('[Lambda Deployment] Streaming error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'Deployment failed: ' + error.message })}\n\n`);
    res.end();
  }
});

/**
 * Generic CRUD endpoint for DynamoDB tables
 * Usage:
 *   - GET    /api/crud?tableName=...&partitionKey=...&sortKey=... (single item or paginated)
 *   - POST   /api/crud?tableName=...   (body: { item: ... })
 *   - PUT    /api/crud?tableName=...   (body: { key: ..., updates: ... })
 *   - DELETE /api/crud?tableName=...   (body: { partitionKey: ..., sortKey: ... })
 */
app.all('/crud', async (req, res) => {
  try {
    const event = {
      httpMethod: req.method,
      requestContext: req.requestContext || {},
      queryStringParameters: req.query,
      body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
    };
    const result = await crud.handler(event);
    res.status(result.statusCode || 200);
    // If result.body is a string, parse if possible
    let body = result.body;
    try {
      body = JSON.parse(result.body);
    } catch {}
    res.json(body);

    // Emit notification event (non-blocking)
    try {
      const crudNotifyEvent = buildCrudEvent({ method: req.method, tableName: req.query?.tableName, body: req.body, result: body });
      console.log('[Index] Emitting CRUD event:', crudNotifyEvent);
      notifyEvent(crudNotifyEvent).catch(err => console.error('[Index] CRUD notifyEvent error:', err));
    } catch (e) {
      console.warn('[Notify] Failed to emit CRUD event:', e.message);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Execute endpoint - handles both single and paginated requests
app.post('/execute', async (req, res) => {
  try {
    console.log('[Execute] Request received:', {
      executeType: req.body.executeType,
      url: req.body.url,
      method: req.body.method
    });

    const event = {
      body: req.body
    };

    const result = await execute(event);
    
    // Parse the result body if it's a string
    let responseBody = result.body;
    try {
      responseBody = JSON.parse(result.body);
    } catch {}

    res.status(result.statusCode || 200).json(responseBody);
  } catch (error) {
    console.error('[Execute] Error:', error);
    res.status(500).json({ 
      error: 'Failed to execute request', 
      details: error.message 
    });
  }
});

// Handle DynamoDB API routes
app.all('/dynamodb/*', async (req, res) => {
  try {
    const response = await awsApi.handleRequest(
      {
        method: req.method,
        path: req.path.replace('/dynamodb', '') || '/',
        body: req.body,
        query: req.query,
        headers: req.headers
      },
      req,
      res
    );

    // Check if response is null (streaming response handled by handler)
    if (response === null) {
      return; // Response already handled by the handler
    }

    res.status(response.statusCode).json(response.body);
  } catch (error) {
    console.error('[DynamoDB API] Error:', error.message);
    res.status(500).json({
      error: 'Failed to handle DynamoDB API request',
      message: error.message
    });
  }
});

// Handle Unified API routes with file upload support
app.all('/unified/*', upload.single('icon'), async (req, res) => {
  try {
    // Parse tags if they're sent as JSON string
    if (req.body.tags && typeof req.body.tags === 'string') {
      try {
        req.body.tags = JSON.parse(req.body.tags);
      } catch (error) {
        req.body.tags = [];
      }
    }

    const response = await unifiedApi.handleRequest(
      {
        method: req.method,
        path: req.path.replace('/unified', '') || '/',
        body: req.body,
        query: req.query,
        headers: req.headers
      },
      req,
      res
    );

    // Check if response is null (streaming response handled by handler)
    if (response === null) {
      return; // Response already handled by the handler
    }

    res.status(response.statusCode).json(response.body);

    // Attempt to emit namespace-related events
    try {
      const evt = buildUnifiedNamespaceEvent({ method: req.method, path: req.path, response: response?.body });
      if (evt) {
        console.log('[Index] Emitting unified namespace event:', evt);
        notifyEvent(evt).catch(err => console.error('[Index] Unified notifyEvent error:', err));
      }
    } catch (e) {
      console.warn('[Notify] Failed to emit unified namespace event:', e.message);
    }
  } catch (error) {
    console.error('[Unified API] Error:', error.message);
    res.status(500).json({
      error: 'Failed to handle unified API request',
      message: error.message
    });
  }
});

//cache-data getting from lambda to update the cache
app.post("/cache/update", async (req, res) => {
  try {
    const { type, newItem, oldItem, tableName } = req.body; // ← Get tableName from Lambda

    console.log("Received from Lambda:");
    console.log("Event Type:", type);
    console.log("Table Name (from Lambda):", tableName); // ← This is the ACTUAL table
    console.log("New Item:", newItem);
    console.log("Old Item:", oldItem);

    // Use the table name from Lambda (the actual table being updated)
    if (!tableName) {
      console.error("No table name provided by Lambda");
      return res.status(400).json({ error: "No table name provided by Lambda" });
    }

    console.log(`Processing cache update for table: ${tableName}`);
    console.log(`🔍 Table name debug:`);
    console.log(`  - Table name from Lambda:`, tableName);
    console.log(`  - newItem.tableName (config table):`, newItem?.tableName);
    console.log(`  - oldItem.tableName (config table):`, oldItem?.tableName);

    // Create a modified request with the correct table name
    const modifiedReq = {
      ...req,
      body: {
        ...req.body,
        extractedTableName: tableName // Use the actual table from Lambda
      }
    };

    // Use the existing cache update handler
    await updateCacheFromLambdaHandler(modifiedReq, res);

    // Also trigger indexing update if table name is not the indexing table itself
    if (tableName !== 'brmh-indexing') {
      try {
        console.log(`🔄 Triggering indexing update for table: ${tableName}`);
        
        // Call the indexing update handler asynchronously
        const indexingUpdateReq = {
          body: {
            type,
            newItem,
            oldItem,
            tableName
          }
        };
        
        // Don't wait for the indexing update to complete
        updateIndexingFromLambdaHandler(indexingUpdateReq, {
          status: (code) => ({ code }),
          json: (data) => console.log('Indexing update response:', data)
        }).catch(error => {
          console.error(`❌ Indexing update failed for table ${tableName}:`, error);
        });
        
      } catch (indexingError) {
        console.error(`❌ Error triggering indexing update for table ${tableName}:`, indexingError);
        // Don't fail the cache update if indexing fails
      }
    }

  } catch (error) {
    console.error("Error in cache update endpoint:", error);
    res.status(500).json({ error: error.message });
  }
});

//indexing-data getting from lambda to update the indexing
app.post("/indexing/update", async (req, res) => {
  try {
    const { type, newItem, oldItem, tableName } = req.body;

    console.log("Received indexing update from Lambda:");
    console.log("Event Type:", type);
    console.log("Table Name:", tableName);
    console.log("New Item:", newItem);
    console.log("Old Item:", oldItem);

    if (!type || !tableName) {
      console.error("Missing required parameters for indexing update");
      return res.status(400).json({ 
        error: "Missing required parameters", 
        message: "type and tableName are required" 
      });
    }

    // Call the indexing update handler
    await updateIndexingFromLambdaHandler(req, res);

  } catch (error) {
    console.error("Error in indexing update endpoint:", error);
    res.status(500).json({ error: error.message });
  }
});

// Auth Routes
app.post('/auth/login', loginHandler);
app.post('/auth/signup', signupHandler);

// Phone Authentication Routes
app.post('/auth/phone/signup', phoneSignupHandler);
app.post('/auth/phone/login', phoneLoginHandler);
app.post('/auth/phone/verify', verifyPhoneHandler);
app.post('/auth/phone/resend-otp', resendOtpHandler);

// OAuth Routes
app.get('/auth/oauth-url', generateOAuthUrlHandler);
app.post('/auth/token', exchangeTokenHandler);
app.post('/auth/refresh', refreshTokenHandler);
app.post('/auth/validate', validateTokenHandler);
app.post('/auth/logout', logoutHandler);
app.get('/auth/logout-url', getLogoutUrlHandler);
app.get('/auth/debug-pkce', debugPkceStoreHandler);

// Simple redirect to Cognito Hosted UI logout (useful for frontend buttons)
app.get('/auth/logout-redirect', (req, res) => {
  try {
    const domain = process.env.AWS_COGNITO_DOMAIN;
    const clientId = process.env.AWS_COGNITO_CLIENT_ID;
    const logoutRedirectUri = process.env.AUTH_LOGOUT_REDIRECT_URI || process.env.AUTH_REDIRECT_URI || 'http://localhost:3000';

    if (!domain || !clientId) {
      return res.status(500).json({
        error: 'OAuth configuration missing. Set AWS_COGNITO_DOMAIN, AWS_COGNITO_CLIENT_ID, and AUTH_LOGOUT_REDIRECT_URI/AUTH_REDIRECT_URI.'
      });
    }

    const url = `https://${domain}/logout?client_id=${encodeURIComponent(clientId)}&logout_uri=${encodeURIComponent(logoutRedirectUri)}`;
    return res.redirect(url);
  } catch (error) {
    console.error('Error building logout redirect URL:', error);
    return res.status(500).json({ error: 'Failed to build logout redirect URL', details: error.message });
  }
});


const PORT = process.env.PORT || 5001;


app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Main API documentation available at http://localhost:${PORT}/api-docs`);
  console.log(`AWS DynamoDB service available at http://localhost:${PORT}/api/dynamodb`);
  console.log(`llm API documentation available at http://localhost:${PORT}/llm-api-docs`);
  console.log(`Unified API documentation available at http://localhost:${PORT}/unified-api-docs`);
  console.log(`AI Agent API documentation available at http://localhost:${PORT}/ai-agent-docs`);
  console.log(`BRMH Drive API documentation available at http://localhost:${PORT}/drive-api-docs`);
});

// --- Mock Data Agent API Routes ---
app.post('/mock-data/generate', async (req, res) => {
  try {
    const { tableName, count = 10, context = null } = req.body;
    
    if (!tableName) {
      return res.status(400).json({ error: 'tableName is required' });
    }

    console.log(`[Mock Data Agent] Generating ${count} records for table: ${tableName}`);
    
    const result = await mockDataAgent.generateMockData({ tableName, count, context });
    
    if (result.success) {
      res.json({ success: true, result: result.result });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    console.error('[Mock Data Agent] Error:', error);
    res.status(500).json({ 
      error: 'Failed to generate mock data', 
      details: error.message 
    });
  }
});

app.post('/mock-data/generate-for-schema', async (req, res) => {
  try {
    const { schema, tableName, count = 10, context = null } = req.body;
    
    if (!schema || !tableName) {
      return res.status(400).json({ error: 'schema and tableName are required' });
    }

    console.log(`[Mock Data Agent] Generating ${count} records for schema in table: ${tableName}`);
    
    const result = await mockDataAgent.generateMockDataForSchema({ schema, tableName, count, context });
    
    if (result.success) {
      res.json({ success: true, result: result.result });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    console.error('[Mock Data Agent] Error:', error);
    res.status(500).json({ 
      error: 'Failed to generate mock data for schema', 
      details: error.message 
    });
  }
});

app.post('/mock-data/generate-for-namespace', async (req, res) => {
  try {
    const { namespaceId, count = 10, context = null } = req.body;
    
    if (!namespaceId) {
      return res.status(400).json({ error: 'namespaceId is required' });
    }

    console.log(`[Mock Data Agent] Generating ${count} records for namespace: ${namespaceId}`);
    
    const result = await mockDataAgent.generateMockDataForNamespace({ namespaceId, count, context });
    
    if (result.success) {
      res.json({ success: true, result: result.result });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    console.error('[Mock Data Agent] Error:', error);
    res.status(500).json({ 
      error: 'Failed to generate mock data for namespace', 
      details: error.message 
    });
  }
});

app.get('/mock-data/tables', async (req, res) => {
  try {
    console.log(`[Mock Data Agent] Listing available tables`);
    
    const result = await mockDataAgent.listAvailableTables();
    
    if (result.success) {
      res.json({ success: true, result: result.result });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    console.error('[Mock Data Agent] Error:', error);
    res.status(500).json({ 
      error: 'Failed to list available tables', 
      details: error.message 
    });
  }
});

// Icon serving endpoint
app.get('/api/icon/:s3Key(*)', async (req, res) => {
  try {
    const { s3Key } = req.params;
    const decodedS3Key = decodeURIComponent(s3Key);
    
    console.log('Serving icon:', decodedS3Key);
    
    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
    
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: 'brmh',
      Key: decodedS3Key
    }));

    // Set appropriate headers
    res.setHeader('Content-Type', response.ContentType || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
    
    // Pipe the S3 object stream directly to the response
    response.Body.pipe(res);
  } catch (error) {
    console.error('Error serving icon:', error);
    res.status(404).json({ error: 'Icon not found' });
  }
});

// Fetch orders with short IDs (3 digits or less)
app.get('/orders/short-ids', fetchOrdersWithShortIdsHandler);

// --- BRMH Drive System API Routes ---

// Create namespace folder endpoint
app.post('/drive/namespace-folder', async (req, res) => {
  try {
    const { namespaceId, namespaceName } = req.body;
    
    if (!namespaceId || !namespaceName) {
      return res.status(400).json({ 
        error: 'namespaceId and namespaceName are required' 
      });
    }
    
    console.log(`[BRMH Drive] Creating namespace folder for: ${namespaceName} (${namespaceId})`);
    
    const result = await brmhDrive.createNamespaceFolder(namespaceId, namespaceName);
    
    res.json(result);
  } catch (error) {
    console.error('[BRMH Drive] Error creating namespace folder:', error);
    res.status(500).json({ 
      error: 'Failed to create namespace folder', 
      details: error.message 
    });
  }
});

app.post('/drive/upload', upload.single('file'), async (req, res) => {
  try {
    const { userId, parentId = 'ROOT', tags, namespaceId, fieldName } = req.body;
    
    // For namespace-specific uploads, use namespaceId as userId
    const effectiveUserId = namespaceId || userId;
    
    if (!effectiveUserId) {
      return res.status(400).json({ error: 'userId or namespaceId is required' });
    }
    
    let fileData;
    
    // Handle multipart/form-data (file upload)
    if (req.file) {
      const fileBuffer = req.file.buffer;
      const base64Content = fileBuffer.toString('base64');
      const tagsArray = tags
        ? (Array.isArray(tags) ? tags : String(tags).split(',').map(tag => tag.trim()))
        : [];
      
      // Add field name to tags for namespace uploads
      if (fieldName) {
        tagsArray.push(`field:${fieldName}`);
      }
      
      fileData = {
        name: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        content: base64Content,
        tags: tagsArray
      };
    }
    // Handle JSON request (base64 content)
    else if (req.body.fileData || req.body.file) {
      fileData = req.body.fileData || req.body.file;
    }
    else {
      return res.status(400).json({ error: 'Either file upload or fileData is required' });
    }
    
    // For namespace uploads, use the namespace folder as parent
    let effectiveParentId = parentId;
    if (namespaceId) {
      // Get the namespace folder path
      try {
        const namespaceRes = await fetch(`${process.env.API_BASE_URL || 'http://localhost:5001'}/unified/namespaces/${namespaceId}`);
        if (namespaceRes.ok) {
          const namespaceData = await namespaceRes.json();
          if (namespaceData['folder-path']) {
            // Use the namespace folder as the parent
            effectiveParentId = namespaceData['folder-path'];
            
            // If fieldName is provided, create a subfolder for the field
            if (fieldName) {
              // Create field-specific folder within namespace folder
              const fieldFolderPath = `${namespaceData['folder-path']}/${fieldName}`;
              try {
                // Create the field folder if it doesn't exist
                await brmhDrive.createFolder(effectiveUserId, fieldName, effectiveParentId);
                effectiveParentId = fieldFolderPath;
              } catch (error) {
                console.log('Could not create field folder, using namespace folder');
              }
            }
          }
        }
      } catch (error) {
        console.log('Could not get namespace folder path, using default parent');
      }
    }
    
    const result = await brmhDrive.uploadFile(effectiveUserId, fileData, effectiveParentId);
    
    // Add file path to response for namespace uploads
    if (namespaceId && result.fileId) {
      result.filePath = result.s3Key || result.fileId;
    }
    
    res.json(result);
  } catch (error) {
    console.error('Drive upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/drive/folder', async (req, res) => {
  try {
    const { userId, folderData, parentId = 'ROOT' } = req.body;
    
    if (!userId || !folderData) {
      return res.status(400).json({ error: 'userId and folderData are required' });
    }
    
    const result = await brmhDrive.createFolder(userId, folderData, parentId);
    res.json(result);
  } catch (error) {
    console.error('Drive folder creation error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/drive/files/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { parentId = 'ROOT', limit = 50, nextToken } = req.query;
    
    const result = await brmhDrive.listFiles(userId, parentId, parseInt(limit), nextToken);
    res.json(result);
  } catch (error) {
    console.error('Drive list files error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/drive/folders/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { parentId = 'ROOT', limit = 50, nextToken } = req.query;
    
    const result = await brmhDrive.listFolders(userId, parentId, parseInt(limit), nextToken);
    res.json(result);
  } catch (error) {
    console.error('Drive list folders error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/drive/contents/:userId/:folderId', async (req, res) => {
  try {
    const { userId, folderId } = req.params;
    const { limit = 50, nextToken } = req.query;
    
    const result = await brmhDrive.listFolderContents(userId, folderId, parseInt(limit), nextToken);
    res.json(result);
  } catch (error) {
    console.error('Drive list folder contents error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/drive/file/:userId/:fileId', async (req, res) => {
  try {
    const { userId, fileId } = req.params;
    
    const result = await brmhDrive.getFileById(userId, fileId);
    if (!result) {
      return res.status(404).json({ error: 'File not found' });
    }
    res.json(result);
  } catch (error) {
    console.error('Drive get file error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/drive/folder/:userId/:folderId', async (req, res) => {
  try {
    const { userId, folderId } = req.params;
    
    const result = await brmhDrive.getFolderById(userId, folderId);
    if (!result) {
      return res.status(404).json({ error: 'Folder not found' });
    }
    res.json(result);
  } catch (error) {
    console.error('Drive get folder error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/drive/rename/:userId/:fileId', async (req, res) => {
  try {
    const { userId, fileId } = req.params;
    const { newName } = req.body;
    
    if (!newName) {
      return res.status(400).json({ error: 'newName is required' });
    }
    
    const result = await brmhDrive.renameFile(userId, fileId, newName);
    res.json(result);
  } catch (error) {
    console.error('Drive rename error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/drive/file/:userId/:fileId', async (req, res) => {
  try {
    const { userId, fileId } = req.params;
    
    const result = await brmhDrive.deleteFile(userId, fileId);
    res.json(result);
  } catch (error) {
    console.error('Drive delete file error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/drive/download/:userId/:fileId', async (req, res) => {
  try {
    const { userId, fileId } = req.params;
    
    const result = await brmhDrive.generateDownloadUrl(userId, fileId);
    res.json(result);
  } catch (error) {
    console.error('Drive download URL generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/drive/preview/:userId/:fileId', async (req, res) => {
  try {
    const { userId, fileId } = req.params;
    const result = await brmhDrive.generatePreviewUrl(userId, fileId);
    res.json(result);
  } catch (error) {
    console.error('Drive preview URL generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/drive/initialize', async (req, res) => {
  try {
    const result = await brmhDrive.initializeDriveSystem();
    res.json(result);
  } catch (error) {
    console.error('Drive initialization error:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- BRMH Drive Sharing API Routes ---
app.post('/drive/share/file/:userId/:fileId', async (req, res) => {
  try {
    const { userId, fileId } = req.params;
    const shareData = req.body;
    
    const result = await brmhDrive.shareFile(userId, fileId, shareData);
    res.json(result);
  } catch (error) {
    console.error('Drive share file error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/drive/share/folder/:userId/:folderId', async (req, res) => {
  try {
    const { userId, folderId } = req.params;
    const shareData = req.body;
    
    const result = await brmhDrive.shareFolder(userId, folderId, shareData);
    res.json(result);
  } catch (error) {
    console.error('Drive share folder error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/drive/shared/with-me/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 50, nextToken } = req.query;
    
    const result = await brmhDrive.getSharedWithMe(userId, parseInt(limit), nextToken);
    res.json(result);
  } catch (error) {
    console.error('Drive get shared with me error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/drive/shared/by-me/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 50, nextToken } = req.query;
    
    const result = await brmhDrive.getSharedByMe(userId, parseInt(limit), nextToken);
    res.json(result);
  } catch (error) {
    console.error('Drive get shared by me error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/drive/share/:userId/:shareId/permissions', async (req, res) => {
  try {
    const { userId, shareId } = req.params;
    const { permissions } = req.body;
    
    if (!permissions) {
      return res.status(400).json({ error: 'permissions is required' });
    }
    
    const result = await brmhDrive.updateSharePermissions(userId, shareId, permissions);
    res.json(result);
  } catch (error) {
    console.error('Drive update share permissions error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/drive/share/:userId/:shareId/revoke', async (req, res) => {
  try {
    const { userId, shareId } = req.params;
    
    const result = await brmhDrive.revokeShare(userId, shareId);
    res.json(result);
  } catch (error) {
    console.error('Drive revoke share error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/drive/shared/:userId/:shareId/download', async (req, res) => {
  try {
    const { userId, shareId } = req.params;
    
    const result = await brmhDrive.getSharedFileContent(userId, shareId);
    res.json(result);
  } catch (error) {
    console.error('Drive get shared file content error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete folder endpoint
app.delete('/drive/folder/:userId/:folderId', async (req, res) => {
  try {
    const { userId, folderId } = req.params;
    
    const result = await brmhDrive.deleteFolder(userId, folderId);
    res.json(result);
  } catch (error) {
    console.error('Drive delete folder error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Rename folder endpoint
app.patch('/drive/rename/folder/:userId/:folderId', async (req, res) => {
  try {
    const { userId, folderId } = req.params;
    const { newName } = req.body;
    
    if (!newName) {
      return res.status(400).json({ error: 'newName is required' });
    }
    
    const result = await brmhDrive.renameFolder(userId, folderId, newName);
    res.json(result);
  } catch (error) {
    console.error('Drive rename folder error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Move file to different folder
app.patch('/drive/move/file/:userId/:fileId', async (req, res) => {
  try {
    const { userId, fileId } = req.params;
    const { newParentId } = req.body;
    
    if (!newParentId) {
      return res.status(400).json({ error: 'newParentId is required' });
    }
    
    const result = await brmhDrive.moveFile(userId, fileId, newParentId);
    res.json(result);
  } catch (error) {
    console.error('Drive move file error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Move folder to different parent
app.patch('/drive/move/folder/:userId/:folderId', async (req, res) => {
  try {
    const { userId, folderId } = req.params;
    const { newParentId } = req.body;
    
    if (!newParentId) {
      return res.status(400).json({ error: 'newParentId is required' });
    }
    
    const result = await brmhDrive.moveFolder(userId, folderId, newParentId);
    res.json(result);
  } catch (error) {
    console.error('Drive move folder error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint to see raw data structure
app.get('/orders/debug', async (req, res) => {
  try {
    console.log('🔍 Debug endpoint called - fetching raw data...');
    
    const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient, ScanCommand } = await import('@aws-sdk/lib-dynamodb');
    
    const client = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(client);
    
    const scanParams = {
      TableName: 'shopify-inkhub-get-products',
      Limit: 5 // Only get first 5 items for debugging
    };

    const command = new ScanCommand(scanParams);
    const response = await docClient.send(command);
    
    console.log('🔍 Raw response:', JSON.stringify(response, null, 2));
    
    res.json({
      success: true,
      message: 'Debug data retrieved',
      totalItems: response.Items?.length || 0,
      sampleItems: response.Items?.slice(0, 3) || [],
      rawResponse: response
    });

  } catch (error) {
    console.error('❌ Error in debug endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch debug data',
      message: error.message
    });
  }
});