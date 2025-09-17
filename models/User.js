const { dbGet, dbAll, dbRun } = require('../config/database');
const bcrypt = require('bcryptjs');

class User {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.email = data.email;
    this.password = data.password;
    this.role = data.role;
    this.isActive = data.isActive;
    this.lastLogin = data.lastLogin;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }

  // Create a new user
  static async create(userData) {
    const { name, email, password, role = 'worker' } = userData;
    
    // Validate email format
    const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
    if (!emailRegex.test(email)) {
      throw new Error('Please provide a valid email');
    }

    // Validate name length
    if (name.length > 100) {
      throw new Error('Name cannot be longer than 100 characters');
    }

    // Validate password length
    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters long');
    }

    // Validate role
    if (!['admin', 'worker'].includes(role)) {
      throw new Error('Role must be either admin or worker');
    }

    try {
      const result = await dbRun(`
        INSERT INTO users (name, email, password, role, updatedAt)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [name, email.toLowerCase().trim(), password, role]);

      return await User.findById(result.id);
    } catch (error) {
      if (error.message.includes('UNIQUE constraint failed')) {
        throw new Error('User already exists');
      }
      throw error;
    }
  }

  // Find user by ID
  static async findById(id) {
    const row = await dbGet('SELECT * FROM users WHERE id = ?', [id]);
    return row ? new User(row) : null;
  }

  // Find user by email
  static async findByEmail(email) {
    const row = await dbGet('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    return row ? new User(row) : null;
  }

  // Find all users
  static async findAll(filters = {}) {
    let sql = 'SELECT * FROM users WHERE 1=1';
    const params = [];

    if (filters.role) {
      sql += ' AND role = ?';
      params.push(filters.role);
    }

    if (filters.isActive !== undefined) {
      sql += ' AND isActive = ?';
      params.push(filters.isActive ? 1 : 0);
    }

    sql += ' ORDER BY createdAt DESC';

    const rows = await dbAll(sql, params);
    return rows.map(row => new User(row));
  }

  // Find active users
  static async findActive() {
    return await User.findAll({ isActive: true });
  }

  // Count users
  static async count(filters = {}) {
    let sql = 'SELECT COUNT(*) as count FROM users WHERE 1=1';
    const params = [];

    if (filters.role) {
      sql += ' AND role = ?';
      params.push(filters.role);
    }

    const result = await dbGet(sql, params);
    return result.count;
  }

  // Update user
  async update(updateData) {
    const allowedFields = ['name', 'email', 'isActive', 'lastLogin'];
    const updates = [];
    const params = [];

    for (const [key, value] of Object.entries(updateData)) {
      if (allowedFields.includes(key)) {
        updates.push(`${key} = ?`);
        params.push(key === 'email' ? value.toLowerCase().trim() : value);
      }
    }

    if (updates.length === 0) {
      throw new Error('No valid fields to update');
    }

    updates.push('updatedAt = CURRENT_TIMESTAMP');
    params.push(this.id);

    const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
    
    await dbRun(sql, params);
    
    // Refresh the instance
    const updated = await User.findById(this.id);
    Object.assign(this, updated);
    return this;
  }

  // Delete user
  async delete() {
    await dbRun('DELETE FROM users WHERE id = ?', [this.id]);
  }

  // Instance methods
  isAdmin() {
    return this.role === 'admin';
  }

  isWorker() {
    return this.role === 'worker';
  }

  // Compare password
  async comparePassword(password) {
    return await bcrypt.compare(password, this.password);
  }

  // Update last login
  async updateLastLogin() {
    await dbRun('UPDATE users SET lastLogin = CURRENT_TIMESTAMP WHERE id = ?', [this.id]);
    this.lastLogin = new Date().toISOString();
  }

  // Convert to JSON (exclude password)
  toJSON() {
    const { password, ...userWithoutPassword } = this;
    return userWithoutPassword;
  }
}

module.exports = User;