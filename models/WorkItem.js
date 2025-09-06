const { dbGet, dbAll, dbRun } = require('../config/database');

class WorkItem {
  constructor(data) {
    this.id = data.id;
    this.workerId = data.workerId;
    this.task = data.task;
    this.description = data.description;
    this.instructions = data.instructions;
    this.deadline = data.deadline;
    this.status = data.status;
    this.assignedAt = data.assignedAt;
    this.submittedAt = data.submittedAt;
    this.reviewedAt = data.reviewedAt;
    this.explanation = data.explanation;
    this.workLink = data.workLink;
    this.reviewNotes = data.reviewNotes;
    this.assignedBy = data.assignedBy;
    this.reviewedBy = data.reviewedBy;
  }

  // Create a new work item
  static async create(workItemData) {
    const { 
      workerId, 
      task, 
      description = '',
      instructions, 
      deadline, 
      assignedBy, 
      status = 'pending' 
    } = workItemData;

    // Validate task length
    if (task.length > 200) {
      throw new Error('Task cannot be longer than 200 characters');
    }

    // Validate required fields
    if (!workerId || !task || !instructions || !deadline || !assignedBy) {
      throw new Error('All required fields must be provided');
    }

    // Validate status
    if (!['pending', 'submitted', 'approved', 'rejected'].includes(status)) {
      throw new Error('Status must be pending, submitted, approved, or rejected');
    }

    // Validate URL if provided
    if (workItemData.workLink) {
      const urlRegex = /^https?:\/\/[^\s$.?#].[^\s]*$/;
      if (!urlRegex.test(workItemData.workLink)) {
        throw new Error('Please provide a valid URL');
      }
    }

    try {
      const result = await dbRun(`
        INSERT INTO work_items (workerId, task, description, instructions, deadline, status, assignedBy)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [workerId, task.trim(), description.trim(), instructions.trim(), deadline, status, assignedBy]);

      return await WorkItem.findById(result.id);
    } catch (error) {
      console.error('Database error in WorkItem.create:', error);
      throw new Error(`Failed to create work item: ${error.message}`);
    }
  }

  // Find work item by ID with populated user data
  static async findById(id) {
    try {
      const row = await dbGet(`
        SELECT wi.*, 
               u1.name as workerName, u1.email as workerEmail,
               u2.name as assignedByName, u2.email as assignedByEmail,
               u3.name as reviewedByName, u3.email as reviewedByEmail
        FROM work_items wi
        LEFT JOIN users u1 ON wi.workerId = u1.id
        LEFT JOIN users u2 ON wi.assignedBy = u2.id
        LEFT JOIN users u3 ON wi.reviewedBy = u3.id
        WHERE wi.id = ?
      `, [id]);
      
      if (!row) return null;

      const workItem = new WorkItem(row);
      // Add populated data
      workItem.worker = { id: row.workerId, name: row.workerName, email: row.workerEmail };
      workItem.assignedByUser = { id: row.assignedBy, name: row.assignedByName, email: row.assignedByEmail };
      if (row.reviewedBy) {
        workItem.reviewedByUser = { id: row.reviewedBy, name: row.reviewedByName, email: row.reviewedByEmail };
      }
      
      return workItem;
    } catch (error) {
      console.error('Database error in WorkItem.findById:', error);
      throw new Error(`Failed to find work item: ${error.message}`);
    }
  }

  // Find all work items with optional filters
  static async findAll(filters = {}) {
    try {
      let sql = `
        SELECT wi.*, 
               u1.name as workerName, u1.email as workerEmail,
               u2.name as assignedByName, u2.email as assignedByEmail,
               u3.name as reviewedByName, u3.email as reviewedByEmail
        FROM work_items wi
        LEFT JOIN users u1 ON wi.workerId = u1.id
        LEFT JOIN users u2 ON wi.assignedBy = u2.id
        LEFT JOIN users u3 ON wi.reviewedBy = u3.id
        WHERE 1=1
      `;
      const params = [];

      if (filters.workerId) {
        sql += ' AND wi.workerId = ?';
        params.push(filters.workerId);
      }

      if (filters.status) {
        sql += ' AND wi.status = ?';
        params.push(filters.status);
      }

      if (filters.assignedBy) {
        sql += ' AND wi.assignedBy = ?';
        params.push(filters.assignedBy);
      }

      sql += ' ORDER BY wi.assignedAt DESC';

      const rows = await dbAll(sql, params);
      return rows.map(row => {
        const workItem = new WorkItem(row);
        // Add populated data
        workItem.worker = { id: row.workerId, name: row.workerName, email: row.workerEmail };
        workItem.assignedByUser = { id: row.assignedBy, name: row.assignedByName, email: row.assignedByEmail };
        if (row.reviewedBy) {
          workItem.reviewedByUser = { id: row.reviewedBy, name: row.reviewedByName, email: row.reviewedByEmail };
        }
        return workItem;
      });
    } catch (error) {
      console.error('Database error in WorkItem.findAll:', error);
      throw new Error(`Failed to find work items: ${error.message}`);
    }
  }

  // Count work items
  static async count(filters = {}) {
    try {
      let sql = 'SELECT COUNT(*) as count FROM work_items WHERE 1=1';
      const params = [];

      if (filters.status) {
        sql += ' AND status = ?';
        params.push(filters.status);
      }

      if (filters.workerId) {
        sql += ' AND workerId = ?';
        params.push(filters.workerId);
      }

      const result = await dbGet(sql, params);
      return result.count;
    } catch (error) {
      console.error('Database error in WorkItem.count:', error);
      throw new Error(`Failed to count work items: ${error.message}`);
    }
  }

  // Update work item
  async update(updateData) {
    try {
      const allowedFields = ['task', 'description', 'instructions', 'deadline', 'status', 'submittedAt', 'reviewedAt', 'explanation', 'workLink', 'reviewNotes', 'reviewedBy'];
      const updates = [];
      const params = [];

      for (const [key, value] of Object.entries(updateData)) {
        if (allowedFields.includes(key) && value !== undefined) {
          updates.push(`${key} = ?`);
          params.push(key === 'task' || key === 'description' || key === 'instructions' || key === 'explanation' || key === 'reviewNotes' ? 
            (value ? value.trim() : value) : value);
        }
      }

      if (updates.length === 0) {
        throw new Error('No valid fields to update');
      }

      params.push(this.id);

      await dbRun(`UPDATE work_items SET ${updates.join(', ')} WHERE id = ?`, params);
      
      // Refresh the instance
      const updated = await WorkItem.findById(this.id);
      Object.assign(this, updated);
      return this;
    } catch (error) {
      console.error('Database error in WorkItem.update:', error);
      throw new Error(`Failed to update work item: ${error.message}`);
    }
  }

  // Delete work item
  async delete() {
    try {
      await dbRun('DELETE FROM work_items WHERE id = ?', [this.id]);
    } catch (error) {
      console.error('Database error in WorkItem.delete:', error);
      throw new Error(`Failed to delete work item: ${error.message}`);
    }
  }

  // IMPROVED Mark as completed/submitted with better error handling
  async markCompleted(completionData = {}) {
    console.log('=== WorkItem.markCompleted called ===');
    console.log('Task ID:', this.id);
    console.log('Current status:', this.status);
    console.log('Completion data:', completionData);
    
    try {
      // Validate completion data
      if (!completionData.explanation || !completionData.explanation.trim()) {
        throw new Error('Explanation is required to mark task as completed');
      }

      const updateData = {
        status: 'submitted',
        submittedAt: new Date().toISOString(),
        explanation: completionData.explanation.trim(),
        workLink: completionData.workLink || null
      };

      console.log('Update data prepared:', updateData);
      console.log('Calling this.update...');

      const result = await this.update(updateData);
      
      console.log('✅ WorkItem.markCompleted successful');
      return result;
      
    } catch (error) {
      console.error('❌ Error in WorkItem.markCompleted:', error);
      console.error('Error stack:', error.stack);
      throw new Error(`Failed to mark task as completed: ${error.message}`);
    }
  }

  // Approve work item
  async approve(reviewData = {}) {
    try {
      const updateData = {
        status: 'approved',
        reviewedAt: new Date().toISOString(),
        reviewNotes: reviewData.reviewNotes,
        reviewedBy: reviewData.reviewedBy
      };

      return await this.update(updateData);
    } catch (error) {
      console.error('Error in WorkItem.approve:', error);
      throw new Error(`Failed to approve work item: ${error.message}`);
    }
  }

  // Reject work item
  async reject(reviewData) {
    try {
      if (!reviewData.reviewNotes) {
        throw new Error('Review notes are required when rejecting work');
      }

      const updateData = {
        status: 'rejected',
        reviewedAt: new Date().toISOString(),
        reviewNotes: reviewData.reviewNotes,
        reviewedBy: reviewData.reviewedBy,
        // Clear submission data when rejecting
        submittedAt: null,
        explanation: null,
        workLink: null
      };

      return await this.update(updateData);
    } catch (error) {
      console.error('Error in WorkItem.reject:', error);
      throw new Error(`Failed to reject work item: ${error.message}`);
    }
  }

  // Check if overdue
  isOverdue() {
    return new Date(this.deadline) < new Date() && ['pending', 'rejected'].includes(this.status);
  }

  // Check if submitted
  isSubmitted() {
    return this.status === 'submitted';
  }

  // Check if approved
  isApproved() {
    return this.status === 'approved';
  }

  // Check if rejected
  isRejected() {
    return this.status === 'rejected';
  }

  // Convert to JSON
  toJSON() {
    return {
      id: this.id,
      workerId: this.workerId,
      task: this.task,
      description: this.description,
      instructions: this.instructions,
      deadline: this.deadline,
      status: this.status,
      assignedAt: this.assignedAt,
      submittedAt: this.submittedAt,
      reviewedAt: this.reviewedAt,
      explanation: this.explanation,
      workLink: this.workLink,
      reviewNotes: this.reviewNotes,
      assignedBy: this.assignedBy,
      reviewedBy: this.reviewedBy,
      worker: this.worker,
      assignedByUser: this.assignedByUser,
      reviewedByUser: this.reviewedByUser
    };
  }
}

module.exports = WorkItem;