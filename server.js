require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { initializeDatabase, db } = require('./config/database');
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const workRoutes = require('./routes/work');

const app = express();

// CORS Configuration - Updated for Netlify + Render
const allowedOrigins = [
  process.env.FRONTEND_URL, 
  process.env.REACT_APP_FRONTEND_URL,
  'https://taskpillot.netlify.app',
  'http://localhost:3000',
  'http://localhost:3001'
].filter(Boolean);

console.log('Allowed CORS origins:', allowedOrigins);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.some(allowedOrigin => {
      return origin === allowedOrigin || 
             (allowedOrigin.includes('netlify.app') && origin.includes('netlify.app'));
    })) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      console.log('Allowed origins:', allowedOrigins);
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

// Initialize SQLite Database
initializeDatabase();

// Email Configuration
let transporter = null;
if (process.env.EMAIL_SERVICE && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
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
      console.error('Email configuration error:', error);
    } else {
      console.log('Email service ready');
    }
  });
} else {
  console.log('Email not configured - notifications disabled');
}

app.set('transporter', transporter);
global.transporter = transporter;

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

// Health check endpoint
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
    console.error('Health check failed:', error);
    res.status(500).json({ 
      status: 'ERROR', 
      message: 'Database connection failed',
      error: error.message
    });
  }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/work', workRoutes);

// Catch-all for undefined routes
app.use('*', (req, res) => {
  console.log(`404 - Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    message: 'Route not found',
    path: req.originalUrl,
    method: req.method
  });
});

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  
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
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Database: SQLite`);
  console.log(`JWT Secret: ${process.env.JWT_SECRET ? 'Set' : 'MISSING'}`);
  console.log(`Email: ${transporter ? 'Configured' : 'Disabled'}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Allowed origins: ${allowedOrigins.length} configured`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    if (db) {
      db.close((err) => {
        if (err) {
          console.error('Error closing database:', err);
        } else {
          console.log('Database connection closed');
        }
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  });
});

module.exports = app;