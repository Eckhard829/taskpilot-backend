// middleware/auth.js - Complete file with fixes
const jwt = require('jsonwebtoken');

const authenticateToken = (req, res, next) => {
  console.log('=== Authentication Debug ===');
  console.log('Request URL:', req.url);
  console.log('Request Method:', req.method);
  console.log('Authorization Header:', req.headers.authorization);
  
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  console.log('Auth Header:', authHeader);
  console.log('Extracted Token:', token ? 'Present' : 'Missing');
  
  if (!token) {
    console.log('ERROR: No token provided');
    return res.status(401).json({ 
      message: 'No token provided',
      debug: {
        authHeader: authHeader || 'missing',
        headers: Object.keys(req.headers)
      }
    });
  }

  // Check if JWT_SECRET is set
  if (!process.env.JWT_SECRET) {
    console.error('CRITICAL ERROR: JWT_SECRET is not set in environment variables');
    return res.status(500).json({ 
      message: 'Server configuration error',
      debug: 'JWT_SECRET not configured'
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      console.log('ERROR: Token verification failed:', err.message);
      return res.status(403).json({ 
        message: 'Invalid token',
        debug: {
          error: err.message,
          tokenStart: token.substring(0, 20) + '...'
        }
      });
    }
    
    console.log('SUCCESS: Token verified for user:', user);
    console.log('User ID:', user.id);
    console.log('User Role:', user.role);
    console.log('User Email:', user.email);
    
    req.user = user;
    next();
  });
};

const requireAdmin = (req, res, next) => {
  console.log('=== Admin Check ===');
  console.log('Full user object:', req.user);
  console.log('User role:', req.user?.role);
  console.log('Role type:', typeof req.user?.role);
  console.log('Role comparison result:', req.user?.role === 'admin');
  
  if (!req.user) {
    console.log('ERROR: No user object found in request');
    return res.status(401).json({ 
      message: 'Authentication required',
      debug: 'No user object in request'
    });
  }

  if (req.user.role === 'admin') {
    console.log('SUCCESS: Admin access granted');
    next();
  } else {
    console.log('ERROR: Admin access denied');
    console.log('Expected: admin');
    console.log('Received:', req.user.role);
    
    res.status(403).json({ 
      message: 'Admin access required',
      debug: {
        userRole: req.user?.role || 'undefined',
        userId: req.user?.id || 'undefined',
        userEmail: req.user?.email || 'undefined'
      }
    });
  }
};

module.exports = { authenticateToken, requireAdmin };