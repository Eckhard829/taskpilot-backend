const express = require('express');
const router = express.Router();
const WorkItem = require('../models/WorkItem');
const User = require('../models/User');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { google } = require('googleapis');
const { dbGet } = require('../config/database');

const sendTaskNotification = async (to, subject, text) => {
  if (!global.transporter) {
    console.log('Email not configured - skipping notification to:', to);
    return { success: false, reason: 'Email not configured' };
  }

  if (!global.emailWorking) {
    console.log('Email not working - skipping notification to:', to);
    return { success: false, reason: 'Email service not working' };
  }

  try {
    await global.transporter.sendMail({
      from: process.env.EMAIL_USER || 'noreply@taskpilot.com',
      to,
      subject,
      text,
    });
    console.log('Email sent successfully to:', to);
    return { success: true };
  } catch (error) {
    console.error('Failed to send email to', to, ':', error);
    return { success: false, reason: error.message };
  }
};

const createCalendarEvent = async (user, workItem) => {
  const userTokens = await dbGet(
    'SELECT googleAccessToken, googleRefreshToken FROM users WHERE id = ?',
    [user.id]
  );

  if (!userTokens || !userTokens.googleAccessToken || !userTokens.googleRefreshToken) {
    console.log(`No Google Calendar access for user ${user.email}`);
    return;
  }

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.log('Google OAuth not configured - skipping calendar event');
    return;
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    access_token: userTokens.googleAccessToken,
    refresh_token: userTokens.googleRefreshToken,
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const event = {
    summary: `TaskPilot: ${workItem.task}`,
    description: `Task: ${workItem.task}\n\nDescription: ${workItem.description || 'No description'}\n\nInstructions: ${workItem.instructions}\n\nAssigned via TaskPilot`,
    start: {
      dateTime: new Date(workItem.deadline).toISOString(),
      timeZone: 'UTC',
    },
    end: {
      dateTime: new Date(new Date(workItem.deadline).getTime() + 60 * 60 * 1000).toISOString(),
      timeZone: 'UTC',
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 30 },
        { method: 'popup', minutes: 10 },
      ],
    },
  };

  try {
    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
    });
    console.log(`Calendar event created for task ${workItem.id} for user ${user.email}`);
  } catch (error) {
    console.error('Error creating calendar event:', error.message);
    if (error.code === 401) {
      console.log('Google token expired for user', user.email);
    }
  }
};

router.get('/', authenticateToken, async (req, res) => {
  try {
    let workItems;
    if (req.user.role === 'admin') {
      workItems = await WorkItem.findAll();
    } else {
      workItems = await WorkItem.findAll({ workerId: req.user.id });
    }
    res.json(workItems);
  } catch (error) {
    console.error('Error fetching work items:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/submitted', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const submittedWorkItems = await WorkItem.findAll({ status: 'submitted' });
    res.json(submittedWorkItems);
  } catch (error) {
    console.error('Error fetching submitted work items:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/worker/:workerId', authenticateToken, async (req, res) => {
  try {
    const workerId = parseInt(req.params.workerId);
    
    if (req.user.role !== 'admin' && req.user.id !== workerId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const workItems = await WorkItem.findAll({ workerId });
    res.json(workItems);
  } catch (error) {
    console.error('Error fetching worker tasks:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const workItem = await WorkItem.findById(req.params.id);
    if (!workItem) {
      return res.status(404).json({ message: 'Work item not found' });
    }

    if (req.user.role !== 'admin' && req.user.id !== workItem.workerId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(workItem);
  } catch (error) {
    console.error('Error fetching work item:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

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

This task has been added to your Google Calendar (if connected).

Please log into TaskPilot to view and complete this task.

Best regards,
TaskPilot Team`
      );

      await createCalendarEvent(worker, workItem);
    }

    res.json({
      message: 'Task assigned successfully',
      workItem: workItem.toJSON()
    });
  } catch (error) {
    console.error('Error assigning task:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.put('/complete/:id', authenticateToken, async (req, res) => {
  console.log('=== TASK COMPLETION REQUEST ===');
  console.log('Task ID:', req.params.id);
  console.log('User:', req.user);
  console.log('Body:', req.body);
  
  try {
    const { explanation, workLink } = req.body;
    
    if (!explanation || !explanation.trim()) {
      return res.status(400).json({ message: 'Explanation is required' });
    }
    
    const workItem = await WorkItem.findById(req.params.id);

    if (!workItem) {
      return res.status(404).json({ message: 'Work item not found' });
    }

    if (req.user.role !== 'admin' && req.user.id !== workItem.workerId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (workItem.status === 'submitted' || workItem.status === 'approved') {
      return res.status(400).json({ message: 'Task is already completed or under review' });
    }

    await workItem.markCompleted({ 
      explanation: explanation.trim(), 
      workLink: workLink?.trim() || null 
    });

    res.json({
      message: 'Task submitted for review successfully',
      workItem: workItem.toJSON()
    });
    
  } catch (error) {
    console.error('Error completing task:', error);
    res.status(500).json({ 
      message: 'Server error while completing task',
      error: error.message
    });
  }
});

router.put('/approve/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { reviewNotes } = req.body;
    const workItem = await WorkItem.findById(req.params.id);

    if (!workItem) {
      return res.status(404).json({ message: 'Work item not found' });
    }

    if (workItem.status !== 'submitted') {
      return res.status(400).json({ message: 'Work item must be submitted for review first' });
    }

    await workItem.approve({
      reviewNotes: reviewNotes || '',
      reviewedBy: req.user.id
    });

    const worker = await User.findById(workItem.workerId);
    if (worker) {
      await sendTaskNotification(
        worker.email,
        'Task Approved - TaskPilot',
        `Hello ${worker.name},

Congratulations! Your task "${workItem.task}" has been approved.

${reviewNotes ? `Review Notes: ${reviewNotes}` : ''}

Great work! Keep up the excellent performance.

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

router.put('/reject/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { reviewNotes } = req.body;
    
    if (!reviewNotes || reviewNotes.trim().length < 10) {
      return res.status(400).json({ message: 'Detailed review notes are required when rejecting work (minimum 10 characters)' });
    }

    const workItem = await WorkItem.findById(req.params.id);

    if (!workItem) {
      return res.status(404).json({ message: 'Work item not found' });
    }

    if (workItem.status !== 'submitted') {
      return res.status(400).json({ message: 'Work item must be submitted for review first' });
    }

    await workItem.reject({
      reviewNotes: reviewNotes.trim(),
      reviewedBy: req.user.id
    });

    const worker = await User.findById(workItem.workerId);
    if (worker) {
      await sendTaskNotification(
        worker.email,
        'Work Incomplete - TaskPilot',
        `Hello ${worker.name},

Your task "${workItem.task}" needs revision and has been returned to you.

Review Notes: ${reviewNotes}

Please review the feedback, make the necessary changes, and resubmit your work.

You can find the task in your "Work To Do" section in TaskPilot.

Best regards,
TaskPilot Team`
      );
    }

    res.json({
      message: 'Work rejected and returned for revision',
      workItem: workItem.toJSON()
    });
  } catch (error) {
    console.error('Error rejecting work:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const workItem = await WorkItem.findById(req.params.id);
    if (!workItem) {
      return res.status(404).json({ message: 'Work item not found' });
    }

    await workItem.update(req.body);

    res.json({
      message: 'Work item updated successfully',
      workItem: workItem.toJSON()
    });
  } catch (error) {
    console.error('Error updating work item:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const workItem = await WorkItem.findById(req.params.id);
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