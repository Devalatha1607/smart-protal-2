// =======================================================
// STUDENT PORTAL LOGIC & CENTRAL AUTHENTICATION
// =======================================================

let currentUser = null;
let currentRole = 'student'; // default login portal tab

// Exam state
let activeExam = null;
let examQuestions = [];
let currentQuestionIndex = 0;
let visitedQuestions = new Set();
let markedForReview = new Set();
let studentAnswers = {}; // questionId -> chosenOptionKey
let examTimer = null;
let timeRemaining = 0; // in seconds
let isCheated = false;
let ignoreBlur = false;

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  checkAuthSession();
});

// ----------------------------------------------------
// AUTHENTICATION LOGIC (Shared)
// ----------------------------------------------------

function toggleForgotLink() {
  const username = document.getElementById('login-username').value.trim();
  const link = document.getElementById('forgot-password-link');
  if (!username) {
    link.classList.add('hidden');
    return;
  }
  
  if (username.includes('@') || username.toLowerCase() === 'admin') {
    link.classList.remove('hidden');
  } else {
    link.classList.add('hidden');
  }
}

async function handleForgotPassword(event) {
  event.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  if (!username) {
    alert("Please enter your Email/Username first.");
    return;
  }
  
  if (!username.includes('@') && username.toLowerCase() !== 'admin') {
    alert("Forgot password is only available for Teacher and Admin accounts.");
    return;
  }

  try {
    const response = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: username })
    });
    const data = await response.json();
    if (response.ok) {
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      } else {
        alert(data.message || "Verification email sent. Check server logs or uploads/email_simulation.html");
      }
    } else {
      alert(data.error || "Failed to process forgot password request.");
    }
  } catch (error) {
    console.error(error);
    alert("Server communication error.");
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value.trim();
  const alertEl = document.getElementById('login-alert');

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();
    if (!response.ok) {
      alertEl.innerText = data.error || 'Login failed';
      alertEl.classList.remove('hidden');
      return;
    }

    currentUser = data.user;
    showPortalDashboard();
  } catch (error) {
    console.error(error);
    alertEl.innerText = 'Network connection failed.';
    alertEl.classList.remove('hidden');
  }
}

async function checkAuthSession() {
  try {
    const response = await fetch('/api/auth/me');
    const data = await response.json();
    if (data.loggedIn) {
      currentUser = data.user;
      showPortalDashboard();
    } else {
      showLoginView();
    }
  } catch (error) {
    console.error("Session check error", error);
    showLoginView();
  }
}

function showLoginView() {
  document.getElementById('auth-panel').classList.remove('hidden');
  document.getElementById('main-header').classList.add('hidden');
  document.getElementById('student-portal').classList.add('hidden');
  document.getElementById('student-exam-page').classList.add('hidden');
  document.getElementById('teacher-portal').classList.add('hidden');
  document.getElementById('admin-portal').classList.add('hidden');
}

function showPortalDashboard() {
  document.getElementById('auth-panel').classList.add('hidden');
  document.getElementById('main-header').classList.remove('hidden');

  // Set user badge details
  document.getElementById('badge-name').innerText = `Welcome ${currentUser.name}`;
  const regBadge = document.getElementById('badge-reg');
  if (currentUser.registerNumber) {
    regBadge.innerText = `[Reg: ${currentUser.registerNumber}]`;
    regBadge.classList.remove('hidden');
  } else {
    regBadge.classList.add('hidden');
  }

  // Route depending on role
  if (currentUser.role === 'student') {
    document.getElementById('student-portal').classList.remove('hidden');
    loadStudentDashboard();
  } else if (currentUser.role === 'teacher') {
    document.getElementById('teacher-portal').classList.remove('hidden');
    initTeacherPortal();
  } else if (currentUser.role === 'admin') {
    document.getElementById('admin-portal').classList.remove('hidden');
    initAdminPortal();
  }
}

async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
    currentUser = null;
    showLoginView();
  } catch (error) {
    console.error("Logout error", error);
  }
}


// ----------------------------------------------------
// STUDENT DASHBOARD LOGIC
// ----------------------------------------------------

async function loadStudentDashboard() {
  const container = document.getElementById('student-test-list');
  container.innerHTML = '<div class="text-center" style="grid-column: 1/-1;">Loading available assessments...</div>';

  try {
    const response = await fetch('/api/student/dashboard');
    const tests = await response.json();

    if (tests.length === 0) {
      container.innerHTML = '<div class="text-center" style="grid-column: 1/-1; color: var(--text-secondary);">No active tests assigned to your class.</div>';
      return;
    }

    container.innerHTML = '';
    tests.forEach(test => {
      const card = document.createElement('div');
      card.className = 'glass-card text-center';
      card.style.padding = '2rem';
      
      const isSubmitted = test.submitted;
      
      card.innerHTML = `
        <h3 style="font-size: 1.4rem; margin-bottom: 0.5rem; color: #fff;">${test.name}</h3>
        <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">
          Duration: <strong style="color: var(--secondary);">${test.duration} mins</strong>
        </p>
        <div>
          ${isSubmitted 
            ? `<button class="btn btn-secondary" style="width: 100%; cursor: not-allowed;" disabled>Submitted</button>`
            : `<button class="btn btn-primary" style="width: 100%;" onclick="startExam(${test.id})">Start Test</button>`
          }
        </div>
      `;
      container.appendChild(card);
    });
  } catch (error) {
    container.innerHTML = '<div class="text-center" style="grid-column: 1/-1; color: #ef4444;">Failed to load tests.</div>';
    console.error(error);
  }
}


