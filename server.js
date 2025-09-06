require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { initializeDatabase, db } = require('./config/database');
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const workRoutes = require('./routes/work');

const app = express();

// CORS Configuration - Updated for proper handling
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
    // Allow requests with no origin (like server-to-server requests)
    if (!origin) return callback(null, true);

    // Check if origin is allowed
    if (allowedOrigins.includes(origin) || origin.includes('netlify.app')) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      console.log('Allowed origins:', allowedOrigins);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

// Explicitly handle OPTIONS requests for all routes
app.options('*', cors());

// Additional CORS headers for all responses
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin) || (origin && origin.includes('netlify.app'))) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Initialize SQLite Database
initializeDatabase();

// FIXED EMAIL CONFIGURATION - THIS IS THE MAIN FIX
let transporter = null;
console.log('=== Email Configuration Debug ===');
console.log('EMAIL_SERVICE:', process.env.EMAIL_SERVICE || 'NOT SET');
console.log('EMAIL_USER:', process.env.EMAIL_USER || 'NOT SET');
console.log('EMAIL_PASS:', process.env.EMAIL_PASS ? 'SET' : 'NOT SET');

if (process.env.EMAIL_SERVICE && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  try {
    transporter = nodemailer.createTransporter({
      service: process.env.EMAIL_SERVICE,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
    
    // CRITICAL FIX: Set global transporter for use in routes
    global.transporter = transporter;
    
    // Test email configuration
    transporter.verify((error, success) => {
      if (error) {
        console.error('Email service setup failed:', error);
        console.log('Email notifications will be disabled but app will continue');
        // Keep global.transporter set but mark as non-functional
        global.emailWorking = false;
      } else {
        console.log('Email service is ready and functional');
        global.emailWorking = true;
      }
    });
  } catch (error) {
    console.error('Error creating email transporter:', error);
    global.transporter = null;
    global.emailWorking = false;
  }
} else {
  console.log('Email service not configured (missing environment variables)');
  console.log('Required: EMAIL_SERVICE, EMAIL_USER, EMAIL_PASS');
  console.log('Application will continue without email notifications');
  
  // CRITICAL: Prevent undefined errors by setting to null
  global.transporter = null;
  global.emailWorking = false;
}

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/work', workRoutes);

// Health check route for debugging
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    emailConfigured: !!global.transporter,
    emailWorking: global.emailWorking || false,
    jwtSecretSet: !!process.env.JWT_SECRET,
    database: 'SQLite'
  });
});

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
  console.error('=== SERVER ERROR ===');
  console.error('Error:', err);
  console.error('Stack:', err.stack);
  console.error('Request URL:', req.url);
  console.error('Request Method:', req.method);
  console.error('Request Headers:', req.headers);
  console.error('Request Body:', req.body);
  
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
    error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Start Server
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Database: SQLite`);
  console.log(`JWT Secret: ${process.env.JWT_SECRET ? 'Set' : 'MISSING'}`);
  console.log(`Email: ${global.transporter ? 'Configured' : 'Disabled'}`);
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