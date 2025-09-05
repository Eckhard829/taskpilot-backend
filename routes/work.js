const express = require('express');
const router = express.Router();
const WorkItem = require('../models/WorkItem');
const User = require('../models/User');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { google } = require('googleapis');

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
    }
  } else {
    console.log('Email not configured - skipping notification to:', to);
  }
};

const createCalendarEvent = async (user, workItem) => {
  if (!user.googleAccessToken || !user.googleRefreshToken) {
    console.log(`No Google Calendar access for user ${user.email}`);
    return;
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    access_token: user.googleAccessToken,
    refresh_token: user.googleRefreshToken,
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const event = {
    summary: `TaskPilot: ${workItem.task}`,
    description: `Description: ${workItem.description || 'No description'}\nInstructions: ${workItem.instructions}`,
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
    await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
    });
    console.log(`Calendar event created for task ${workItem.id} for user ${user.email}`);
  } catch (error) {
    console.error('Error creating calendar event:', error);
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
This task has been added to your Google Calendar (if authorized).

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

// Other routes (e.g., approve, reject, delete) remain unchanged for brevity

module.exports = router;