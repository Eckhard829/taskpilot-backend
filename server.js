require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { initializeDatabase, db } = require('./config/database');
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const workRoutes = require('./routes/work');

const app = express();

// Middleware
app.use(cors({
  origin: process.env.REACT_APP_FRONTEND_URL || 'http://localhost:3000', // Adjust for deployment
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));
app.use(express.json());

// Initialize SQLite Database
initializeDatabase();

// Nodemailer Configuration with connection pooling
let transporter = null;
if (process.env.EMAIL_SERVICE && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  transporter = nodemailer.createTransport({
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
      console.error('❌ Nodemailer configuration error:', error);
    } else {
      console.log('✅ Nodemailer is ready to send emails');
    }
  });
} else {
  console.log('⚠️ Email configuration not found - email notifications disabled');
}

app.set('transporter', transporter);
global.transporter = transporter;

// Health check endpoint with database ping
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
      database: 'SQLite',
      timestamp: new Date().toISOString() 
    });
  } catch (error) {
    res.status(500).json({ status: 'ERROR', message: 'Database not ready' });
  }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/work', workRoutes);

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Database: SQLite (file-based)`);
  console.log(`🔐 Default admin: admin@taskpilot.com / admin123`);
});