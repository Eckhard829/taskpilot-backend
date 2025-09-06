const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

// Create database connection with optimized settings
const dbPath = path.join(__dirname, '../database.sqlite');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    db.configure('busyTimeout', 5000);
  }
});

// Initialize database tables
const initializeDatabase = () => {
  db.serialize(() => {
    // Users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'worker' CHECK (role IN ('admin', 'worker')),
        isActive BOOLEAN DEFAULT 1,
        lastLogin DATETIME,
        googleAccessToken TEXT,
        googleRefreshToken TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) {
        console.error('Error creating users table:', err);
      } else {
        console.log('Users table ready');
        
        // Check if Google OAuth columns exist and add them if they don't
        db.all("PRAGMA table_info(users)", (err, columns) => {
          if (!err) {
            const columnNames = columns.map(col => col.name);
            if (!columnNames.includes('googleAccessToken')) {
              db.run('ALTER TABLE users ADD COLUMN googleAccessToken TEXT', (err) => {
                if (!err) console.log('Added googleAccessToken column to users');
              });
            }
            if (!columnNames.includes('googleRefreshToken')) {
              db.run('ALTER TABLE users ADD COLUMN googleRefreshToken TEXT', (err) => {
                if (!err) console.log('Added googleRefreshToken column to users');
              });
            }
          }
        });
      }
    });

    // Work items table with complete schema
    db.run(`
      CREATE TABLE IF NOT EXISTS work_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workerId INTEGER NOT NULL,
        task TEXT NOT NULL,
        description TEXT DEFAULT '',
        instructions TEXT NOT NULL,
        deadline DATETIME NOT NULL,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'approved', 'rejected')),
        assignedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        submittedAt DATETIME,
        reviewedAt DATETIME,
        explanation TEXT,
        workLink TEXT,
        reviewNotes TEXT,
        assignedBy INTEGER NOT NULL,
        reviewedBy INTEGER,
        FOREIGN KEY (workerId) REFERENCES users (id),
        FOREIGN KEY (assignedBy) REFERENCES users (id),
        FOREIGN KEY (reviewedBy) REFERENCES users (id)
      )
    `, (err) => {
      if (err) {
        console.error('Error creating work_items table:', err);
      } else {
        console.log('Work items table ready');
        
        db.all("PRAGMA table_info(work_items)", (err, columns) => {
          if (!err) {
            const columnNames = columns.map(col => col.name);
            if (!columnNames.includes('workLink')) {
              db.run('ALTER TABLE work_items ADD COLUMN workLink TEXT', (err) => {
                if (!err) console.log('Added workLink column to work_items');
              });
            }
            if (!columnNames.includes('reviewNotes')) {
              db.run('ALTER TABLE work_items ADD COLUMN reviewNotes TEXT', (err) => {
                if (!err) console.log('Added reviewNotes column to work_items');
              });
            }
          }
        });
      }
    });

    // Create admin user if it doesn't exist
    db.get('SELECT * FROM users WHERE email = ?', ['admin@taskpilot.com'], async (err, row) => {
      if (err) {
        console.error('Error checking for admin user:', err);
      } else if (!row) {
        try {
          const hashedPassword = await bcrypt.hash('admin123', 10);
          db.run(`
            INSERT INTO users (name, email, password, role)
            VALUES (?, ?, ?, ?)
          `, ['Admin', 'admin@taskpilot.com', hashedPassword, 'admin'], (err) => {
            if (err) {
              console.error('Error creating admin user:', err);
            } else {
              console.log('Default admin user created (admin@taskpilot.com / admin123)');
            }
          });
        } catch (error) {
          console.error('Error hashing admin password:', error);
        }
      }
    });
  });
};

// Helper function to promisify database operations
const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

module.exports = {
  db,
  dbGet,
  dbAll,
  dbRun,
  initializeDatabase
};