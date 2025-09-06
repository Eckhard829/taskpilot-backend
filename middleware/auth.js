// Updated middleware/auth.js with better debugging
const jwt = require('jsonwebtoken');

const authenticateToken = (req, res, next) => {
  // Debug: Log all headers to see what's being sent
  console.log('=== Authentication Debug ===');
  console.log('Request URL:', req.url);
  console.log('Request Method:', req.method);
  console.log('Authorization Header:', req.headers.authorization);
  console.log('All Headers:', JSON.stringify(req.headers, null, 2));
  
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  console.log('Auth Header:', authHeader);
  console.log('Extracted Token:', token ? 'Present' : 'Missing');
  
  if (!token) {
    console.log('❌ No token provided');
    return res.status(401).json({ 
      message: 'No token provided',
      debug: {
        authHeader: authHeader || 'missing',
        headers: Object.keys(req.headers)
      }
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      console.log('❌ Token verification failed:', err.message);
      return res.status(403).json({ 
        message: 'Invalid token',
        debug: {
          error: err.message,
          tokenStart: token.substring(0, 20) + '...'
        }
      });
    }
    
    console.log('✅ Token verified for user:', user.email);
    req.user = user;
    next();
  });
};

const requireAdmin = (req, res, next) => {
  console.log('=== Admin Check ===');
  console.log('User role:', req.user?.role);
  
  if (req.user && req.user.role === 'admin') {
    console.log('✅ Admin access granted');
    next();
  } else {
    console.log('❌ Admin access denied');
    res.status(403).json({ 
      message: 'Admin access required',
      debug: {
        userRole: req.user?.role || 'undefined',
        userId: req.user?.id || 'undefined'
      }
    });
  }
};

module.exports = { authenticateToken, requireAdmin };