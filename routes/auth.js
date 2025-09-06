const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { dbGet, dbRun } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const User = require('../models/User');
const { google } = require('googleapis');

// Initialize OAuth2 client only if credentials are provided
let oauth2Client = null;
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI) {
  oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  
  console.log('=== LOGIN ATTEMPT ===');
  console.log('Email:', email);
  console.log('JWT_SECRET exists:', !!process.env.JWT_SECRET);

  try {
    const user = await User.findByEmail(email);
    if (!user) {
      console.log('User not found:', email);
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    console.log('User found:', { id: user.id, email: user.email, role: user.role });

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      console.log('Password does not match for user:', email);
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (!user.isActive) {
      console.log('User account is deactivated:', email);
      return res.status(403).json({ message: 'Account is deactivated' });
    }

    await user.updateLastLogin();

    // Create JWT token with all necessary user information
    const tokenPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name
    };

    console.log('Creating token with payload:', tokenPayload);

    const token = jwt.sign(
      tokenPayload,
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log('Token created successfully');
    console.log('Token starts with:', token.substring(0, 20) + '...');

    // Verify the token was created correctly
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('Token verification check - decoded payload:', decoded);

    res.json({
      token,
      user: user.toJSON()
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/register', authenticateToken, requireAdmin, async (req, res) => {
  console.log('=== REGISTER ATTEMPT ===');
  console.log('Request body:', req.body);
  console.log('Authenticated user:', req.user);

  const { name, email, password, role } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      role
    });
    
    console.log('User created successfully:', user.toJSON());
    res.json({ user: user.toJSON() });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(400).json({ message: error.message });
  }
});

router.get('/verify', authenticateToken, async (req, res) => {
  console.log('=== TOKEN VERIFICATION ===');
  console.log('User from token:', req.user);
  
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      console.log('User not found in database:', req.user.id);
      return res.status(404).json({ message: 'User not found' });
    }
    
    console.log('User verification successful:', user.toJSON());
    res.json({ user: user.toJSON() });
  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Google OAuth Routes
router.get('/google', authenticateToken, (req, res) => {
  if (!oauth2Client) {
    return res.status(500).json({ message: 'Google OAuth not configured' });
  }

  try {
    const tempToken = jwt.sign(
      { userId: req.user.id, type: 'oauth_temp' },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar.events'],
      state: tempToken,
    });
    
    res.redirect(url);
  } catch (error) {
    console.error('Error generating Google OAuth URL:', error);
    res.status(500).json({ message: 'Failed to generate OAuth URL' });
  }
});

router.get('/google/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!oauth2Client) {
    return res.redirect(`${process.env.REACT_APP_FRONTEND_URL || 'http://localhost:3000'}?googleAuth=error&reason=not_configured`);
  }

  try {
    const decoded = jwt.verify(state, process.env.JWT_SECRET);
    
    if (decoded.type !== 'oauth_temp') {
      return res.status(400).json({ message: 'Invalid OAuth state' });
    }

    const userId = decoded.userId;
    const { tokens } = await oauth2Client.getToken(code);
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    await dbRun(
      'UPDATE users SET googleAccessToken = ?, googleRefreshToken = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
      [tokens.access_token, tokens.refresh_token, userId]
    );

    const redirectUrl = user.role === 'admin' 
      ? `${process.env.REACT_APP_FRONTEND_URL || 'http://localhost:3000'}/admin`
      : `${process.env.REACT_APP_FRONTEND_URL || 'http://localhost:3000'}/worker`;
    
    res.redirect(`${redirectUrl}?googleAuth=success`);
    
  } catch (error) {
    console.error('Error in Google OAuth callback:', error);
    
    const errorRedirectUrl = `${process.env.REACT_APP_FRONTEND_URL || 'http://localhost:3000'}?googleAuth=error`;
    res.redirect(errorRedirectUrl);
  }
});

// Check Google Calendar connection status
router.get('/google/status', authenticateToken, async (req, res) => {
  try {
    const user = await dbGet(
      'SELECT googleAccessToken, googleRefreshToken FROM users WHERE id = ?',
      [req.user.id]
    );

    const isConnected = !!(user && user.googleAccessToken && user.googleRefreshToken);
    
    res.json({ 
      connected: isConnected,
      message: isConnected ? 'Google Calendar connected' : 'Google Calendar not connected'
    });
  } catch (error) {
    console.error('Error checking Google Calendar status:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Disconnect Google Calendar
router.post('/google/disconnect', authenticateToken, async (req, res) => {
  try {
    await dbRun(
      'UPDATE users SET googleAccessToken = NULL, googleRefreshToken = NULL, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
      [req.user.id]
    );

    res.json({ message: 'Google Calendar disconnected successfully' });
  } catch (error) {
    console.error('Error disconnecting Google Calendar:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;