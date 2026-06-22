const express = require('express');
const session = require('express-session');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const db = require('./database');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'online-assessment-secret-key-12345',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Configure Multer for File Uploads
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

// Serve Static Files
app.use(express.static(path.join(__dirname, 'public')));

// Authentication Helper Middleware
function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user || req.session.user.role !== role) {
      return res.status(403).json({ error: 'Unauthorized access' });
    }
    next();
  };
}

// ----------------------------------------------------
// AUTHENTICATION APIS
// ----------------------------------------------------

// GET /api/auth/me
app.get('/api/auth/me', async (req, res) => {
  if (req.session.user) {
    if (req.session.user.role === 'teacher') {
      try {
        const classes = await db.all("SELECT department, year, section FROM teacher_classes WHERE teacher_id = ?", [req.session.user.id]);
        req.session.user.classes = classes;
      } catch (error) {
        console.error("Failed to refresh teacher classes in session:", error);
      }
    }
    res.json({ loggedIn: true, user: req.session.user });
  } else {
    res.json({ loggedIn: false });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    // 1. Check if the username matches the admin username/email in the database
    const admin = await db.get("SELECT * FROM admins WHERE username = ?", [username]);
    if (admin) {
      if (admin.password === password) {
        req.session.user = { id: admin.id, name: 'System Admin', username: admin.username, role: 'admin' };
        return res.json({ success: true, user: req.session.user });
      } else {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
    }

    if (username.includes('@')) {
      // 2. Check if the username matches a teacher email
      const teacher = await db.get("SELECT * FROM teachers WHERE email = ? AND password = ?", [username, password]);
      if (teacher) {
        const classes = await db.all("SELECT department, year, section FROM teacher_classes WHERE teacher_id = ?", [teacher.id]);
        req.session.user = { 
          id: teacher.id, 
          name: teacher.name, 
          email: teacher.email, 
          role: 'teacher',
          classes: classes 
        };
        return res.json({ success: true, user: req.session.user });
      }
    } else {
      // 3. Otherwise, check student register number
      const student = await db.get("SELECT * FROM students WHERE register_number = ? AND password = ?", [username, password]);
      if (student) {
        req.session.user = { 
          id: student.id, 
          name: student.name, 
          registerNumber: student.register_number, 
          department: student.department,
          year: student.year,
          section: student.section,
          role: 'student' 
        };
        return res.json({ success: true, user: req.session.user });
      }
    }
    return res.status(401).json({ error: 'Invalid credentials' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

const crypto = require('crypto');
const forgotPasswordTokens = {};

// POST /api/auth/forgot-password
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email/Username is required' });

  try {
    let role = '';
    let userRecord = null;

    if (email.includes('@')) {
      const teacher = await db.get("SELECT * FROM teachers WHERE email = ?", [email]);
      if (!teacher) {
        return res.status(400).json({ error: 'Teacher account not found.' });
      }
      role = 'teacher';
      userRecord = teacher;
    } else {
      const admin = await db.get("SELECT * FROM admins WHERE username = ?", [email]);
      if (admin) {
        role = 'admin';
        userRecord = admin;
      }
    }

    if (!userRecord) {
      return res.status(400).json({ error: 'Forgot password is only available for Teacher and Admin accounts.' });
    }

    const token = crypto.randomBytes(20).toString('hex');

    if (role === 'teacher') {
      forgotPasswordTokens[token] = {
        email,
        role,
        expiresAt: Date.now() + 15 * 60 * 1000,
        status: 'approved'
      };
      const redirectUrl = `/api/auth/reset-password/teacher?token=${token}`;
      return res.json({ success: true, redirectUrl });
    }

    // Admin flow (unchanged)
    forgotPasswordTokens[token] = {
      email,
      role,
      expiresAt: Date.now() + 15 * 60 * 1000,
      status: 'pending'
    };

    const verifyUrl = `http://localhost:3000/api/auth/reset-password/verify?token=${token}&action=approve`;
    const blockUrl = `http://localhost:3000/api/auth/reset-password/verify?token=${token}&action=block`;

    console.log(`\n==================================================`);
    console.log(`SIMULATED EMAIL SENT TO: ${email}`);
    console.log(`[IT'S ME]: ${verifyUrl}`);
    console.log(`[NOT ME]: ${blockUrl}`);
    console.log(`==================================================\n`);

    const emailHtml = `
      <h3>Verification Email for ${email}</h3>
      <p>A password reset request was made for your account.</p>
      <div style="margin: 20px 0;">
        <a href="${verifyUrl}" style="padding: 10px 15px; background: #22c55e; color: white; text-decoration: none; border-radius: 5px; margin-right: 10px; font-weight: bold;">[IT'S ME]</a>
        <a href="${blockUrl}" style="padding: 10px 15px; background: #ef4444; color: white; text-decoration: none; border-radius: 5px; font-weight: bold;">[NOT ME]</a>
      </div>
      <p>This link will expire in 15 minutes.</p>
    `;
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    fs.writeFileSync(path.join(uploadDir, 'email_simulation.html'), emailHtml);

    res.json({ success: true, message: 'Verification email sent. Check server logs or uploads/email_simulation.html' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to initiate forgot password workflow' });
  }
});

// GET /api/auth/reset-password/verify
app.get('/api/auth/reset-password/verify', async (req, res) => {
  const { token, action } = req.query;
  const sessionData = forgotPasswordTokens[token];

  if (!sessionData) {
    return res.send('<h1>Invalid Link</h1><p>The password reset link is invalid or has already been used.</p>');
  }

  if (Date.now() > sessionData.expiresAt) {
    delete forgotPasswordTokens[token];
    return res.send('<h1>Link Expired</h1><p>The password reset link has expired after 15 minutes.</p>');
  }

  if (action === 'block') {
    sessionData.status = 'blocked';
    return res.send('<h1>Password Reset Blocked</h1><p>You have blocked this password reset request. Reset attempt is denied.</p>');
  }

  if (action === 'approve') {
    if (sessionData.status === 'blocked') {
      return res.send('<h1>Blocked</h1><p>This reset request has been blocked and cannot be approved.</p>');
    }
    sessionData.status = 'approved';
    
    const formHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Reset Password</title>
        <style>
          body { font-family: sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
          .card { background: #1e293b; padding: 30px; border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); width: 350px; }
          h2 { margin-top: 0; color: #38bdf8; }
          input { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #475569; background: #0f172a; color: white; border-radius: 4px; box-sizing: border-box; }
          button { width: 100%; padding: 10px; background: #0ea5e9; border: none; color: white; font-weight: bold; border-radius: 4px; cursor: pointer; }
          button:hover { background: #0284c7; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Reset Password</h2>
          <p>Please enter your new password for <strong>${sessionData.email}</strong></p>
          <form action="/api/auth/reset-password/confirm" method="POST">
            <input type="hidden" name="token" value="${token}">
            <input type="password" name="newPassword" placeholder="New Password" required minlength="4">
            <button type="submit">Update Password</button>
          </form>
        </div>
      </body>
      </html>
    `;
    return res.send(formHtml);
  }

  res.send('<h1>Invalid Action</h1>');
});

// POST /api/auth/reset-password/confirm
app.post('/api/auth/reset-password/confirm', async (req, res) => {
  const { token, newPassword } = req.body;
  const sessionData = forgotPasswordTokens[token];

  if (!sessionData) {
    return res.status(400).send('<h1>Invalid Token</h1>');
  }

  if (Date.now() > sessionData.expiresAt) {
    delete forgotPasswordTokens[token];
    return res.status(400).send('<h1>Link Expired</h1>');
  }

  if (sessionData.status !== 'approved') {
    return res.status(400).send('<h1>Action Blocked</h1><p>Password reset was blocked or not verified.</p>');
  }

  try {
    const { email, role } = sessionData;
    if (role === 'admin') {
      await db.run("UPDATE admins SET password = ? WHERE username = ?", [newPassword, email]);
    } else if (role === 'teacher') {
      await db.run("UPDATE teachers SET password = ? WHERE email = ?", [newPassword, email]);
    }

    delete forgotPasswordTokens[token];

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Success</title>
        <style>
          body { font-family: sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
          .card { background: #1e293b; padding: 30px; border-radius: 8px; text-align: center; }
          h2 { color: #22c55e; }
          a { color: #38bdf8; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Password Reset Successful!</h2>
          <p>Your password has been updated. You can now close this window and login to the system.</p>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error(error);
    res.status(500).send('<h1>Internal Server Error</h1>');
  }
});

// GET /api/auth/reset-password/teacher
app.get('/api/auth/reset-password/teacher', async (req, res) => {
  const { token } = req.query;
  const sessionData = forgotPasswordTokens[token];

  if (!sessionData || sessionData.role !== 'teacher') {
    return res.status(400).send('<h1>Invalid Link</h1><p>The password reset link is invalid or has already been used.</p>');
  }

  if (Date.now() > sessionData.expiresAt) {
    delete forgotPasswordTokens[token];
    return res.status(400).send('<h1>Link Expired</h1><p>The password reset link has expired after 15 minutes.</p>');
  }

  try {
    const teacher = await db.get("SELECT * FROM teachers WHERE email = ?", [sessionData.email]);
    if (!teacher) {
      return res.status(404).send('<h1>Teacher Account Not Found</h1>');
    }

    const formHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Create New Password</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
          :root {
            --bg-gradient: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
            --card-bg: rgba(30, 41, 59, 0.7);
            --border-glass: rgba(255, 255, 255, 0.08);
            --primary: #3b82f6;
            --primary-hover: #2563eb;
            --secondary: #8b5cf6;
            --text-main: #f8fafc;
            --text-secondary: #94a3b8;
          }
          body {
            font-family: 'Inter', sans-serif;
            background: var(--bg-gradient);
            color: var(--text-main);
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            overflow: hidden;
          }
          .card {
            background: var(--card-bg);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            padding: 40px;
            border-radius: 16px;
            border: 1px solid var(--border-glass);
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            width: 380px;
            text-align: left;
          }
          h2 {
            margin: 0 0 10px 0;
            font-size: 1.8rem;
            font-weight: 700;
            background: linear-gradient(to right, #38bdf8, #818cf8);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
          }
          p {
            color: var(--text-secondary);
            font-size: 0.95rem;
            line-height: 1.5;
            margin-bottom: 25px;
          }
          .form-group {
            margin-bottom: 20px;
          }
          label {
            display: block;
            font-size: 0.85rem;
            font-weight: 500;
            margin-bottom: 8px;
            color: var(--text-secondary);
          }
          input {
            width: 100%;
            padding: 12px 16px;
            font-size: 1rem;
            border: 1px solid var(--border-glass);
            background: rgba(15, 23, 42, 0.6);
            color: var(--text-main);
            border-radius: 8px;
            box-sizing: border-box;
            transition: all 0.3s ease;
          }
          input:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.25);
          }
          button {
            width: 100%;
            padding: 14px;
            background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);
            border: none;
            color: white;
            font-weight: 600;
            font-size: 1rem;
            border-radius: 8px;
            cursor: pointer;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
            margin-top: 10px;
          }
          button:hover {
            transform: translateY(-1px);
            box-shadow: 0 8px 20px rgba(139, 92, 246, 0.3);
          }
          button:active {
            transform: translateY(0);
          }
          .error-msg {
            color: #ef4444;
            font-size: 0.85rem;
            margin-top: 5px;
            display: none;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Create New Password</h2>
          <p>Securely reset your teacher portal credentials for <strong>${sessionData.email}</strong></p>
          <form action="/api/auth/reset-password/confirm-teacher" method="POST" onsubmit="return validatePasswords(event)">
            <input type="hidden" name="token" value="${token}">
            <input type="hidden" name="currentPassword" value="${teacher.password}">
            
            <div class="form-group">
              <label for="newPassword">New Password</label>
              <input type="password" id="newPassword" name="newPassword" placeholder="••••••••" required minlength="4">
            </div>

            <div class="form-group">
              <label for="confirmNewPassword">Confirm New Password</label>
              <input type="password" id="confirmNewPassword" name="confirmNewPassword" placeholder="••••••••" required minlength="4">
              <div id="error-msg" class="error-msg">Passwords do not match</div>
            </div>

            <button type="submit">Update Password</button>
          </form>
        </div>
        <script>
          function validatePasswords(event) {
            const newPwd = document.getElementById('newPassword').value;
            const confirmPwd = document.getElementById('confirmNewPassword').value;
            const errorDiv = document.getElementById('error-msg');
            if (newPwd !== confirmPwd) {
              errorDiv.style.display = 'block';
              event.preventDefault();
              return false;
            }
            errorDiv.style.display = 'none';
            return true;
          }
        </script>
      </body>
      </html>
    `;
    res.send(formHtml);
  } catch (error) {
    console.error(error);
    res.status(500).send('<h1>Internal Server Error</h1>');
  }
});

// POST /api/auth/reset-password/confirm-teacher
app.post('/api/auth/reset-password/confirm-teacher', async (req, res) => {
  const { token, newPassword, confirmNewPassword } = req.body;
  const sessionData = forgotPasswordTokens[token];

  if (!sessionData || sessionData.role !== 'teacher') {
    return res.status(400).send('<h1>Invalid Token</h1>');
  }

  if (Date.now() > sessionData.expiresAt) {
    delete forgotPasswordTokens[token];
    return res.status(400).send('<h1>Link Expired</h1>');
  }

  if (newPassword !== confirmNewPassword) {
    return res.status(400).send('<h1>Passwords Do Not Match</h1>');
  }

  try {
    const { email } = sessionData;
    await db.run("UPDATE teachers SET password = ? WHERE email = ?", [newPassword, email]);

    delete forgotPasswordTokens[token];

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Success</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
          :root {
            --bg-gradient: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
            --card-bg: rgba(30, 41, 59, 0.7);
            --border-glass: rgba(255, 255, 255, 0.08);
            --success: #22c55e;
            --text-main: #f8fafc;
            --text-secondary: #94a3b8;
          }
          body {
            font-family: 'Inter', sans-serif;
            background: var(--bg-gradient);
            color: var(--text-main);
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
          }
          .card {
            background: var(--card-bg);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            padding: 40px;
            border-radius: 16px;
            border: 1px solid var(--border-glass);
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            text-align: center;
            width: 380px;
          }
          h2 {
            color: var(--success);
            margin-top: 0;
            font-weight: 700;
          }
          p {
            color: var(--text-secondary);
            font-size: 0.95rem;
            line-height: 1.5;
            margin-bottom: 25px;
          }
          a {
            display: inline-block;
            padding: 12px 24px;
            background: var(--success);
            color: white;
            text-decoration: none;
            font-weight: 600;
            border-radius: 8px;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
          }
          a:hover {
            transform: translateY(-1px);
            box-shadow: 0 8px 20px rgba(34, 197, 94, 0.3);
          }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Password Reset Successful!</h2>
          <p>Your credentials have been updated in Teacher Management. You can now close this tab and log in using your new password.</p>
          <a href="/">Go to Login</a>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error(error);
    res.status(500).send('<h1>Internal Server Error</h1>');
  }
});


// ----------------------------------------------------
// STUDENT PORTAL APIS
// ----------------------------------------------------

// GET /api/student/dashboard - Get tests for logged-in student's class
app.get('/api/student/dashboard', requireRole('student'), async (req, res) => {
  const { id, department, year, section } = req.session.user;
  try {
    // Get all tests assigned to this class
    const tests = await db.all(
      `SELECT t.id, t.name, t.duration 
       FROM tests t 
       WHERE t.department = ? AND t.year = ? AND t.section = ?`,
      [department, year, section]
    );

    // Get submission status for each test for this student
    const submissions = await db.all(
      `SELECT test_id, score, status FROM student_submissions WHERE student_id = ?`,
      [id]
    );

    const submissionMap = {};
    submissions.forEach(sub => {
      submissionMap[sub.test_id] = sub.status; // 'Attended' or 'ABS'
    });

    const result = tests.map(test => ({
      id: test.id,
      name: test.name,
      duration: test.duration,
      submitted: !!submissionMap[test.id],
      status: submissionMap[test.id] || 'Not Submitted'
    }));

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch student dashboard' });
  }
});

// GET /api/student/test/:testId - Load test + shuffle questions & options
app.get('/api/student/test/:testId', requireRole('student'), async (req, res) => {
  const studentId = req.session.user.id;
  const testId = req.params.testId;

  try {
    // Check if student already submitted this test
    const submission = await db.get("SELECT * FROM student_submissions WHERE student_id = ? AND test_id = ?", [studentId, testId]);
    if (submission) {
      return res.status(403).json({ error: 'You have already submitted this test.' });
    }

    const test = await db.get("SELECT * FROM tests WHERE id = ?", [testId]);
    if (!test) {
      return res.status(404).json({ error: 'Test not found' });
    }

    const dbQuestions = await db.all("SELECT id, question_text, option_a, option_b, option_c, option_d FROM questions WHERE test_id = ?", [testId]);

    // Shuffle helper (Fisher-Yates)
    function shuffleArray(array) {
      const arr = [...array];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }

    // Shuffle questions
    const shuffledQuestions = shuffleArray(dbQuestions).map(q => {
      // Shuffle options for each question
      const options = [
        { key: 'A', text: q.option_a },
        { key: 'B', text: q.option_b },
        { key: 'C', text: q.option_c },
        { key: 'D', text: q.option_d }
      ];
      return {
        id: q.id,
        question_text: q.question_text,
        options: shuffleArray(options)
      };
    });

    res.json({
      id: test.id,
      testName: test.name,
      duration: test.duration,
      questions: shuffledQuestions
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load exam details' });
  }
});

// POST /api/student/test/:testId/submit - Submit exam and auto-evaluate
app.post('/api/student/test/:testId/submit', requireRole('student'), async (req, res) => {
  const studentId = req.session.user.id;
  const testId = req.params.testId;
  const { answers } = req.body; // Array of { questionId, chosenOptionKey }

  try {
    // Check duplicate submission
    const existing = await db.get("SELECT id FROM student_submissions WHERE student_id = ? AND test_id = ?", [studentId, testId]);
    if (existing) {
      return res.status(400).json({ error: 'Test already submitted' });
    }

    // Fetch correct options from DB
    const questions = await db.all("SELECT id, correct_option FROM questions WHERE test_id = ?", [testId]);
    const answerKey = {};
    questions.forEach(q => {
      answerKey[q.id] = q.correct_option; // 'A', 'B', 'C', 'D'
    });

    let score = 0;
    
    // Save answers and calculate score
    for (const ans of answers) {
      const { questionId, chosenOptionKey } = ans;
      const correctOption = answerKey[questionId];

      if (chosenOptionKey && correctOption) {
        if (chosenOptionKey.toUpperCase() === correctOption.toUpperCase()) {
          score++;
        }
        await db.run(
          "INSERT OR REPLACE INTO student_answers (student_id, test_id, question_id, chosen_option) VALUES (?, ?, ?, ?)",
          [studentId, testId, questionId, chosenOptionKey]
        ).catch(() => {}); // ignore duplicates
      }
    }

    // Insert student submission record
    await db.run(
      "INSERT INTO student_submissions (student_id, test_id, score, status) VALUES (?, ?, ?, ?)",
      [studentId, testId, score, 'Attended']
    );

    res.json({ success: true, score: score, total: questions.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to submit exam answers' });
  }
});

// POST /api/student/test/:testId/cheat - Log cheating event and auto submit
app.post('/api/student/test/:testId/cheat', requireRole('student'), async (req, res) => {
  const student = req.session.user;
  const testId = req.params.testId;
  const { answers, reason } = req.body; // final answers to save (if any) and reason

  try {
    const test = await db.get("SELECT name FROM tests WHERE id = ?", [testId]);
    const testName = test ? test.name : 'Unknown Test';
    const violationReason = reason || 'Tab Switched / Minimised';
    const savedTestName = `${testName} (Reason: ${violationReason})`;

    // Log the cheating incident with the reason embedded in the test name
    await db.run(
      `INSERT INTO cheating_logs 
       (student_id, student_name, register_number, department, year, section, test_id, test_name) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [student.id, student.name, student.registerNumber, student.department, student.year, student.section, testId, savedTestName]
    );

    // Auto-submit the exam: check if already submitted first
    const existing = await db.get("SELECT id FROM student_submissions WHERE student_id = ? AND test_id = ?", [student.id, testId]);
    if (!existing) {
      // Calculate score based on answers sent so far
      const questions = await db.all("SELECT id, correct_option FROM questions WHERE test_id = ?", [testId]);
      const answerKey = {};
      questions.forEach(q => { answerKey[q.id] = q.correct_option; });

      let score = 0;
      if (answers && Array.isArray(answers)) {
        for (const ans of answers) {
          const { questionId, chosenOptionKey } = ans;
          const correctOption = answerKey[questionId];
          if (chosenOptionKey && correctOption && chosenOptionKey.toUpperCase() === correctOption.toUpperCase()) {
            score++;
          }
          await db.run(
            "INSERT OR REPLACE INTO student_answers (student_id, test_id, question_id, chosen_option) VALUES (?, ?, ?, ?)",
            [student.id, testId, questionId, chosenOptionKey]
          ).catch(() => {});
        }
      }

      await db.run(
        "INSERT INTO student_submissions (student_id, test_id, score, status) VALUES (?, ?, ?, ?)",
        [student.id, testId, score, 'Attended']
      );
    }

    res.json({ success: true, message: 'Cheating detected. Test auto-submitted.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to record cheating alert' });
  }
});


// ----------------------------------------------------
// TEACHER PORTAL APIS
// ----------------------------------------------------

// GET /api/teacher/classes - Get classes assigned to the teacher
app.get('/api/teacher/classes', requireRole('teacher'), (req, res) => {
  res.json(req.session.user.classes);
});

// GET /api/teacher/tests - Get tests for a specific class created by this teacher
app.get('/api/teacher/tests', requireRole('teacher'), async (req, res) => {
  const teacherId = req.session.user.id;
  const { department, year, section } = req.query;

  try {
    const tests = await db.all(
      `SELECT * FROM tests WHERE teacher_id = ? AND department = ? AND year = ? AND section = ?`,
      [teacherId, department, parseInt(year), section]
    );
    res.json(tests);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to retrieve tests' });
  }
});

// POST /api/teacher/tests - Create a new test
app.post('/api/teacher/tests', requireRole('teacher'), async (req, res) => {
  const teacherId = req.session.user.id;
  const { name, duration, department, year, section } = req.body;

  if (!name || !duration || !department || !year || !section) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const result = await db.run(
      `INSERT INTO tests (name, duration, department, year, section, teacher_id) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, parseInt(duration), department, parseInt(year), section, teacherId]
    );
    res.json({ success: true, testId: result.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create test' });
  }
});

// GET /api/teacher/tests/:testId/questions - Get questions for a test
app.get('/api/teacher/tests/:testId/questions', requireRole('teacher'), async (req, res) => {
  const { testId } = req.params;
  try {
    const questions = await db.all("SELECT * FROM questions WHERE test_id = ?", [testId]);
    res.json(questions);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch questions' });
  }
});

// POST /api/teacher/tests/:testId/questions - Add single question
app.post('/api/teacher/tests/:testId/questions', requireRole('teacher'), async (req, res) => {
  const { testId } = req.params;
  const { question_text, option_a, option_b, option_c, option_d, correct_option } = req.body;

  if (!question_text || !option_a || !option_b || !option_c || !option_d || !correct_option) {
    return res.status(400).json({ error: 'Missing required question fields' });
  }

  try {
    const result = await db.run(
      `INSERT INTO questions (test_id, question_text, option_a, option_b, option_c, option_d, correct_option) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [testId, question_text, option_a, option_b, option_c, option_d, correct_option.toUpperCase()]
    );
    res.json({ success: true, questionId: result.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to add question' });
  }
});

// DELETE /api/teacher/tests/:testId/questions/:questionId - Remove a single question
app.delete('/api/teacher/tests/:testId/questions/:questionId', requireRole('teacher'), async (req, res) => {
  const { questionId } = req.params;
  try {
    await db.run("DELETE FROM questions WHERE id = ?", [questionId]);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to remove question' });
  }
});

// DELETE /api/teacher/tests/:testId - Delete entire test
app.delete('/api/teacher/tests/:testId', requireRole('teacher'), async (req, res) => {
  const { testId } = req.params;
  try {
    await db.run("DELETE FROM tests WHERE id = ?", [testId]);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete test' });
  }
});

// POST /api/teacher/tests/:testId/upload - Upload and parse file
app.post('/api/teacher/tests/:testId/upload', requireRole('teacher'), upload.single('file'), async (req, res) => {
  const { testId } = req.params;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const fileText = await extractTextFromFile(file.path, file.originalname);

    let parsedQuestions = [];
    try {
      parsedQuestions = parseQuestionsText(fileText);
    } catch (parseError) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(400).json({ error: parseError.message });
    }

    // If no questions parsed (e.g. binary doc/pdf without structured pattern, or empty txt)
    if (parsedQuestions.length === 0) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(400).json({ error: 'No questions could be extracted from the uploaded file. Please ensure it follows the specified format.' });
    }

    // Insert questions into database
    let count = 0;
    for (const q of parsedQuestions) {
      await db.run(
        `INSERT INTO questions (test_id, question_text, option_a, option_b, option_c, option_d, correct_option) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [testId, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option]
      );
      count++;
    }

    // Delete temp file
    fs.unlinkSync(file.path);

    res.json({ success: true, message: `Successfully extracted and saved ${count} questions.`, count });
  } catch (error) {
    console.error(error);
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    res.status(500).json({ error: 'Failed to process file and extract questions' });
  }
});

// Robust file decoder and text extractor
async function extractTextFromFile(filePath, originalName) {
  try {
    const ext = path.extname(originalName).toLowerCase();
    
    if (ext === '.txt' || ext === '.csv') {
      const buffer = fs.readFileSync(filePath);
      const content = buffer.toString('utf8');
      return content.replace(/^\uFEFF/, '');
    }
    
    if (ext === '.xlsx' || ext === '.xls') {
      const workbook = XLSX.readFile(filePath);
      let text = '';
      workbook.SheetNames.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        text += csv + '\n';
      });
      return text;
    }
    
    if (ext === '.docx' || ext === '.doc') {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    }
    
    if (ext === '.pdf') {
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdfParse(dataBuffer);
      return data.text;
    }
    
    throw new Error('Unsupported file extension: ' + ext);
  } catch (err) {
    console.error('File extraction failed:', err);
    throw new Error('Unable to decode or extract text from this file. Please ensure the file is not corrupted and matches the required format.');
  }
}

// Parser logic
function parseQuestionsText(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const questions = [];
  
  let i = 0;
  while (i < lines.length) {
    let line = lines[i];
    
    // Detect question line
    let isQuestion = false;
    if (line.toLowerCase().startsWith('q:') || line.toLowerCase().startsWith('question:') || /^\d+[\.\)]/.test(line)) {
      isQuestion = true;
    } else {
      // Check if subsequent lines look like options (A, B, C, D)
      let hasOptionsAhead = false;
      let checkIdx = i + 1;
      while (checkIdx < Math.min(i + 5, lines.length)) {
        const cl = lines[checkIdx].toLowerCase();
        if (cl.startsWith('a.') || cl.startsWith('a:') || cl.startsWith('a)')) {
          hasOptionsAhead = true;
          break;
        }
        checkIdx++;
      }
      if (hasOptionsAhead) {
        isQuestion = true;
      }
    }

    if (isQuestion) {
      let questionText = line.replace(/^(q:|question:|\d+[\.\)]\s*)/i, '').trim();
      let optionA = '', optionB = '', optionC = '', optionD = '';
      let correctAns = '';
      
      i++;
      let optionCount = 0;
      let hasAnsKey = false;
      
      while (i < lines.length) {
        const nextLine = lines[i];
        const lowerNext = nextLine.toLowerCase();
        
        // If we hit a new question, break and step back
        if (lowerNext.startsWith('q:') || lowerNext.startsWith('question:') || /^\d+[\.\)]/.test(nextLine)) {
          let isNewQ = true;
          if (optionCount === 0) isNewQ = false;
          if (isNewQ) {
            break;
          }
        }
        
        if (lowerNext.startsWith('a.') || lowerNext.startsWith('a:') || lowerNext.startsWith('a)')) {
          optionA = nextLine.replace(/^(a\.|a:|a\)\s*)/i, '').trim();
          optionCount++;
        } else if (lowerNext.startsWith('b.') || lowerNext.startsWith('b:') || lowerNext.startsWith('b)')) {
          optionB = nextLine.replace(/^(b\.|b:|b\)\s*)/i, '').trim();
          optionCount++;
        } else if (lowerNext.startsWith('c.') || lowerNext.startsWith('c:') || lowerNext.startsWith('c)')) {
          optionC = nextLine.replace(/^(c\.|c:|c\)\s*)/i, '').trim();
          optionCount++;
        } else if (lowerNext.startsWith('d.') || lowerNext.startsWith('d:') || lowerNext.startsWith('d)')) {
          optionD = nextLine.replace(/^(d\.|d:|d\)\s*)/i, '').trim();
          optionCount++;
        } else if (lowerNext.startsWith('ans:') || lowerNext.startsWith('answer:') || lowerNext.startsWith('correct:') || lowerNext.startsWith('correct answer:')) {
          let ans = nextLine.replace(/^(ans:|answer:|correct:\s*|correct answer:\s*)/i, '').trim().toUpperCase();
          if (ans.startsWith('OPTION')) ans = ans.replace('OPTION', '').trim();
          correctAns = ans[0] || '';
          hasAnsKey = true;
        } else {
          if (optionCount === 0) {
            questionText += ' ' + nextLine;
          }
        }
        i++;
      }
      
      if (!questionText) {
        throw new Error("Unsupported file structure: Question text is missing.");
      }
      if (optionCount < 4) {
        throw new Error("Question options incomplete: Ensure each question contains 4 options (A, B, C, D).");
      }
      if (!correctAns || !hasAnsKey) {
        throw new Error("Answer key format missing: Ensure correct answer is specified using 'Ans: <Option>', 'Answer: <Option>', or 'Correct Answer: <Option>'.");
      }
      
      questions.push({
        question_text: questionText,
        option_a: optionA,
        option_b: optionB,
        option_c: optionC,
        option_d: optionD,
        correct_option: correctAns
      });
    } else {
      i++;
    }
  }
  
  if (questions.length === 0) {
    throw new Error("Unsupported file structure: No questions detected in the file.");
  }
  
  return questions;
}

// GET /api/teacher/tests/:testId/results - Result Dashboard details (marks, attendance, analytics, cheating logs)
app.get('/api/teacher/tests/:testId/results', requireRole('teacher'), async (req, res) => {
  const { testId } = req.params;

  try {
    const test = await db.get("SELECT * FROM tests WHERE id = ?", [testId]);
    if (!test) return res.status(404).json({ error: 'Test not found' });

    const totalQuestions = (await db.get("SELECT COUNT(*) as count FROM questions WHERE test_id = ?", [testId])).count;

    // Get ALL students in this test's Class (Dept, Year, Section)
    const classStudents = await db.all(
      "SELECT id, name, register_number FROM students WHERE department = ? AND year = ? AND section = ?",
      [test.department, test.year, test.section]
    );

    // Get submissions
    const submissions = await db.all(
      "SELECT student_id, score, status FROM student_submissions WHERE test_id = ?",
      [testId]
    );

    const submissionMap = {};
    submissions.forEach(sub => {
      submissionMap[sub.student_id] = sub;
    });

    // Get cheating logs to map status
    const testCheatingLogs = await db.all(
      "SELECT student_id FROM cheating_logs WHERE test_id = ?",
      [testId]
    );
    const cheatingMap = {};
    testCheatingLogs.forEach(log => {
      cheatingMap[log.student_id] = true;
    });

    // Merge students with submissions to show marks/ABS
    let attendedCount = 0;
    let totalScoreOfAttended = 0;

    const studentResults = classStudents.map(student => {
      const sub = submissionMap[student.id];
      const hasCheated = cheatingMap[student.id];
      let marks = 'ABS';
      let status = 'ABS';

      if (sub) {
        marks = sub.score;
        status = hasCheated ? 'CHEAT DETECTED' : 'Attended';
        attendedCount++;
        totalScoreOfAttended += sub.score;
      }

      return {
        id: student.id,
        name: student.name,
        registerNumber: student.register_number,
        marks: marks,
        status: status
      };
    });

    // 1. Class Percentage (Attended students average percent)
    let classPercentage = 0;
    if (attendedCount > 0 && totalQuestions > 0) {
      classPercentage = ((totalScoreOfAttended / (attendedCount * totalQuestions)) * 100).toFixed(2);
    }

    // 2. Department Percentage (All submissions in this Dept across all tests)
    const deptSubmissions = await db.all(
      `SELECT s.score, (SELECT COUNT(*) FROM questions q WHERE q.test_id = s.test_id) as qCount 
       FROM student_submissions s 
       JOIN tests t ON s.test_id = t.id 
       WHERE t.department = ?`,
      [test.department]
    );
    let deptPercentage = 0;
    let deptTotalScore = 0;
    let deptTotalQs = 0;
    deptSubmissions.forEach(ds => {
      deptTotalScore += ds.score;
      deptTotalQs += ds.qCount;
    });
    if (deptTotalQs > 0) {
      deptPercentage = ((deptTotalScore / deptTotalQs) * 100).toFixed(2);
    }

    // 3. Year Percentage (All submissions in this Year across all tests)
    const yearSubmissions = await db.all(
      `SELECT s.score, (SELECT COUNT(*) FROM questions q WHERE q.test_id = s.test_id) as qCount 
       FROM student_submissions s 
       JOIN tests t ON s.test_id = t.id 
       WHERE t.year = ?`,
      [test.year]
    );
    let yearPercentage = 0;
    let yearTotalScore = 0;
    let yearTotalQs = 0;
    yearSubmissions.forEach(ys => {
      yearTotalScore += ys.score;
      yearTotalQs += ys.qCount;
    });
    if (yearTotalQs > 0) {
      yearPercentage = ((yearTotalScore / yearTotalQs) * 100).toFixed(2);
    }

    // 4. Overall Percentage (All submissions in the whole system)
    const allSubmissions = await db.all(
      `SELECT s.score, (SELECT COUNT(*) FROM questions q WHERE q.test_id = s.test_id) as qCount 
       FROM student_submissions s`
    );
    let overallPercentage = 0;
    let overallTotalScore = 0;
    let overallTotalQs = 0;
    allSubmissions.forEach(as => {
      overallTotalScore += as.score;
      overallTotalQs += as.qCount;
    });
    if (overallTotalQs > 0) {
      overallPercentage = ((overallTotalScore / overallTotalQs) * 100).toFixed(2);
    }

    // Cheating Logs for this test
    const cheatingLogs = await db.all(
      `SELECT student_name, register_number, department, year, section, timestamp, test_name 
       FROM cheating_logs 
       WHERE test_id = ?`,
      [testId]
    );

    res.json({
      testName: test.name,
      attendance: {
        attended: attendedCount,
        total: classStudents.length
      },
      results: studentResults,
      analytics: {
        classPercentage,
        departmentPercentage: deptPercentage,
        yearPercentage,
        overallPercentage
      },
      cheatingLogs
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch test results' });
  }
});

// GET /api/teacher/tests/:testId/responses/:studentId - Get detailed answers and evaluation for a student
app.get('/api/teacher/tests/:testId/responses/:studentId', requireRole('teacher'), async (req, res) => {
  const { testId, studentId } = req.params;
  try {
    const student = await db.get("SELECT name, register_number FROM students WHERE id = ?", [studentId]);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const test = await db.get("SELECT name FROM tests WHERE id = ?", [testId]);
    if (!test) return res.status(404).json({ error: 'Test not found' });

    const submission = await db.get(
      "SELECT score, status, submitted_at FROM student_submissions WHERE student_id = ? AND test_id = ?",
      [studentId, testId]
    );
    if (!submission) return res.status(404).json({ error: 'No submission found for this student.' });

    // Query cheating_logs for any records
    const cheatLog = await db.get(
      "SELECT test_name FROM cheating_logs WHERE student_id = ? AND test_id = ? ORDER BY id DESC LIMIT 1",
      [studentId, testId]
    );
    const cheated = !!cheatLog;
    let cheatReason = null;
    if (cheatLog) {
      cheatReason = "Tab Switched / Minimised";
      if (cheatLog.test_name && cheatLog.test_name.includes('(')) {
        const parts = cheatLog.test_name.split('(');
        const raw = parts[parts.length - 1].replace(')', '').trim();
        cheatReason = raw.replace(/^Reason:\s*/i, '').trim();
      }
    }

    // Fetch all questions for the test
    const questions = await db.all(
      "SELECT id, question_text, option_a, option_b, option_c, option_d, correct_option FROM questions WHERE test_id = ? ORDER BY id ASC",
      [testId]
    );

    // Fetch student's answers
    const answers = await db.all(
      "SELECT question_id, chosen_option FROM student_answers WHERE student_id = ? AND test_id = ?",
      [studentId, testId]
    );

    const answerMap = {};
    answers.forEach(ans => {
      answerMap[ans.question_id] = ans.chosen_option;
    });

    const responseDetails = questions.map((q, idx) => {
      const chosen = answerMap[q.id] || 'N/A';
      const isCorrect = chosen.toUpperCase() === q.correct_option.toUpperCase();
      
      let selectedText = 'Unanswered';
      if (chosen.toUpperCase() === 'A') selectedText = `A. ${q.option_a}`;
      else if (chosen.toUpperCase() === 'B') selectedText = `B. ${q.option_b}`;
      else if (chosen.toUpperCase() === 'C') selectedText = `C. ${q.option_c}`;
      else if (chosen.toUpperCase() === 'D') selectedText = `D. ${q.option_d}`;

      let correctText = '';
      if (q.correct_option.toUpperCase() === 'A') correctText = `A. ${q.option_a}`;
      else if (q.correct_option.toUpperCase() === 'B') correctText = `B. ${q.option_b}`;
      else if (q.correct_option.toUpperCase() === 'C') correctText = `C. ${q.option_c}`;
      else if (q.correct_option.toUpperCase() === 'D') correctText = `D. ${q.option_d}`;

      return {
        questionNumber: idx + 1,
        questionText: q.question_text,
        optionSelected: selectedText,
        correctAnswer: correctText,
        isCorrect: isCorrect
      };
    });

    res.json({
      studentName: student.name,
      registerNumber: student.register_number,
      testName: test.name,
      submittedAt: submission.submitted_at,
      score: submission.score,
      totalQuestions: questions.length,
      responses: responseDetails,
      cheated: cheated,
      cheatReason: cheatReason
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch student response details' });
  }
});


// ----------------------------------------------------
// DEPARTMENT MANAGEMENT APIS
// ----------------------------------------------------

const DEPT_FILE = path.join(__dirname, 'departments.json');
function getDepartments() {
  if (!fs.existsSync(DEPT_FILE)) {
    const defaults = ['CSE', 'ECE', 'EEE', 'MECH'];
    fs.writeFileSync(DEPT_FILE, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  return JSON.parse(fs.readFileSync(DEPT_FILE, 'utf8'));
}
function saveDepartments(depts) {
  fs.writeFileSync(DEPT_FILE, JSON.stringify(depts, null, 2));
}

app.get('/api/departments', (req, res) => {
  res.json(getDepartments());
});

app.post('/api/departments/add', requireRole('admin'), (req, res) => {
  const { department } = req.body;
  if (!department) return res.status(400).json({ error: 'Department name required' });
  const depts = getDepartments();
  if (depts.includes(department)) return res.status(400).json({ error: 'Department already exists' });
  depts.push(department);
  saveDepartments(depts);
  res.json({ success: true, departments: depts });
});

app.post('/api/departments/rename', requireRole('admin'), async (req, res) => {
  const { oldName, newName } = req.body;
  if (!oldName || !newName) return res.status(400).json({ error: 'Old and new names required' });
  const depts = getDepartments();
  const idx = depts.indexOf(oldName);
  if (idx === -1) return res.status(404).json({ error: 'Department not found' });
  if (depts.includes(newName) && oldName !== newName) return res.status(400).json({ error: 'New department name already exists' });
  
  depts[idx] = newName;
  saveDepartments(depts);

  try {
    await db.run("UPDATE students SET department = ? WHERE department = ?", [newName, oldName]);
    await db.run("UPDATE tests SET department = ? WHERE department = ?", [newName, oldName]);
    await db.run("UPDATE teacher_classes SET department = ? WHERE department = ?", [newName, oldName]);
    await db.run("UPDATE cheating_logs SET department = ? WHERE department = ?", [newName, oldName]);
    res.json({ success: true, departments: depts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update database records' });
  }
});

app.post('/api/departments/remove', requireRole('admin'), (req, res) => {
  const { department } = req.body;
  if (!department) return res.status(400).json({ error: 'Department name required' });
  let depts = getDepartments();
  depts = depts.filter(d => d !== department);
  saveDepartments(depts);
  res.json({ success: true, departments: depts });
});

// ----------------------------------------------------
// ADMIN PORTAL APIS
// ----------------------------------------------------

// GET /api/admin/students - List students filter by Dept, Year, Section
app.get('/api/admin/students', requireRole('admin'), async (req, res) => {
  const { department, year, section } = req.query;
  try {
    const students = await db.all(
      `SELECT * FROM students WHERE department = ? AND year = ? AND section = ?`,
      [department, parseInt(year), section]
    );
    res.json(students);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

// POST /api/admin/students/save - Save or update multiple students
app.post('/api/admin/students/save', requireRole('admin'), async (req, res) => {
  const { department, year, section, students } = req.body; // array of student objects

  try {
    // Start transaction
    await db.run("BEGIN TRANSACTION;");

    // 1. Fetch all current students of this class from the database
    const dbStudents = await db.all(
      "SELECT * FROM students WHERE department = ? AND year = ? AND section = ?",
      [department, parseInt(year), section]
    );

    // 2. Identify incoming students and their IDs
    const incomingStudents = [];
    const incomingIds = [];
    
    for (const s of students) {
      const name = s.name ? s.name.trim() : '';
      const register_number = s.register_number ? s.register_number.trim() : '';
      
      // Server-side check to ignore empty/blank records
      if (!name || !register_number) {
        continue;
      }
      
      // Password must always equal the student identifier (register_number)
      const password = register_number;
      
      const stud = {
        id: s.id ? parseInt(s.id) : null,
        name,
        register_number,
        password
      };
      incomingStudents.push(stud);
      if (stud.id) {
        incomingIds.push(stud.id);
      }
    }

    // 3. Delete any students in this class who are not in the incoming list
    const dbStudentIds = dbStudents.map(s => s.id);
    const idsToDelete = dbStudentIds.filter(id => !incomingIds.includes(id));
    if (idsToDelete.length > 0) {
      const placeholders = idsToDelete.map(() => '?').join(',');
      await db.run(
        `DELETE FROM students WHERE id IN (${placeholders})`,
        idsToDelete
      );
    }

    // 4. Temporarily update register_number of remaining database students in this class
    // to prevent intermediate UNIQUE constraint conflicts (e.g. during swaps).
    const idsToTemp = dbStudentIds.filter(id => incomingIds.includes(id));
    for (const id of idsToTemp) {
      await db.run(
        "UPDATE students SET register_number = ? WHERE id = ?",
        [`TEMP_SWAP_${id}`, id]
      );
    }

    // 5. Finalise inserts and updates for incoming students
    const savedIds = [];
    for (const stud of incomingStudents) {
      let existing = null;
      if (stud.id) {
        existing = await db.get("SELECT id FROM students WHERE id = ?", [stud.id]);
      }
      if (!existing) {
        existing = await db.get("SELECT id FROM students WHERE register_number = ?", [stud.register_number]);
      }

      if (existing) {
        await db.run(
          `UPDATE students SET name = ?, register_number = ?, password = ?, department = ?, year = ?, section = ? WHERE id = ?`,
          [stud.name, stud.register_number, stud.password, department, parseInt(year), section, existing.id]
        );
        savedIds.push(existing.id);
      } else {
        const result = await db.run(
          `INSERT INTO students (name, register_number, password, department, year, section) VALUES (?, ?, ?, ?, ?, ?)`,
          [stud.name, stud.register_number, stud.password, department, parseInt(year), section]
        );
        savedIds.push(result.id);
      }
    }

    // Commit transaction
    await db.run("COMMIT;");
    res.json({ success: true });
  } catch (error) {
    console.error("Save class changes failed, rolling back:", error);
    try {
      await db.run("ROLLBACK;");
    } catch (rbErr) {
      console.error("Rollback failed:", rbErr);
    }
    res.status(500).json({ error: 'Failed to save students: ' + (error.message || error) });
  }
});

const BACKUP_FILE = path.join(__dirname, 'uploads', 'switch_year_backup.json');

// GET /api/admin/students/undo-status - Check if an undo is available
app.get('/api/admin/students/undo-status', requireRole('admin'), (req, res) => {
  const canUndo = fs.existsSync(BACKUP_FILE);
  res.json({ canUndo });
});

// POST /api/admin/students/switch-year - Promote students to the next year
app.post('/api/admin/students/switch-year', requireRole('admin'), async (req, res) => {
  const { department, year, section } = req.body;
  const currentYear = parseInt(year);

  try {
    // 1. Fetch current students in the selected class
    const students = await db.all(
      "SELECT * FROM students WHERE department = ? AND year = ? AND section = ?",
      [department, currentYear, section]
    );

    if (students.length === 0) {
      return res.status(400).json({ error: "No active students found in this class to promote." });
    }

    const studentIds = students.map(s => s.id);

    // 2. Prepare and save backup for Undo
    let backupData = {
      class: { department, year: currentYear, section },
      studentIds: studentIds,
      action: currentYear === 4 ? 'archive' : 'promote',
      students: students // full student records backup
    };

    if (currentYear === 4) {
      // For Year 4, we also need to backup related child tables
      const placeholders = studentIds.map(() => '?').join(',');
      const submissions = await db.all(`SELECT * FROM student_submissions WHERE student_id IN (${placeholders})`, studentIds);
      const answers = await db.all(`SELECT * FROM student_answers WHERE student_id IN (${placeholders})`, studentIds);
      const cheating = await db.all(`SELECT * FROM cheating_logs WHERE student_id IN (${placeholders})`, studentIds);

      backupData.submissions = submissions;
      backupData.answers = answers;
      backupData.cheating = cheating;

      // Automatically generate and save archive CSV file
      const headers = ["Student Name", "Register Number", "Password", "Class", "Section"];
      const rows = students.map(s => [s.name, s.register_number, s.password, s.department, s.year, s.section]);
      const csvContent = [
        headers.join(','),
        ...rows.map(r => r.map(val => `"${String(val).replace(/"/g, '""')}"`).join(','))
      ].join('\n');

      const timestamp = Math.floor(Date.now() / 1000);
      const archiveFilename = `archive_${department}_Year4_${section}_${timestamp}.csv`;
      const archivePath = path.join(__dirname, 'uploads', archiveFilename);
      fs.writeFileSync(archivePath, csvContent, 'utf8');

      backupData.archiveFilename = archiveFilename;

      // Save backup file
      fs.writeFileSync(BACKUP_FILE, JSON.stringify(backupData, null, 2), 'utf8');

      // Remove students from active records (will cascade delete child table entries in DB)
      const placeholders2 = studentIds.map(() => '?').join(',');
      await db.run(`DELETE FROM students WHERE id IN (${placeholders2})`, studentIds);

      return res.json({ success: true, archived: true, archiveFile: archiveFilename });
    } else {
      // Save backup file
      fs.writeFileSync(BACKUP_FILE, JSON.stringify(backupData, null, 2), 'utf8');

      // Promote to next year (year + 1)
      const nextYear = currentYear + 1;
      const placeholders = studentIds.map(() => '?').join(',');
      await db.run(
        `UPDATE students SET year = ? WHERE id IN (${placeholders})`,
        [nextYear, ...studentIds]
      );

      return res.json({ success: true, archived: false });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to perform year switch operation." });
  }
});

// POST /api/admin/students/undo-switch-year - Undo the most recent switch-year operation
app.post('/api/admin/students/undo-switch-year', requireRole('admin'), async (req, res) => {
  if (!fs.existsSync(BACKUP_FILE)) {
    return res.status(400).json({ error: "No switch-year operation available to undo." });
  }

  try {
    const backupData = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
    const { action, students, studentIds, archiveFilename } = backupData;

    if (action === 'archive') {
      // 1. Restore students
      for (const s of students) {
        await db.run(
          `INSERT OR REPLACE INTO students (id, name, register_number, password, department, year, section) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [s.id, s.name, s.register_number, s.password, s.department, s.year, s.section]
        );
      }

      // 2. Restore submissions
      if (backupData.submissions && backupData.submissions.length > 0) {
        for (const sub of backupData.submissions) {
          await db.run(
            `INSERT OR REPLACE INTO student_submissions (id, student_id, test_id, score, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?)`,
            [sub.id, sub.student_id, sub.test_id, sub.score, sub.status, sub.submitted_at]
          );
        }
      }

      // 3. Restore answers
      if (backupData.answers && backupData.answers.length > 0) {
        for (const ans of backupData.answers) {
          await db.run(
            `INSERT OR REPLACE INTO student_answers (id, student_id, test_id, question_id, chosen_option) VALUES (?, ?, ?, ?, ?)`,
            [ans.id, ans.student_id, ans.test_id, ans.question_id, ans.chosen_option]
          );
        }
      }

      // 4. Restore cheating logs
      if (backupData.cheating && backupData.cheating.length > 0) {
        for (const ch of backupData.cheating) {
          await db.run(
            `INSERT OR REPLACE INTO cheating_logs (id, student_id, student_name, register_number, department, year, section, test_id, test_name, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [ch.id, ch.student_id, ch.student_name, ch.register_number, ch.department, ch.year, ch.section, ch.test_id, ch.test_name, ch.timestamp]
          );
        }
      }

      // 5. Clean up archive file
      if (archiveFilename) {
        const archivePath = path.join(__dirname, 'uploads', archiveFilename);
        if (fs.existsSync(archivePath)) {
          fs.unlinkSync(archivePath);
        }
      }
    } else {
      // Action is 'promote'
      // Demote students back to their original year (backupData.class.year)
      const originalYear = backupData.class.year;
      const placeholders = studentIds.map(() => '?').join(',');
      await db.run(
        `UPDATE students SET year = ? WHERE id IN (${placeholders})`,
        [originalYear, ...studentIds]
      );
    }

    // Delete backup file after successful undo
    fs.unlinkSync(BACKUP_FILE);

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to undo year switch operation." });
  }
});

// POST /api/admin/students/clear - Delete all students in a class
app.post('/api/admin/students/clear', requireRole('admin'), async (req, res) => {
  const { department, year, section } = req.body;
  try {
    await db.run(
      "DELETE FROM students WHERE department = ? AND year = ? AND section = ?",
      [department, parseInt(year), section]
    );
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to clear students' });
  }
});

// POST /api/admin/students/delete/:id - Delete single student
app.delete('/api/admin/students/:id', requireRole('admin'), async (req, res) => {
  try {
    await db.run("DELETE FROM students WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete student' });
  }
});

// GET /api/admin/teachers - List all teachers and their classes
app.get('/api/admin/teachers', requireRole('admin'), async (req, res) => {
  try {
    const teachers = await db.all("SELECT id, name, email, password FROM teachers");
    const result = [];
    
    for (const teacher of teachers) {
      const classes = await db.all("SELECT department, year, section FROM teacher_classes WHERE teacher_id = ?", [teacher.id]);
      result.push({
        id: teacher.id,
        name: teacher.name,
        email: teacher.email,
        password: '••••••••',
        classes: classes
      });
    }
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to retrieve teachers' });
  }
});

// POST /api/admin/teachers/save - Add/Edit teacher
app.post('/api/admin/teachers/save', requireRole('admin'), async (req, res) => {
  const { id, name, email, password, classes } = req.body; // classes: array of { department, year, section }

  try {
    let teacherId = id;
    if (id) {
      // Update
      if (password === '••••••••' || password === '---') {
        await db.run("UPDATE teachers SET name = ?, email = ? WHERE id = ?", [name, email, id]);
      } else {
        await db.run("UPDATE teachers SET name = ?, email = ?, password = ? WHERE id = ?", [name, email, password, id]);
      }
      // Clear current classes
      await db.run("DELETE FROM teacher_classes WHERE teacher_id = ?", [id]);
    } else {
      // Insert
      const pwd = (password && password !== '••••••••' && password !== '---') ? password : 'teacher123';
      const r = await db.run("INSERT INTO teachers (name, email, password) VALUES (?, ?, ?)", [name, email, pwd]);
      teacherId = r.id;
    }

    // Insert classes
    if (classes && Array.isArray(classes)) {
      for (const cls of classes) {
        await db.run(
          "INSERT OR IGNORE INTO teacher_classes (teacher_id, department, year, section) VALUES (?, ?, ?, ?)",
          [teacherId, cls.department, parseInt(cls.year), cls.section]
        );
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to save teacher details' });
  }
});

// DELETE /api/admin/teachers/:id - Remove teacher
app.delete('/api/admin/teachers/:id', requireRole('admin'), async (req, res) => {
  try {
    await db.run("DELETE FROM teachers WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete teacher' });
  }
});

// GET /api/admin/analytics - Admin dashboard analytics and overview
app.get('/api/admin/analytics', requireRole('admin'), async (req, res) => {
  try {
    // Aggregated scoring calculations
    const questions = await db.all("SELECT id, test_id FROM questions");
    const qCountMap = {};
    questions.forEach(q => {
      qCountMap[q.test_id] = (qCountMap[q.test_id] || 0) + 1;
    });

    const submissions = await db.all("SELECT test_id, score FROM student_submissions");
    
    // Overall Percentage
    let overallPct = 0;
    let overallScore = 0;
    let overallQs = 0;
    submissions.forEach(sub => {
      const qCount = qCountMap[sub.test_id] || 0;
      if (qCount > 0) {
        overallScore += sub.score;
        overallQs += qCount;
      }
    });
    if (overallQs > 0) {
      overallPct = ((overallScore / overallQs) * 100).toFixed(2);
    }

    // Department Pct
    const deptData = await db.all(
      `SELECT t.department, s.score, s.test_id 
       FROM student_submissions s 
       JOIN tests t ON s.test_id = t.id`
    );
    const deptTotals = {};
    deptData.forEach(d => {
      const qCount = qCountMap[d.test_id] || 0;
      if (qCount > 0) {
        if (!deptTotals[d.department]) deptTotals[d.department] = { score: 0, qs: 0 };
        deptTotals[d.department].score += d.score;
        deptTotals[d.department].qs += qCount;
      }
    });
    const deptPct = {};
    Object.keys(deptTotals).forEach(dept => {
      deptPct[dept] = ((deptTotals[dept].score / deptTotals[dept].qs) * 100).toFixed(2);
    });

    // Year Pct
    const yearData = await db.all(
      `SELECT t.year, s.score, s.test_id 
       FROM student_submissions s 
       JOIN tests t ON s.test_id = t.id`
    );
    const yearTotals = {};
    yearData.forEach(y => {
      const qCount = qCountMap[y.test_id] || 0;
      if (qCount > 0) {
        if (!yearTotals[y.year]) yearTotals[y.year] = { score: 0, qs: 0 };
        yearTotals[y.year].score += y.score;
        yearTotals[y.year].qs += qCount;
      }
    });
    const yearPct = {};
    Object.keys(yearTotals).forEach(yr => {
      yearPct[yr] = ((yearTotals[yr].score / yearTotals[yr].qs) * 100).toFixed(2);
    });

    // Section Pct
    const secData = await db.all(
      `SELECT t.section, s.score, s.test_id 
       FROM student_submissions s 
       JOIN tests t ON s.test_id = t.id`
    );
    const secTotals = {};
    secData.forEach(s => {
      const qCount = qCountMap[s.test_id] || 0;
      if (qCount > 0) {
        if (!secTotals[s.section]) secTotals[s.section] = { score: 0, qs: 0 };
        secTotals[s.section].score += s.score;
        secTotals[s.section].qs += qCount;
      }
    });
    const secPct = {};
    Object.keys(secTotals).forEach(sec => {
      secPct[sec] = ((secTotals[sec].score / secTotals[sec].qs) * 100).toFixed(2);
    });

    // Total teachers count
    const totalTeachers = (await db.get("SELECT COUNT(*) as count FROM teachers")).count;

    // Classes handled by each teacher
    const teachersList = await db.all("SELECT id, name FROM teachers");
    const teacherClassesHandled = [];
    for (const t of teachersList) {
      const classes = await db.all("SELECT department, year, section FROM teacher_classes WHERE teacher_id = ?", [t.id]);
      const classStrings = classes.map(c => `${c.department} - Year ${c.year} (${c.section})`);
      teacherClassesHandled.push({
        name: t.name,
        classes: classStrings.join(', ') || 'No Classes Assigned'
      });
    }

    // Student Details for every class
    const studentClasses = await db.all("SELECT DISTINCT department, year, section FROM students ORDER BY department, year, section");
    const classStudentDetails = [];
    for (const cls of studentClasses) {
      const studs = await db.all(
        "SELECT name, register_number FROM students WHERE department = ? AND year = ? AND section = ?",
        [cls.department, cls.year, cls.section]
      );
      classStudentDetails.push({
        className: `${cls.department} - Year ${cls.year} (Sec ${cls.section})`,
        students: studs
      });
    }

    res.json({
      overallPercentage: overallPct || 'N/A',
      departmentPercentages: deptPct,
      yearPercentages: yearPct,
      sectionPercentages: secPct,
      totalTeachers,
      teacherClasses: teacherClassesHandled,
      classStudentDetails
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to compile system analytics' });
  }
});


// ----------------------------------------------------
// SERVER LAUNCH
// ----------------------------------------------------

// ----------------------------------------------------
// CREDENTIALS UPDATE APIS
// ----------------------------------------------------

app.post('/api/admin/change-credentials', requireRole('admin'), async (req, res) => {
  const { oldEmail, oldPassword, newEmail, newPassword } = req.body;
  try {
    const admin = await db.get("SELECT * FROM admins WHERE username = ? AND password = ?", [oldEmail, oldPassword]);
    if (!admin) {
      return res.status(400).json({ error: 'Invalid old email or password' });
    }
    await db.run("UPDATE admins SET username = ?, password = ? WHERE id = ?", [newEmail, newPassword, admin.id]);
    req.session.user.username = newEmail;
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update credentials' });
  }
});

app.post('/api/teacher/change-password', requireRole('teacher'), async (req, res) => {
  const { oldEmail, oldPassword, newPassword } = req.body;
  try {
    const teacher = await db.get("SELECT * FROM teachers WHERE email = ? AND password = ?", [oldEmail, oldPassword]);
    if (!teacher) {
      return res.status(400).json({ error: 'Invalid old email or password' });
    }
    await db.run("UPDATE teachers SET password = ? WHERE id = ?", [newPassword, teacher.id]);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// ----------------------------------------------------
// BULK DATA IMPORT APIS
// ----------------------------------------------------

app.post('/api/admin/students/import', requireRole('admin'), upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const fileText = await extractTextFromFile(file.path, file.originalname);
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);

    const lines = fileText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const students = [];

    // Helper functions for identification
    function isHeaderRow(parts) {
      return parts.some(p => {
        const lp = p.toLowerCase().trim();
        return lp === 'name' || lp === 'student name' || lp === 'register number' || 
               lp === 'reg number' || lp === 'reg.no' || lp === 'reg no' || 
               lp === 'register_number' || lp === 'password' || lp === 'pass' || 
               lp === 'pwd' || lp === 'reg' || lp === 's.no' || lp === 'sno' || 
               lp === 'serial' || lp === 'serial no' || lp === 'serial number' || 
               lp === 'index' || lp === 'no' || lp === 'sl' || lp === 'sl.no' || 
               lp === 'sl no';
      });
    }

    function isSerialHeader(headerText) {
      if (!headerText) return false;
      const lp = headerText.toLowerCase().trim();
      return lp === 's.no' || lp === 'sno' || lp === 'serial' || lp === 'serial no' || 
             lp === 'serial number' || lp === 'index' || lp === 'no' || lp === 'sl' || 
             lp === 'sl.no' || lp === 'sl no' || lp === 'sr no' || lp === 'sr.no' ||
             lp === 's. no' || lp === 'sl. no' || lp === 'sr. no';
    }

    function isSerialOrIndex(dataRows, colIdx) {
      if (dataRows.length === 0) return false;
      let numericCount = 0;
      let valSum = 0;
      dataRows.forEach(row => {
        const val = row[colIdx];
        if (val && /^\d+$/.test(val)) {
          numericCount++;
          valSum += parseInt(val);
        }
      });
      if (numericCount > dataRows.length * 0.8) {
        const avg = valSum / numericCount;
        if (avg <= 100) return true;
      }
      return false;
    }

    function getNameScore(val) {
      if (!val) return 0;
      let score = 0;
      if (/[a-zA-Z]/.test(val)) score += 1.0;
      if (val.includes(' ')) score += 2.0;
      if (val.includes('.')) score += 1.5;
      if (/^[A-Z][a-z]*(\s+[A-Z][a-z]*)*$/.test(val)) score += 1.0;
      if (val.length > 5) score += 0.5;
      if (/\d/.test(val)) score -= 0.5;
      return score;
    }

    const dataLines = lines.filter(line => {
      const lower = line.toLowerCase();
      return !(lower.includes('student name') || lower.includes('register number') || lower.includes('reg number') || lower.includes('reg.no') || lower.includes('reg no') || lower === 'name' || lower === 'register_number');
    });

    let isLineByLine = false;
    let singleWordCount = 0;
    dataLines.forEach(line => {
      if (!line.includes(',') && !line.includes('\t') && !line.includes('  ') && !line.includes(' ') && !line.includes('|')) {
        singleWordCount++;
      }
    });
    if (singleWordCount > dataLines.length * 0.3 && dataLines.length >= 2) {
      isLineByLine = true;
    }

    if (isLineByLine) {
      const regPattern = /^[A-Z0-9_-]+$/i;
      let tempName = '';
      for (let j = 0; j < dataLines.length; j++) {
        const curLine = dataLines[j];
        const hasDigits = /\d/.test(curLine);
        
        if (hasDigits || regPattern.test(curLine)) {
          if (tempName) {
            students.push({ name: tempName, register_number: curLine, password: curLine });
            tempName = '';
          } else if (j + 1 < dataLines.length && !/\d/.test(dataLines[j + 1])) {
            students.push({ name: dataLines[j + 1], register_number: curLine, password: curLine });
            j++;
          }
        } else {
          tempName = curLine;
        }
      }
    } else {
      // Parse all lines into rows of parts
      const rawRows = lines.map(line => {
        let parts = [];
        if (line.includes('|')) {
          parts = line.split('|');
        } else if (line.includes(',')) {
          parts = line.split(',');
        } else if (line.includes('\t')) {
          parts = line.split('\t');
        } else {
          parts = line.split(/\s{2,}/);
        }
        return parts.map(p => p.trim().replace(/^"|"$/g, '')).filter(Boolean);
      }).filter(row => row.length > 0);

      const dataRows = rawRows.filter(row => !isHeaderRow(row));

      let nameColIdx = -1;
      let regColIdx = -1;
      let passColIdx = -1;

      // 1. Scan for header mapping
      for (let i = 0; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (isHeaderRow(row)) {
          row.forEach((p, idx) => {
            const lp = p.toLowerCase().trim();
            if (lp.includes('name') || lp.includes('student')) {
              nameColIdx = idx;
            } else if (
              lp === 'reg' || lp === 'reg.no' || lp === 'reg no' || 
              lp === 'register' || lp === 'register number' || 
              lp === 'register_number' || lp === 'roll no' || 
              lp === 'roll number' || lp === 'roll_number' || 
              lp === 'student id' || lp === 'student_id' || lp === 'id' ||
              lp.includes('register number') || lp.includes('reg number') ||
              lp.includes('reg.no') || lp.includes('reg no') || lp.includes('register_number') ||
              lp.includes('admission') || lp.includes('admission number') || lp.includes('admission_number') || lp.includes('admission no')
            ) {
              regColIdx = idx;
            } else if (lp.includes('pass') || lp.includes('pwd') || lp.includes('code')) {
              passColIdx = idx;
            }
          });
          break;
        }
      }

      const maxCols = Math.max(...dataRows.map(r => r.length), 0);

      // 2. Identify Register/Admission Number (must be alphanumeric, length >= 5, no spaces)
      if (regColIdx === -1 && maxCols > 0) {
        let maxRegMatches = -1;
        for (let c = 0; c < maxCols; c++) {
          let matches = 0;
          dataRows.forEach(row => {
            if (row[c] && /^[A-Z0-9_-]{5,}$/i.test(row[c].trim())) {
              matches++;
            }
          });
          if (matches > maxRegMatches) {
            maxRegMatches = matches;
            regColIdx = c;
          }
        }
      }

      // 3. Identify Name (must contain at least one alphabetic character, highest name score)
      if (nameColIdx === -1 && maxCols > 0) {
        let maxNameScore = -Infinity;
        for (let c = 0; c < maxCols; c++) {
          if (c === regColIdx) continue;
          let totalScore = 0;
          dataRows.forEach(row => {
            if (row[c]) {
              totalScore += getNameScore(row[c]);
            }
          });
          if (totalScore > maxNameScore) {
            maxNameScore = totalScore;
            nameColIdx = c;
          }
        }
      }

      // 4. Identify Password (remaining column, ensuring it is not serial/index)
      if (passColIdx === -1 && maxCols > 0) {
        for (let c = 0; c < maxCols; c++) {
          if (c !== regColIdx && c !== nameColIdx) {
            // Check if column is a serial column by header
            let hasSerialHeader = false;
            for (let i = 0; i < rawRows.length; i++) {
              const row = rawRows[i];
              if (isHeaderRow(row) && isSerialHeader(row[c])) {
                hasSerialHeader = true;
                break;
              }
            }
            if (hasSerialHeader || isSerialOrIndex(dataRows, c)) {
              continue; // Skip serial column
            }
            passColIdx = c;
            break;
          }
        }
      }

      // Map rows to student objects
      dataRows.forEach(row => {
        const reg = regColIdx !== -1 && row[regColIdx] ? row[regColIdx].trim() : '';
        const name = nameColIdx !== -1 && row[nameColIdx] ? row[nameColIdx].trim() : '';

        if (name && reg) {
          students.push({ name, register_number: reg, password: reg });
        }
      });
    }

    if (students.length === 0) {
      return res.status(400).json({ error: 'Unsupported file structure: No valid Student Name and Register Number could be extracted.' });
    }

    res.json({ success: true, students });
  } catch (error) {
    console.error(error);
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    res.status(400).json({ error: error.message || 'Failed to parse student file' });
  }
});

app.post('/api/admin/teachers/import', requireRole('admin'), upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const fileText = await extractTextFromFile(file.path, file.originalname);
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);

    const lines = fileText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let count = 0;

    const dataLines = lines.filter(line => {
      const lower = line.toLowerCase();
      return !(lower.includes('teacher name') || lower.includes('email') || lower.includes('password') || lower === 'name' || lower === 'email_id' || lower.includes('dept') || lower.includes('section') || lower.includes('year'));
    });

    for (const line of dataLines) {
      let parts = [];
      if (line.includes('|')) {
        parts = line.split('|');
      } else if (line.includes(',')) {
        parts = line.split(',');
      } else if (line.includes('\t')) {
        parts = line.split('\t');
      } else {
        parts = line.split(/\s{2,}/);
      }
      parts = parts.map(p => p.trim().replace(/^"|"$/g, '')).filter(Boolean);

      if (parts.length === 0) continue;

      let name = '';
      let email = '';
      let dept = '';
      let year = null;
      let section = '';

      const emailIdx = parts.findIndex(p => p.includes('@'));
      if (emailIdx !== -1) {
        email = parts[emailIdx];
      } else {
        continue;
      }

      let yearIdx = parts.findIndex((p, idx) => {
        if (idx === emailIdx) return false;
        if (/^[1-4]$/.test(p)) return true;
        const m = p.match(/\b([1-4])\b/);
        return !!m;
      });
      if (yearIdx !== -1) {
        const m = parts[yearIdx].match(/\b([1-4])\b/) || parts[yearIdx].match(/([1-4])/);
        year = m ? parseInt(m[1]) : parseInt(parts[yearIdx]);
      }

      let secIdx = parts.findIndex((p, idx) => {
        if (idx === emailIdx || idx === yearIdx) return false;
        return /^[A-Da-d]$/.test(p);
      });
      if (secIdx !== -1) {
        section = parts[secIdx].toUpperCase();
      }

      const remainingIndices = parts.map((_, idx) => idx).filter(idx => idx !== emailIdx && idx !== yearIdx && idx !== secIdx);

      if (remainingIndices.length >= 2) {
        const valA = parts[remainingIndices[0]];
        const valB = parts[remainingIndices[1]];

        let scoreA = 0;
        let scoreB = 0;

        // Rule 1: Dept doesn't contain spaces or dots
        if (!/[\s\.]/.test(valA)) scoreA += 2;
        if (!/[\s\.]/.test(valB)) scoreB += 2;

        // Rule 2: Dept is usually uppercase
        if (valA === valA.toUpperCase() && /[A-Z]/.test(valA)) scoreA += 1.5;
        if (valB === valB.toUpperCase() && /[A-Z]/.test(valB)) scoreB += 1.5;

        // Rule 3: Dept is usually shorter
        if (valA.length < valB.length) scoreA += 1;
        if (valB.length < valA.length) scoreB += 1;

        // Rule 4: Dept is typically 2-6 chars
        if (valA.length >= 2 && valA.length <= 6) scoreA += 1;
        if (valB.length >= 2 && valB.length <= 6) scoreB += 1;

        // Rule 5: Check against existing departments in JSON
        try {
          const depts = getDepartments().map(d => d.toUpperCase());
          if (depts.includes(valA.toUpperCase())) scoreA += 5;
          if (depts.includes(valB.toUpperCase())) scoreB += 5;
        } catch (e) {}

        if (scoreA >= scoreB) {
          dept = valA.toUpperCase();
          name = valB;
        } else {
          name = valA;
          dept = valB.toUpperCase();
        }
      } else if (remainingIndices.length === 1) {
        name = parts[remainingIndices[0]];
      }

      if (!name) {
        const prefix = email.split('@')[0];
        name = prefix.replace(/[^A-Za-z]/g, ' ').replace(/\s+/g, ' ').trim();
        name = name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
      }

      const usernamePart = email.split('@')[0];
      const alphabeticPassword = usernamePart.replace(/[^A-Za-z]/g, '').toUpperCase();
      const finalPassword = alphabeticPassword || 'TEACHER';

      let teacher = await db.get("SELECT id FROM teachers WHERE email = ?", [email]);
      let teacherId;
      if (teacher) {
        teacherId = teacher.id;
        await db.run("UPDATE teachers SET name = ? WHERE id = ?", [name, teacherId]);
      } else {
        const result = await db.run("INSERT INTO teachers (name, email, password) VALUES (?, ?, ?)", [name, email, finalPassword]);
        teacherId = result.id;
      }

      if (teacherId && dept && year && section) {
        await db.run(
          "INSERT OR IGNORE INTO teacher_classes (teacher_id, department, year, section) VALUES (?, ?, ?, ?)",
          [teacherId, dept, year, section]
        );
      }
      count++;
    }

    if (count === 0) {
      return res.status(400).json({ error: 'Unsupported file structure: No valid Teacher Name and Email could be extracted.' });
    }

    res.json({ success: true, message: `Successfully imported ${count} teacher accounts.` });
  } catch (error) {
    console.error(error);
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    res.status(400).json({ error: error.message || 'Failed to parse teacher file' });
  }
});

db.initialize().then(() => {
  app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error("Database initialization failed", err);
});
