require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { initializeDatabase, db } = require('./config/database');
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const workRoutes = require('./routes/work');

const app = express();

// Check if JWT_SECRET is set
if (!process.env.JWT_SECRET) {
  console.error('CRITICAL ERROR: JWT_SECRET is not set in environment variables');
  console.error('Please set JWT_SECRET in your .env file');
  process.exit(1);
}

console.log('JWT_SECRET is properly configured');
console.log('JWT_SECRET length:', process.env.JWT_SECRET.length);

const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.REACT_APP_FRONTEND_URL,
  'https://taskpillot.netlify.app', // Fixed: Added the correct domain with double 'l'
  'https://taskpilot.netlify.app',   // Keep the old one in case you switch back
  'http://localhost:3000',
  'http://localhost:3001'
].filter(Boolean);

console.log('Allowed CORS origins:', allowedOrigins);

app.use(cors({
  origin: function (origin, callback) {
    console.log('CORS check - Request origin:', origin);
    
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Check if origin is in allowed list or contains netlify.app
    if (allowedOrigins.includes(origin) || origin.includes('netlify.app')) {
      console.log('CORS allowed for origin:', origin);
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

// Handle preflight OPTIONS requests explicitly
app.options('*', cors());

// Additional manual CORS headers for extra safety
app.use((req, res, next) => {
  const origin = req.headers.origin;
  console.log('Manual CORS header check - Origin:', origin);
  
  if (allowedOrigins.includes(origin) || (origin && origin.includes('netlify.app'))) {
    res.header('Access-Control-Allow-Origin', origin);
    console.log('Manual CORS header set for origin:', origin);
  }
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Initialize database
initializeDatabase();

// Email configuration
let transporter = null;
if (process.env.EMAIL_SERVICE && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  try {
    transporter = nodemailer.createTransporter({
      service: process.env.EMAIL_SERVICE,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
    
    global.transporter = transporter;
    
    transporter.verify((error, success) => {
      if (error) {
        console.error('Email service setup failed:', error);
        global.emailWorking = false;
      } else {
        console.log('Email service is ready');
        global.emailWorking = true;
      }
    });
  } catch (error) {
    console.error('Error creating email transporter:', error);
    global.transporter = null;
    global.emailWorking = false;
  }
} else {
  console.log('Email service not configured');
  global.transporter = null;
  global.emailWorking = false;
}

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/work', workRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    jwt_configured: !!process.env.JWT_SECRET,
    email_configured: !!global.transporter,
    email_working: !!global.emailWorking
  });
});

// 404 handler
app.use('*', (req, res) => {
  console.log(`404 - Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    message: 'Route not found',
    path: req.originalUrl,
    method: req.method
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ 
      message: 'CORS error - origin not allowed',
      origin: req.headers.origin,
      allowedOrigins: allowedOrigins
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

const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Database: SQLite`);
  console.log(`JWT Secret: ${process.env.JWT_SECRET ? 'Set (' + process.env.JWT_SECRET.length + ' chars)' : 'MISSING'}`);
  console.log(`Email: ${global.transporter ? 'Configured' : 'Disabled'}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Allowed CORS Origins:`, allowedOrigins);
});

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