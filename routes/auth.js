const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { dbGet, dbRun } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const User = require('../models/User');
const { google } = require('googleapis');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findByEmail(email);
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (!user.isActive) {
      return res.status(403).json({ message: 'Account is deactivated' });
    }

    await user.updateLastLogin();

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

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
  const { name, email, password, role } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      role
    });
    res.json({ user: user.toJSON() });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(400).json({ message: error.message });
  }
});

router.get('/verify', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ user: user.toJSON() });
  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Google OAuth Routes
router.get('/google', authenticateToken, (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar.events'],
    state: JSON.stringify({ userId: req.user.id }),
  });
  res.redirect(url);
});

router.get('/google/callback', async (req, res) => {
  const { code, state } = req.query;
  const { userId } = JSON.parse(state);

  try {
    const { tokens } = await oauth2Client.getToken(code);
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    await dbRun(
      'UPDATE users SET googleAccessToken = ?, googleRefreshToken = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
      [tokens.access_token, tokens.refresh_token, userId]
    );

    res.redirect(`${process.env.REACT_APP_FRONTEND_URL}/worker`); // Redirect to worker dashboard
  } catch (error) {
    console.error('Error in Google OAuth callback:', error);
    res.status(500).json({ message: 'Error authenticating with Google' });
  }
});

module.exports = router;