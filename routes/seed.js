const express = require('express');
const router = express.Router();
const User = require('../models/User');
const bcrypt = require('bcryptjs');

router.post('/', async (req, res) => {
  try {
    const adminExists = await User.findOne({ email: 'admin@taskpilot.com' });
    if (adminExists) {
      return res.status(400).json({ message: 'Admin user already exists' });
    }

    const hashedPassword = await bcrypt.hash('admin123', 10);
    const adminUser = new User({
      name: 'Admin',
      email: 'admin@taskpilot.com',
      password: hashedPassword,
      role: 'admin',
    });

    await adminUser.save();
    res.status(201).json({ message: 'Admin user created successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;