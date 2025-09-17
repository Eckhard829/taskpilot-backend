// models/WorkItem.js
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
    this.worker = data.worker;
    this.assignedByUser = data.assignedByUser;
    this.reviewedByUser = data.reviewedByUser;
  }

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

    if (task.length > 200) {
      throw new Error('Task cannot be longer than 200 characters');
    }

    if (!workerId || !task || !instructions || !deadline || !assignedBy) {
      throw new Error('All required fields must be provided');
    }

    if (!['pending', 'submitted', 'approved', 'rejected'].includes(status)) {
      throw new Error('Status must be pending, submitted, approved, or rejected');
    }

    const assignedByUser = await dbGet('SELECT id FROM users WHERE id = ?', [assignedBy]);
    if (!assignedByUser) {
      throw new Error('Invalid assignedBy user ID');
    }

    if (workItemData.workLink) {
      const urlRegex = /^https?:\/\/[^\s$.?#].[^\s]*$/;
      if (!urlRegex.test(workItemData.workLink)) {
        throw new Error('Please provide a valid URL');
      }
    }

    await dbRun('BEGIN TRANSACTION');
    try {
      const result = await dbRun(`
        INSERT INTO work_items (workerId, task, description, instructions, deadline, status, assignedBy)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [workerId, task.trim(), description.trim(), instructions.trim(), deadline, status, assignedBy]);

      await dbRun('COMMIT');
      return await WorkItem.findById(result.id);
    } catch (error) {
      await dbRun('ROLLBACK');
      console.error('Database error in WorkItem.create:', error);
      throw error;
    }
  }

  static async findById(id) {
    const row = await dbGet(`
      SELECT w.*, 
             u1.name AS worker_name, u1.email AS worker_email,
             u2.name AS assigned_by_name, u2.email AS assigned_by_email,
             u3.name AS reviewed_by_name, u3.email AS reviewed_by_email
      FROM work_items w
      LEFT JOIN users u1 ON w.workerId = u1.id
      LEFT JOIN users u2 ON w.assignedBy = u2.id
      LEFT JOIN users u3 ON w.reviewedBy = u3.id
      WHERE w.id = ?
    `, [id]);

    if (!row) return null;

    return new WorkItem({
      ...row,
      worker: row.worker_name ? { name: row.worker_name, email: row.worker_email } : null,
      assignedByUser: row.assigned_by_name ? { name: row.assigned_by_name, email: row.assigned_by_email } : null,
      reviewedByUser: row.reviewed_by_name ? { name: row.reviewed_by_name, email: row.reviewed_by_email } : null
    });
  }

  static async findAll(filters = {}) {
    let sql = `
      SELECT w.*, 
             u1.name AS worker_name, u1.email AS worker_email,
             u2.name AS assigned_by_name, u2.email AS assigned_by_email,
             u3.name AS reviewed_by_name, u3.email AS reviewed_by_email
      FROM work_items w
      LEFT JOIN users u1 ON w.workerId = u1.id
      LEFT JOIN users u2 ON w.assignedBy = u2.id
      LEFT JOIN users u3 ON w.reviewedBy = u3.id
      WHERE 1=1
    `;
    const params = [];

    if (filters.workerId) {
      sql += ' AND w.workerId = ?';
      params.push(filters.workerId);
    }
    if (filters.status) {
      sql += ' AND w.status = ?';
      params.push(filters.status);
    }

    const rows = await dbAll(sql, params);
    return rows.map(row => new WorkItem({
      ...row,
      worker: row.worker_name ? { name: row.worker_name, email: row.worker_email } : null,
      assignedByUser: row.assigned_by_name ? { name: row.assigned_by_name, email: row.assigned_by_email } : null,
      reviewedByUser: row.reviewed_by_name ? { name: row.reviewed_by_name, email: row.reviewed_by_email } : null
    }));
  }

  static async count(filters = {}) {
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
  }

  async update(updateData) {
    const allowedFields = [
      'task', 'description', 'instructions', 'deadline', 'status',
      'submittedAt', 'reviewedAt', 'explanation', 'workLink', 'reviewNotes', 'reviewedBy'
    ];
    const updates = [];
    const params = [];

    for (const [key, value] of Object.entries(updateData)) {
      if (allowedFields.includes(key)) {
        updates.push(`${key} = ?`);
        params.push(value);
      }
    }

    if (updates.length === 0) {
      throw new Error('No valid fields to update');
    }

    params.push(this.id);

    await dbRun('BEGIN TRANSACTION');
    try {
      await dbRun(`UPDATE work_items SET ${updates.join(', ')} WHERE id = ?`, params);
      await dbRun('COMMIT');
      
      const updated = await WorkItem.findById(this.id);
      Object.assign(this, updated);
      return this;
    } catch (error) {
      await dbRun('ROLLBACK');
      throw error;
    }
  }

  async delete() {
    await dbRun('BEGIN TRANSACTION');
    try {
      await dbRun('DELETE FROM work_items WHERE id = ?', [this.id]);
      await dbRun('COMMIT');
    } catch (error) {
      await dbRun('ROLLBACK');
      throw error;
    }
  }

  async complete(completionData) {
    const { explanation, workLink } = completionData;
    if (!explanation) {
      throw new Error('Explanation is required for task completion');
    }

    if (workLink) {
      const urlRegex = /^https?:\/\/[^\s$.?#].[^\s]*$/;
      if (!urlRegex.test(workLink)) {
        throw new Error('Please provide a valid URL');
      }
    }

    await dbRun('BEGIN TRANSACTION');
    try {
      const updateData = {
        status: 'submitted',
        submittedAt: new Date().toISOString(),
        explanation,
        workLink: workLink || null
      };

      await this.update(updateData);
      await dbRun('COMMIT');
      return this;
    } catch (error) {
      await dbRun('ROLLBACK');
      throw error;
    }
  }

  async approve(reviewData) {
    await dbRun('BEGIN TRANSACTION');
    try {
      const updateData = {
        status: 'approved',
        reviewedAt: new Date().toISOString(),
        reviewNotes: reviewData.reviewNotes,
        reviewedBy: reviewData.reviewedBy
      };

      await this.update(updateData);
      await dbRun('COMMIT');
      return this;
    } catch (error) {
      await dbRun('ROLLBACK');
      throw new Error(`Failed to approve work item: ${error.message}`);
    }
  }

  async reject(reviewData) {
    if (!reviewData.reviewNotes) {
      throw new Error('Review notes are required when rejecting work');
    }

    await dbRun('BEGIN TRANSACTION');
    try {
      const updateData = {
        status: 'rejected',
        reviewedAt: new Date().toISOString(),
        reviewNotes: reviewData.reviewNotes,
        reviewedBy: reviewData.reviewedBy,
        submittedAt: null,
        explanation: null,
        workLink: null
      };

      await this.update(updateData);
      await dbRun('COMMIT');
      return this;
    } catch (error) {
      await dbRun('ROLLBACK');
      throw new Error(`Failed to reject work item: ${error.message}`);
    }
  }

  isOverdue() {
    return new Date(this.deadline) < new Date() && ['pending', 'rejected'].includes(this.status);
  }

  isSubmitted() {
    return this.status === 'submitted';
  }

  isApproved() {
    return this.status === 'approved';
  }

  isRejected() {
    return this.status === 'rejected';
  }

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