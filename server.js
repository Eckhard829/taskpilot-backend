// Debug version of server.js with comprehensive error logging
console.log('🚀 Starting TaskPilot Backend...');

// Check if required modules can be loaded
try {
  require('dotenv').config();
  console.log('✅ dotenv loaded successfully');
} catch (error) {
  console.error('❌ Failed to load dotenv:', error.message);
  process.exit(1);
}

try {
  const express = require('express');
  console.log('✅ express loaded successfully');
} catch (error) {
  console.error('❌ Failed to load express:', error.message);
  process.exit(1);
}

try {
  const cors = require('cors');
  console.log('✅ cors loaded successfully');
} catch (error) {
  console.error('❌ Failed to load cors:', error.message);
  process.exit(1);
}

// Check critical environment variables
console.log('🔧 Environment Check:');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT:', process.env.PORT);
console.log('JWT_SECRET exists:', !!process.env.JWT_SECRET);
console.log('FRONTEND_URL:', process.env.FRONTEND_URL);

if (!process.env.JWT_SECRET) {
  console.error('❌ CRITICAL: JWT_SECRET environment variable is not set!');
  console.log('Please set JWT_SECRET in your Render environment variables');
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
let nodemailer;

try {
  nodemailer = require('nodemailer');
  console.log('✅ nodemailer loaded successfully');
} catch (error) {
  console.error('❌ Failed to load nodemailer:', error.message);
  // Don't exit, email is optional
}

// Try to load database module
let database;
try {
  database = require('./config/database');
  console.log('✅ database module loaded successfully');
} catch (error) {
  console.error('❌ Failed to load database module:', error.message);
  console.error('Make sure ./config/database.js exists and is properly configured');
  process.exit(1);
}

// Try to load route modules
let authRoutes, usersRoutes, workRoutes;

try {
  authRoutes = require('./routes/auth');
  console.log('✅ auth routes loaded successfully');
} catch (error) {
  console.error('❌ Failed to load auth routes:', error.message);
  process.exit(1);
}

try {
  usersRoutes = require('./routes/users');
  console.log('✅ users routes loaded successfully');
} catch (error) {
  console.error('❌ Failed to load users routes:', error.message);
  process.exit(1);
}

try {
  workRoutes = require('./routes/work');
  console.log('✅ work routes loaded successfully');
} catch (error) {
  console.error('❌ Failed to load work routes:', error.message);
  process.exit(1);
}

const { initializeDatabase, db } = database;

console.log('✅ All modules loaded successfully, starting server setup...');

const app = express();

// CORS Configuration
const allowedOrigins = [
  process.env.FRONTEND_URL, 
  process.env.REACT_APP_FRONTEND_URL,
  'https://taskpillot.netlify.app',
  'http://localhost:3000',
  'http://localhost:3001'
].filter(Boolean);

console.log('🌐 Configured CORS origins:', allowedOrigins);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.some(allowedOrigin => {
      return origin === allowedOrigin || 
             (allowedOrigin.includes('netlify.app') && origin.includes('netlify.app'));
    })) {
      callback(null, true);
    } else {
      console.log('❌ CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

console.log('✅ Express middleware configured');

// Initialize Database
try {
  initializeDatabase();
  console.log('✅ Database initialization started');
} catch (error) {
  console.error('❌ Database initialization failed:', error.message);
  process.exit(1);
}

// Email Configuration (optional)
let transporter = null;
if (nodemailer && process.env.EMAIL_SERVICE && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  try {
    transporter = nodemailer.createTransporter({
      service: process.env.EMAIL_SERVICE,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      pool: true,
      maxConnections: 5,
      maxMessages: 10,
    });

    transporter.verify((error, success) => {
      if (error) {
        console.error('❌ Email configuration error:', error);
      } else {
        console.log('✅ Email service ready');
      }
    });
  } catch (error) {
    console.error('❌ Email transporter setup failed:', error.message);
  }
} else {
  console.log('ℹ️ Email not configured - notifications disabled');
}

app.set('transporter', transporter);
global.transporter = transporter;

// Basic health check
app.get('/api/health', async (req, res) => {
  try {
    await new Promise((resolve, reject) => {
      db.get('SELECT 1', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    res.json({ 
      status: 'OK', 
      database: 'Connected',
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString() 
    });
  } catch (error) {
    console.error('❌ Health check failed:', error);
    res.status(500).json({ 
      status: 'ERROR', 
      message: 'Database connection failed',
      error: error.message
    });
  }
});

// Environment check endpoint
app.get('/api/env-check', (req, res) => {
  res.json({
    nodeEnv: process.env.NODE_ENV,
    hasJwtSecret: !!process.env.JWT_SECRET,
    hasEmailConfig: !!(process.env.EMAIL_SERVICE && process.env.EMAIL_USER),
    frontendUrl: process.env.FRONTEND_URL || process.env.REACT_APP_FRONTEND_URL,
    allowedOrigins: allowedOrigins,
    timestamp: new Date().toISOString()
  });
});

// Routes
try {
  app.use('/api/auth', authRoutes);
  console.log('✅ Auth routes registered');
} catch (error) {
  console.error('❌ Failed to register auth routes:', error.message);
  process.exit(1);
}

try {
  app.use('/api/users', usersRoutes);
  console.log('✅ Users routes registered');
} catch (error) {
  console.error('❌ Failed to register users routes:', error.message);
  process.exit(1);
}

try {
  app.use('/api/work', workRoutes);
  console.log('✅ Work routes registered');
} catch (error) {
  console.error('❌ Failed to register work routes:', error.message);
  process.exit(1);
}

// Catch-all for undefined routes
app.use('*', (req, res) => {
  console.log(`🔍 404 - Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    message: 'Route not found',
    path: req.originalUrl,
    method: req.method
  });
});

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('💥 Server Error:', err);
  
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ 
      message: 'CORS error - origin not allowed',
      origin: req.headers.origin
    });
  }
  
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ 
      message: 'Authentication failed',
      error: err.message
    });
  }
  
  res.status(500).json({ 
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Start Server
const PORT = process.env.PORT || 5000;
console.log(`🚀 Attempting to start server on port ${PORT}...`);

try {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running successfully on port ${PORT}`);
    console.log(`🗄️ Database: SQLite`);
    console.log(`🔐 JWT Secret: ${process.env.JWT_SECRET ? 'Set' : 'MISSING'}`);
    console.log(`📧 Email: ${transporter ? 'Configured' : 'Disabled'}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 Allowed origins: ${allowedOrigins.length} configured`);
    console.log('🎉 TaskPilot Backend is ready!');
  });

  server.on('error', (error) => {
    console.error('❌ Server failed to start:', error.message);
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use`);
    }
    process.exit(1);
  });
} catch (error) {
  console.error('❌ Failed to create server:', error.message);
  process.exit(1);
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('💤 Process terminated');
    if (db) {
      db.close((err) => {
        if (err) {
          console.error('❌ Error closing database:', err);
        } else {
          console.log('🗄️ Database connection closed');
        }
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  console.error('Stack trace:', error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

module.exports = app;