// ----------------------------------------------------
// EXAM PAGE BEHAVIOR
// ----------------------------------------------------

async function startExam(testId) {
  if (!confirm("Do you want to start the examination? The timer will begin immediately.")) {
    return;
  }

  try {
    const response = await fetch(`/api/student/test/${testId}`);
    if (!response.ok) {
      const err = await response.json();
      alert(err.error || 'Failed to start test');
      return;
    }

    activeExam = await response.json();
    examQuestions = activeExam.questions;
    currentQuestionIndex = 0;
    visitedQuestions.clear();
    markedForReview.clear();
    studentAnswers = {};
    isCheated = false;

    if (examQuestions.length === 0) {
      alert("This exam does not contain any questions. Please contact your instructor.");
      return;
    }

    // Hide dashboard, show exam view
    document.getElementById('student-portal').classList.add('hidden');
    document.getElementById('main-header').classList.add('hidden'); // hide header during exam for maximum focus
    document.getElementById('student-exam-page').classList.remove('hidden');

    document.getElementById('exam-test-title').innerText = activeExam.testName;

    // Load first question
    renderQuestion(0);

    // Initialize Timer
    timeRemaining = activeExam.duration * 60; // to seconds
    updateTimerClock();
    
    if (examTimer) clearInterval(examTimer);
    examTimer = setInterval(() => {
      timeRemaining--;
      updateTimerClock();
      if (timeRemaining <= 0) {
        clearInterval(examTimer);
        ignoreBlur = true;
        alert("Time limit reached! Auto-submitting assessment.");
        setTimeout(() => { ignoreBlur = false; }, 200);
        submitExam(false); // auto submit
      }
    }, 1000);

    // Anti-Cheating Event Listeners
    setupAntiCheating(testId);

  } catch (error) {
    console.error(error);
    alert('Failed to connect to examination server.');
  }
}

