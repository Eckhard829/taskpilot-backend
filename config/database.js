// database.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, '../database.sqlite');
console.log('Database path:', dbPath);

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database at:', dbPath);
    db.configure('busyTimeout', 10000);
    
    db.run('PRAGMA foreign_keys = ON', (err) => {
      if (err) {
        console.error('Error enabling foreign keys:', err);
      } else {
        console.log('Foreign keys enabled');
      }
    });
    
    db.run('PRAGMA journal_mode = WAL', (err) => {
      if (err) {
        console.error('Error setting journal mode:', err);
      } else {
        console.log('WAL mode enabled');
      }
    });
  }
});

const initializeDatabase = () => {
  db.serialize(() => {
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
      }
    });

    db.run(`
      CREATE TABLE IF NOT EXISTS work_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workerId INTEGER NOT NULL,
        task TEXT NOT NULL,
        description TEXT,
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
        FOREIGN KEY (workerId) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (assignedBy) REFERENCES users(id),
        FOREIGN KEY (reviewedBy) REFERENCES users(id)
      )
    `, (err) => {
      if (err) {
        console.error('Error creating work_items table:', err);
      } else {
        console.log('Work_items table ready');
      }
    });
  });
};

const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        console.error('Database GET error:', {
          sql: sql.substring(0, 100) + '...',
          params,
          error: err.message
        });
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
};

const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        console.error('Database ALL error:', {
          sql: sql.substring(0, 100) + '...',
          params,
          error: err.message
        });
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
};

const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) {
        console.error('Database RUN error:', {
          sql: sql.substring(0, 100) + '...',
          params,
          error: err.message,
          code: err.code
        });
        reject(err);
      } else {
        console.log('Database RUN success:', {
          lastID: this.lastID,
          changes: this.changes,
          sql: sql.substring(0, 50) + '...'
        });
        resolve({ id: this.lastID, changes: this.changes });
      }
    });
  });
};

const checkDatabaseHealth = () => {
  return new Promise((resolve, reject) => {
    db.get('SELECT 1 as test', [], (err, row) => {
      if (err) {
        console.error('Database health check failed:', err);
        reject(err);
      } else {
        console.log('Database health check passed');
        resolve(row);
      }
    });
  });
};

process.on('SIGINT', () => {
  console.log('Closing database connection...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed.');
    }
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('Closing database connection...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed.');
    }
    process.exit(0);
  });
});

module.exports = {
  db,
  dbGet,
  dbAll,
  dbRun,
  initializeDatabase,
  checkDatabaseHealth
};