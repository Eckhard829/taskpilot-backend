// routes/auth.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { dbGet, dbRun } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const User = require('../models/User');
const { google } = require('googleapis');

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
  console.log('Password provided:', !!password);
  console.log('JWT_SECRET exists:', !!process.env.JWT_SECRET);

  if (!email || !password) {
    console.log('Missing email or password');
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    const user = await User.findByEmail(email.toLowerCase().trim());
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
      { expiresIn: '1h' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: user.toJSON()
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/google', (req, res) => {
  if (!oauth2Client) {
    console.error('Google OAuth not configured');
    return res.status(500).json({ message: 'Google OAuth not configured' });
  }

  const scopes = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/calendar.events'
  ];

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent'
  });

  res.redirect(url);
});

router.get('/google/callback', async (req, res) => {
  try {
    if (!oauth2Client) {
      console.error('Google OAuth not configured');
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}?googleAuth=error`);
    }

    const { code } = req.query;
    if (!code) {
      console.error('No code provided in Google OAuth callback');
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}?googleAuth=error`);
    }

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();

    let user = await User.findByEmail(data.email.toLowerCase().trim());
    let userId;

    if (!user) {
      const hashedPassword = await bcrypt.hash('google-auth-' + Math.random().toString(36).slice(2), 10);
      const newUser = await User.create({
        name: data.name || 'Google User',
        email: data.email.toLowerCase().trim(),
        password: hashedPassword,
        role: 'worker'
      });
      userId = newUser.id;
    } else {
      userId = user.id;
    }

    await dbRun(
      'UPDATE users SET googleAccessToken = ?, googleRefreshToken = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
      [tokens.access_token, tokens.refresh_token, userId]
    );

    const redirectUrl = user && user.role === 'admin' 
      ? `${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin`
      : `${process.env.FRONTEND_URL || 'http://localhost:3000'}/worker`;
    
    res.redirect(`${redirectUrl}?googleAuth=success`);
  } catch (error) {
    console.error('Error in Google OAuth callback:', error);
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}?googleAuth=error`);
  }
});

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