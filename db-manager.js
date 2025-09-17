// db-manager.js
const { db } = require('./config/database');
const bcrypt = require('bcryptjs');

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'list-users':
    db.all('SELECT id, name, email, role, createdAt FROM users ORDER BY id', (err, rows) => {
      if (err) {
        console.error('Error:', err);
      } else {
        console.log('\nAll Users:');
        console.table(rows);
      }
      db.close();
    });
    break;

  case 'delete-user':
    const userId = args[1];
    if (!userId) {
      console.log('Usage: node db-manager.js delete-user <user_id>');
      console.log('Example: node db-manager.js delete-user 2');
      db.close();
      return;
    }
    
    db.get('SELECT id, name, email, role FROM users WHERE id = ?', [userId], (err, user) => {
      if (err) {
        console.error('Error:', err);
        db.close();
        return;
      }
      
      if (!user) {
        console.log(`User with ID ${userId} not found`);
        db.close();
        return;
      }
      
      console.log(`Found user: ${user.name} (${user.email}) - ${user.role}`);
      
      db.run('BEGIN TRANSACTION');
      db.run('DELETE FROM work_items WHERE workerId = ?', [userId], function(err) {
        if (err) {
          console.error('Error deleting user tasks:', err);
          db.run('ROLLBACK');
          db.close();
          return;
        }
        
        db.run('DELETE FROM users WHERE id = ?', [userId], function(err) {
          if (err) {
            console.error('Error deleting user:', err);
            db.run('ROLLBACK');
          } else {
            console.log(`Successfully deleted user with ID ${userId}`);
            db.run('COMMIT');
          }
          db.close();
        });
      });
    });
    break;

  case 'delete-all-workers':
    db.run('BEGIN TRANSACTION');
    db.run('DELETE FROM work_items WHERE workerId IN (SELECT id FROM users WHERE role = "worker")', function(err) {
      if (err) {
        console.error('Error deleting worker tasks:', err);
        db.run('ROLLBACK');
        db.close();
        return;
      }
      
      db.run('DELETE FROM users WHERE role = "worker"', function(err) {
        if (err) {
          console.error('Error deleting workers:', err);
          db.run('ROLLBACK');
        } else {
          console.log(`Deleted ${this.changes} worker account(s)`);
          db.run('COMMIT');
        }
        db.close();
      });
    });
    break;

  case 'reset-admin':
    const resetAdmin = async () => {
      try {
        const hashedPassword = await bcrypt.hash('admin123', 10);
        db.run('BEGIN TRANSACTION');
        db.run(`
          UPDATE users 
          SET password = ?, name = 'Admin' 
          WHERE role = 'admin' AND email = 'admin@taskpilot.com'
        `, [hashedPassword], function(err) {
          if (err) {
            console.error('Error:', err);
            db.run('ROLLBACK');
          } else if (this.changes > 0) {
            console.log('Admin password reset to: admin123');
            db.run('COMMIT');
          } else {
            console.log('No admin user found to reset');
            db.run('ROLLBACK');
          }
          db.close();
        });
      } catch (error) {
        console.error('Error hashing password:', error);
        db.run('ROLLBACK');
        db.close();
      }
    };
    resetAdmin();
    break;

  default:
    console.log(`
Database Manager Commands:

  list-users           - Show all users with their IDs
  delete-user <id>     - Delete specific user by ID
  delete-all-workers   - Delete all worker accounts (keep admins)
  reset-admin          - Reset admin password to 'admin123'

Usage Examples:
  node db-manager.js list-users
  node db-manager.js delete-user 3
  node db-manager.js delete-all-workers
  node db-manager.js reset-admin
    `);
    db.close();
}

process.on('SIGINT', () => {
  db.close();
  process.exit();
});