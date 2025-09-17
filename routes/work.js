// routes/work.js
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

  try {
    const event = {
      summary: `Task: ${workItem.task}`,
      description: workItem.description,
      start: {
        dateTime: new Date(workItem.deadline).toISOString(),
        timeZone: 'UTC',
      },
      end: {
        dateTime: new Date(new Date(workItem.deadline).getTime() + 60 * 60 * 1000).toISOString(),
        timeZone: 'UTC',
      },
    };

    await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
    });
    console.log(`Calendar event created for task ${workItem.id} for user ${user.email}`);
  } catch (error) {
    console.error('Error creating calendar event:', error);
  }
};

router.post('/assign', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { workerId, task, description, instructions, deadline } = req.body;

    if (!workerId || !task || !instructions || !deadline) {
      return res.status(400).json({ message: 'Missing required fields: workerId, task, instructions, deadline' });
    }

    const worker = await User.findById(workerId);
    if (!worker) {
      return res.status(404).json({ message: 'Worker not found' });
    }

    const admin = await User.findById(req.user.id);
    if (!admin) {
      return res.status(404).json({ message: 'Admin user not found' });
    }

    const workItemData = {
      workerId,
      task,
      description: description || '',
      instructions,
      deadline,
      assignedBy: req.user.id,
    };

    const workItem = await WorkItem.create(workItemData);

    const notificationResult = await sendTaskNotification(
      worker.email,
      `New Task Assigned: ${task}`,
      `You have been assigned a new task: ${task}\n\nDescription: ${description || 'No description provided'}\nInstructions: ${instructions}\nDeadline: ${new Date(deadline).toLocaleString()}\n\nPlease check TaskPilot for details.`
    );

    if (worker.googleAccessToken && worker.googleRefreshToken) {
      await createCalendarEvent(worker, workItem);
    }

    res.status(201).json({
      message: 'Task assigned successfully',
      workItem: workItem.toJSON(),
      notificationSent: notificationResult.success,
    });
  } catch (error) {
    console.error('Error assigning task:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    let filters = {};
    if (user.role === 'worker') {
      filters.workerId = user.id;
    }

    const workItems = await WorkItem.findAll(filters);
    res.json(workItems.map(item => item.toJSON()));
  } catch (error) {
    console.error('Error fetching work items:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/submitted', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const workItems = await WorkItem.findAll({ status: 'submitted' });
    res.json(workItems.map(item => item.toJSON()));
  } catch (error) {
    console.error('Error fetching submitted work:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.put('/complete/:id', authenticateToken, async (req, res) => {
  try {
    const workItem = await WorkItem.findById(req.params.id);
    if (!workItem) {
      return res.status(404).json({ message: 'Work item not found' });
    }

    if (workItem.workerId !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to complete this task' });
    }

    await workItem.complete(req.body);

    const adminUsers = await User.findAll({ role: 'admin' });
    for (const admin of adminUsers) {
      await sendTaskNotification(
        admin.email,
        `Task Submitted for Review: ${workItem.task}`,
        `Task "${workItem.task}" has been submitted by ${req.user.name} for review.\n\nExplanation: ${req.body.explanation}\n${req.body.workLink ? `Work Link: ${req.body.workLink}\n` : ''}\nPlease review in TaskPilot.`
      );
    }

    res.status(200).json({
      message: 'Task submitted for review successfully',
      workItem: workItem.toJSON()
    });
  } catch (error) {
    console.error('Error completing task:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.put('/approve/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const workItem = await WorkItem.findById(req.params.id);
    if (!workItem) {
      return res.status(404).json({ message: 'Work item not found' });
    }

    await workItem.approve({
      reviewNotes: req.body.reviewNotes,
      reviewedBy: req.user.id
    });

    const worker = await User.findById(workItem.workerId);
    if (worker) {
      await sendTaskNotification(
        worker.email,
        `Task Approved: ${workItem.task}`,
        `Your task "${workItem.task}" has been approved.\n${req.body.reviewNotes ? `Review Notes: ${req.body.reviewNotes}\n` : ''}\nCheck TaskPilot for details.`
      );
    }

    res.status(200).json({
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
    const workItem = await WorkItem.findById(req.params.id);
    if (!workItem) {
      return res.status(404).json({ message: 'Work item not found' });
    }

    if (!req.body.reviewNotes) {
      return res.status(400).json({ message: 'Review notes are required for rejection' });
    }

    await workItem.reject({
      reviewNotes: req.body.reviewNotes,
      reviewedBy: req.user.id
    });

    const worker = await User.findById(workItem.workerId);
    if (worker) {
      await sendTaskNotification(
        worker.email,
        `Task Rejected: ${workItem.task}`,
        `Your task "${workItem.task}" has been rejected.\nReview Notes: ${req.body.reviewNotes}\nPlease revise and resubmit in TaskPilot.`
      );
    }

    res.status(200).json({
      message: 'Work rejected successfully',
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

    res.status(200).json({
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

    res.status(200).json({ message: 'Work item deleted successfully' });
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

    res.status(200).json({
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