function updateTimerClock() {
  const mins = Math.floor(timeRemaining / 60);
  const secs = timeRemaining % 60;
  document.getElementById('exam-timer-clock').innerText = 
    `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function renderQuestion(index) {
  if (index < 0 || index >= examQuestions.length) return;
  
  currentQuestionIndex = index;
  visitedQuestions.add(index);

  const question = examQuestions[index];
  
  // Set question badge
  document.getElementById('exam-question-badge').innerText = `Question ${index + 1} of ${examQuestions.length}`;
  
  // Set question text
  document.getElementById('exam-question-text').innerText = question.question_text;

  // Options list
  const optionsContainer = document.getElementById('exam-options-list');
  optionsContainer.innerHTML = '';

  question.options.forEach(opt => {
    const item = document.createElement('div');
    item.className = 'option-item';
    
    const chosenKey = studentAnswers[question.id];
    if (chosenKey === opt.key) {
      item.classList.add('selected');
    }

    item.innerHTML = `
      <div class="option-badge">${opt.key}</div>
      <div class="option-text">${opt.text}</div>
    `;

    item.onclick = () => {
      // Save choice
      studentAnswers[question.id] = opt.key;
      
      // Update styling
      const siblingOptions = optionsContainer.querySelectorAll('.option-item');
      siblingOptions.forEach(sib => sib.classList.remove('selected'));
      item.classList.add('selected');
      
      // Update palette grid
      renderPaletteGrid();
    };

    optionsContainer.appendChild(item);
  });

  renderPaletteGrid();
}

function prevQuestion() {
  if (currentQuestionIndex > 0) {
    renderQuestion(currentQuestionIndex - 1);
  }
}

function nextQuestion() {
  if (currentQuestionIndex < examQuestions.length - 1) {
    // If not answered yet, set visited status
    renderQuestion(currentQuestionIndex + 1);
  }
}

function markForReview() {
  if (markedForReview.has(currentQuestionIndex)) {
    markedForReview.delete(currentQuestionIndex);
  } else {
    markedForReview.add(currentQuestionIndex);
  }
  renderPaletteGrid();
}

function renderPaletteGrid() {
  const grid = document.getElementById('exam-palette-grid');
  grid.innerHTML = '';

  examQuestions.forEach((q, idx) => {
    const btn = document.createElement('button');
    btn.className = 'palette-btn';
    btn.innerText = idx + 1;

    // Classify palette state
    const isVisited = visitedQuestions.has(idx);
    const isAnswered = !!studentAnswers[q.id];
    const isMarked = markedForReview.has(idx);

    if (isMarked) {
      btn.classList.add('marked-review');
    } else if (isAnswered) {
      btn.classList.add('answered');
    } else if (isVisited) {
      btn.classList.add('visited-unanswered');
    } else {
      btn.classList.add('not-visited');
    }

    if (idx === currentQuestionIndex) {
      btn.classList.add('active-q');
    }

    btn.onclick = () => renderQuestion(idx);
    grid.appendChild(btn);
  });
}


// ----------------------------------------------------
// ANTI-CHEATING LOGIC
// ----------------------------------------------------

let blurListener = null;
let visibilityListener = null;
let pagehideListener = null;
let resizeListener = null;
let pipListener = null;

function setupAntiCheating(testId) {
  isCheated = false;

  blurListener = () => {
    if (ignoreBlur) return;
    if (document.visibilityState !== 'hidden') {
      triggerCheatingIncident(testId, "Application Minimized");
    }
  };

  visibilityListener = () => {
    if (document.visibilityState === 'hidden') {
      triggerCheatingIncident(testId, "Browser Tab Switched");
    }
  };

  pagehideListener = () => {
    triggerCheatingIncident(testId, "Leaving Test Page");
  };

  resizeListener = () => {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) {
      const threshold = 0.85;
      if (window.innerWidth < window.screen.width * threshold || window.innerHeight < window.screen.height * threshold) {
        triggerCheatingIncident(testId, "Split Screen Detected");
      }
    }
  };

  window.addEventListener('blur', blurListener);
  document.addEventListener('visibilitychange', visibilityListener);
  window.addEventListener('pagehide', pagehideListener);
  window.addEventListener('resize', resizeListener);

  if (document.pictureInPictureEnabled) {
    pipListener = () => {
      triggerCheatingIncident(testId, "Split Screen Detected");
    };
    document.addEventListener('enterpictureinpicture', pipListener);
  }
}

function removeAntiCheating() {
  if (blurListener) {
    window.removeEventListener('blur', blurListener);
    blurListener = null;
  }
  if (visibilityListener) {
    document.removeEventListener('visibilitychange', visibilityListener);
    visibilityListener = null;
  }
  if (pagehideListener) {
    window.removeEventListener('pagehide', pagehideListener);
    pagehideListener = null;
  }
  if (resizeListener) {
    window.removeEventListener('resize', resizeListener);
    resizeListener = null;
  }
  if (pipListener) {
    document.removeEventListener('enterpictureinpicture', pipListener);
    pipListener = null;
  }
}

async function triggerCheatingIncident(testId, reason) {
  if (isCheated) return;
  isCheated = true; // lock trigger

  removeAntiCheating();
  if (examTimer) clearInterval(examTimer);

  const answersList = examQuestions.map(q => ({
    questionId: q.id,
    chosenOptionKey: studentAnswers[q.id] || null
  }));

  try {
    await fetch(`/api/student/test/${testId}/cheat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: answersList, reason: reason })
    });
  } catch (error) {
    console.error(error);
  }

  showSubmissionConfirmation("Test automatically submitted due to violation of exam rules.");
}


// ----------------------------------------------------
// EXAM SUBMISSION SUBMIT ACTIONS
// ----------------------------------------------------

function triggerSubmitConfirmation() {
  // Check if all questions are answered
  for (let i = 0; i < examQuestions.length; i++) {
    const q = examQuestions[i];
    if (!studentAnswers[q.id]) {
      ignoreBlur = true;
      alert(`Please answer Question No. ${i + 1}`);
      setTimeout(() => { ignoreBlur = false; }, 200);
      renderQuestion(i); // redirect student's view to this question
      return;
    }
  }

  ignoreBlur = true;
  const confirmed = confirm("Are you sure you want to finalize and submit your responses?");
  setTimeout(() => { ignoreBlur = false; }, 200);

  if (confirmed) {
    submitExam(false);
  }
}

async function submitExam(cheatedFlag) {
  if (examTimer) clearInterval(examTimer);
  removeAntiCheating();

  const testId = activeExam.id || examQuestions[0].test_id;
  const answersList = examQuestions.map(q => ({
    questionId: q.id,
    chosenOptionKey: studentAnswers[q.id] || null
  }));

  try {
    const response = await fetch(`/api/student/test/${testId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: answersList })
    });

    if (response.ok) {
      showSubmissionConfirmation("Your response has been submitted successfully.");
    } else {
      const data = await response.json();
      ignoreBlur = true;
      alert(data.error || "Failed to submit responses.");
      setTimeout(() => { ignoreBlur = false; }, 200);
      // force reload dashboard
      location.reload();
    }
  } catch (error) {
    console.error(error);
    alert("Network error. Checking submission status.");
    location.reload();
  }
}

function showSubmissionConfirmation(message) {
  // Clear the whole body and display pure white confirmation page
  document.body.style.background = '#ffffff';
  document.body.style.color = '#111827';
  
  document.body.innerHTML = `
    <div class="confirmation-page">
      <div class="confirmation-card">
        <div class="confirmation-icon">✔</div>
        <h1 class="confirmation-title">Response Logged</h1>
        <p class="confirmation-msg">${message}</p>
        <button class="btn btn-primary" onclick="window.location.reload()" style="background: #10b981; border: 1px solid #10b981;">
          Back to Portal Selector
        </button>
      </div>
    </div>
  `;
}
