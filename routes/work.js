const express = require('express');
const router = express.Router();
const WorkItem = require('../models/WorkItem');
const User = require('../models/User');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// Helper function to send email notifications
const sendTaskNotification = async (to, subject, text) => {
  if (global.transporter) {
    try {
      await global.transporter.sendMail({
        from: process.env.EMAIL_USER || 'noreply@taskpilot.com',
        to,
        subject,
        text,
      });
      console.log('Email sent successfully to:', to);
    } catch (error) {
      console.error('Failed to send email to', to, ':', error);
      // Don't throw error - continue with task operations even if email fails
    }
  } else {
    console.log('Email not configured - skipping notification to:', to);
  }
};

// Create a new work task (Admin only)
router.post('/assign', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { workerId, task, description, instructions, deadline } = req.body;

    if (!workerId || !task || !instructions || !deadline) {
      return res.status(400).json({ message: 'WorkerId, task, instructions, and deadline are required' });
    }

    const workItem = await WorkItem.create({
      workerId,
      task,
      description: description || '',
      instructions,
      deadline,
      assignedBy: req.user.id,
      status: 'pending'
    });

    // Fetch worker for email notification
    const worker = await User.findById(workerId);
    if (worker) {
      const deadlineDate = new Date(deadline);
      await sendTaskNotification(
        worker.email,
        'New Task Assigned - TaskPilot',
        `Hello ${worker.name},

You have been assigned a new task:

Task: ${task}
${description ? `Description: ${description}` : ''}
Instructions: ${instructions}
Deadline: ${deadlineDate.toLocaleDateString()} at ${deadlineDate.toLocaleTimeString()}

Please log into TaskPilot to view and complete this task.

Best regards,
TaskPilot Team`
      );
    }

    res.status(201).json({ 
      message: 'Task assigned successfully', 
      workItem: workItem.toJSON() 
    });
  } catch (error) {
    console.error('Error assigning task:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get all work tasks
router.get('/', authenticateToken, async (req, res) => {
  try {
    let workItems;
    if (req.user.role === 'admin') {
      // Admins see all work items
      workItems = await WorkItem.findAll();
    } else {
      // Workers see only their own work items
      workItems = await WorkItem.findAll({ workerId: req.user.id });
    }
    
    res.json(workItems.map(item => item.toJSON()));
  } catch (error) {
    console.error('Error fetching work items:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get submitted work for admin review
router.get('/submitted', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const workItems = await WorkItem.findAll({ status: 'submitted' });
    res.json(workItems.map(item => item.toJSON()));
  } catch (error) {
    console.error('Error fetching submitted work:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Worker completes/submits work
router.put('/complete/:id', authenticateToken, async (req, res) => {
  try {
    const { explanation, workLink } = req.body;
    const workItemId = parseInt(req.params.id);

    if (!explanation || !explanation.trim()) {
      return res.status(400).json({ message: 'Work description is required' });
    }

    const workItem = await WorkItem.findById(workItemId);
    if (!workItem) {
      return res.status(404).json({ message: 'Work item not found' });
    }

    // Check if user owns this work item (unless admin)
    if (req.user.role !== 'admin' && workItem.workerId !== req.user.id) {
      return res.status(403).json({ message: 'Unauthorized - not your task' });
    }

    await workItem.markCompleted({
      explanation: explanation.trim(),
      workLink: workLink ? workLink.trim() : undefined
    });

    // Send notification to admins about submitted work
    const admins = await User.findAll({ role: 'admin' });
    const worker = await User.findById(req.user.id);
    
    for (const admin of admins) {
      await sendTaskNotification(
        admin.email,
        'Work Submitted for Review - TaskPilot',
        `Hello ${admin.name},

${worker.name} has submitted work for review:

Task: ${workItem.task}
${workItem.description ? `Description: ${workItem.description}` : ''}
Worker Notes: ${explanation.trim()}
${workLink ? `Work Link: ${workLink.trim()}` : ''}
Submitted: ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}

Please log into TaskPilot to review this submission.

Best regards,
TaskPilot Team`
      );
    }

    res.json({ 
      message: 'Work submitted for review successfully', 
      workItem: workItem.toJSON() 
    });
  } catch (error) {
    console.error('Error completing work:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Approve work (Admin only)
router.put('/approve/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { reviewNotes } = req.body;
    const workItemId = parseInt(req.params.id);

    const workItem = await WorkItem.findById(workItemId);
    if (!workItem) {
      return res.status(404).json({ message: 'Work item not found' });
    }

    if (workItem.status !== 'submitted') {
      return res.status(400).json({ message: 'Can only approve submitted work' });
    }

    await workItem.approve({
      reviewNotes,
      reviewedBy: req.user.id
    });

    // Send approval notification to worker
    const worker = await User.findById(workItem.workerId);
    const admin = await User.findById(req.user.id);
    
    if (worker) {
      await sendTaskNotification(
        worker.email,
        'Work Approved - TaskPilot',
        `Hello ${worker.name},

Great news! Your work has been approved:

Task: ${workItem.task}
${workItem.description ? `Description: ${workItem.description}` : ''}
Reviewed by: ${admin.name}
${reviewNotes ? `Review Notes: ${reviewNotes}` : ''}
Approved on: ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}

Congratulations on completing this task successfully!

Best regards,
TaskPilot Team`
      );
    }

    res.json({ 
      message: 'Work approved successfully', 
      workItem: workItem.toJSON() 
    });
  } catch (error) {
    console.error('Error approving work:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Reject work (Admin only)
router.put('/reject/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { reviewNotes } = req.body;
    const workItemId = parseInt(req.params.id);

    if (!reviewNotes || reviewNotes.trim() === '') {
      return res.status(400).json({ message: 'Review notes are required when rejecting work' });
    }

    const workItem = await WorkItem.findById(workItemId);
    if (!workItem) {
      return res.status(404).json({ message: 'Work item not found' });
    }

    if (workItem.status !== 'submitted') {
      return res.status(400).json({ message: 'Can only reject submitted work' });
    }

    await workItem.reject({
      reviewNotes: reviewNotes.trim(),
      reviewedBy: req.user.id
    });

    // Send rejection notification to worker
    const worker = await User.findById(workItem.workerId);
    const admin = await User.findById(req.user.id);
    
    if (worker) {
      const deadlineDate = new Date(workItem.deadline);
      await sendTaskNotification(
        worker.email,
        'Work Requires Revision - TaskPilot',
        `Hello ${worker.name},

Your submitted work requires revision:

Task: ${workItem.task}
${workItem.description ? `Description: ${workItem.description}` : ''}
Original Deadline: ${deadlineDate.toLocaleDateString()} at ${deadlineDate.toLocaleTimeString()}
Reviewed by: ${admin.name}

Feedback from Admin:
${reviewNotes.trim()}

Please log into TaskPilot to view the feedback and resubmit your work after making the necessary revisions.

Best regards,
TaskPilot Team`
      );
    }

    res.json({ 
      message: 'Work rejected successfully', 
      workItem: workItem.toJSON() 
    });
  } catch (error) {
    console.error('Error rejecting work:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete work item (Admin only)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const workItemId = parseInt(req.params.id);
    
    const workItem = await WorkItem.findById(workItemId);
    if (!workItem) {
      return res.status(404).json({ message: 'Work item not found' });
    }

    await workItem.delete();
    res.json({ message: 'Work item deleted successfully' });
  } catch (error) {
    console.error('Error deleting work item:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get work statistics (Admin only)
router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const totalTasks = await WorkItem.count();
    const pendingTasks = await WorkItem.count({ status: 'pending' });
    const submittedTasks = await WorkItem.count({ status: 'submitted' });
    const approvedTasks = await WorkItem.count({ status: 'approved' });
    const rejectedTasks = await WorkItem.count({ status: 'rejected' });

    res.json({
      totalTasks,
      pendingTasks,
      submittedTasks,
      approvedTasks,
      rejectedTasks
    });
  } catch (error) {
    console.error('Error fetching work stats:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;