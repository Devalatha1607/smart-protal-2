// =======================================================
// TEACHER PORTAL CLIENT SCRIPT
// =======================================================

let teacherClasses = [];
let selectedDept = '';
let selectedYear = null;
let selectedSection = '';

let currentClassTests = [];
let currentEditingTestId = null;

function initTeacherPortal() {
  teacherClasses = currentUser.classes || [];
  selectedDept = '';
  selectedYear = null;
  selectedSection = '';
  currentEditingTestId = null;

  document.getElementById('teacher-class-selection').classList.remove('hidden');
  document.getElementById('teacher-dashboard').classList.add('hidden');
  
  renderDepartmentSelection();
}

// 1. Step-by-Step Class Selection Wizard
function renderDepartmentSelection() {
  const container = document.getElementById('teacher-allocated-classes');
  container.innerHTML = '';
  
  // Get unique departments allocated
  const depts = [...new Set(teacherClasses.map(c => c.department))];
  
  const header = document.getElementById('teacher-class-selection').querySelector('p');
  header.innerText = 'Step 1: Select allocated Department';

  if (depts.length === 0) {
    container.innerHTML = '<div class="text-center" style="grid-column: 1/-1; color: var(--text-secondary);">No classes assigned to this teacher account.</div>';
    return;
  }

  depts.forEach(dept => {
    const card = document.createElement('div');
    card.className = 'class-card-item';
    card.innerHTML = `
      <div class="class-card-dept">${dept}</div>
      <div class="class-card-details">Department Faculty</div>
    `;
    card.onclick = () => selectDepartment(dept);
    container.appendChild(card);
  });
}

function selectDepartment(dept) {
  selectedDept = dept;
  renderYearSelection();
}

function renderYearSelection() {
  const container = document.getElementById('teacher-allocated-classes');
  container.innerHTML = '';

  const header = document.getElementById('teacher-class-selection').querySelector('p');
  header.innerText = `Department: ${selectedDept} ➔ Step 2: Select Year`;

  // Get unique years allocated for chosen dept
  const years = [...new Set(
    teacherClasses
      .filter(c => c.department === selectedDept)
      .map(c => c.year)
  )].sort();

  years.forEach(yr => {
    const card = document.createElement('div');
    card.className = 'class-card-item';
    card.innerHTML = `
      <div class="class-card-dept">Year ${yr}</div>
      <div class="class-card-details">Academic Year</div>
    `;
    card.onclick = () => selectYear(yr);
    container.appendChild(card);
  });
}

function selectYear(year) {
  selectedYear = year;
  renderSectionSelection();
}

function renderSectionSelection() {
  const container = document.getElementById('teacher-allocated-classes');
  container.innerHTML = '';

  const header = document.getElementById('teacher-class-selection').querySelector('p');
  header.innerText = `Department: ${selectedDept} ➔ Year: ${selectedYear} ➔ Step 3: Select Section`;

  // Get unique sections allocated for chosen dept and year
  const sections = [...new Set(
    teacherClasses
      .filter(c => c.department === selectedDept && c.year === selectedYear)
      .map(c => c.section)
  )].sort();

  sections.forEach(sec => {
    const card = document.createElement('div');
    card.className = 'class-card-item';
    card.innerHTML = `
      <div class="class-card-dept">Section ${sec}</div>
      <div class="class-card-details">Classroom Section</div>
    `;
    card.onclick = () => selectSection(sec);
    container.appendChild(card);
  });
}

function selectSection(sec) {
  selectedSection = sec;
  openTeacherClassDashboard();
}

function returnToClassSelection() {
  initTeacherPortal();
}

// 2. Class Dashboard
function openTeacherClassDashboard() {
  document.getElementById('teacher-class-selection').classList.add('hidden');
  document.getElementById('teacher-dashboard').classList.remove('hidden');

  document.getElementById('teacher-dashboard-title').innerText = 
    `${selectedDept} - Year ${selectedYear} (Section ${selectedSection})`;

  // Reset side bar tabs
  switchTeacherTab('create-test');
}

function switchTeacherTab(tabName, linkEl) {
  // Update sidebar links
  const links = document.querySelectorAll('.sidebar-link');
  links.forEach(link => {
    if (linkEl && link === linkEl) {
      link.classList.add('active');
    } else if (!linkEl && link.innerText.toLowerCase().includes(tabName.replace('-', ' '))) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // Hide all panels
  document.getElementById('teacher-tab-create-test').classList.add('hidden');
  document.getElementById('teacher-tab-test-content').classList.add('hidden');
  document.getElementById('teacher-tab-manage-test').classList.add('hidden');
  document.getElementById('teacher-tab-view-result').classList.add('hidden');

  // Load specific panel
  if (tabName === 'create-test') {
    document.getElementById('teacher-tab-create-test').classList.remove('hidden');
    document.getElementById('create-test-form').reset();
  } else if (tabName === 'manage-test') {
    document.getElementById('teacher-tab-manage-test').classList.remove('hidden');
    loadClassTests();
  } else if (tabName === 'view-result') {
    document.getElementById('teacher-tab-view-result').classList.remove('hidden');
    loadTestsDropdown();
  } else if (tabName === 'test-content') {
    document.getElementById('teacher-tab-test-content').classList.remove('hidden');
  }
}

// 3. Create Assessment Test
async function handleCreateTest(event) {
  event.preventDefault();
  const name = document.getElementById('new-test-name').value.trim();
  const duration = document.getElementById('new-test-duration').value;

  try {
    const response = await fetch('/api/teacher/tests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        duration,
        department: selectedDept,
        year: selectedYear,
        section: selectedSection
      })
    });

    const data = await response.json();
    if (!response.ok) {
      alert(data.error || 'Failed to create test');
      return;
    }

    currentEditingTestId = data.testId;
    loadTestContentEditor(name);
  } catch (error) {
    console.error(error);
    alert('Server communication error.');
  }
}

function loadTestContentEditor(testName) {
  switchTeacherTab('test-content');
  document.getElementById('content-test-name-title').innerText = `Test: ${testName}`;
  
  // Hide form additions
  hideAddQuestionForm();
  hideUploadFileForm();
  
  // Load questions
  loadTestQuestions();
}

async function loadTestQuestions() {
  const tbody = document.getElementById('current-test-questions-tbody');
  tbody.innerHTML = '<tr><td colspan="4" class="text-center">Loading questions...</td></tr>';

  try {
    const response = await fetch(`/api/teacher/tests/${currentEditingTestId}/questions`);
    const questions = await response.json();

    if (questions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="color: var(--text-secondary);">No questions added yet. Use manual form or file upload!</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    questions.forEach((q, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td>
          <div style="font-weight: 600; color: #fff;">${q.question_text}</div>
        </td>
        <td>
          <div style="font-size: 0.85rem; color: var(--text-secondary);">
            A: ${q.option_a} | B: ${q.option_b} | C: ${q.option_c} | D: ${q.option_d}
          </div>
        </td>
        <td>
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span class="badge badge-info">${q.correct_option}</span>
            <button class="btn btn-danger btn-sm" onclick="removeQuestion(${q.id})" style="padding: 0.2rem 0.5rem; font-size:0.75rem;">Delete</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (error) {
    console.error(error);
    tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="color: #ef4444;">Failed to load questions.</td></tr>';
  }
}

// 4. Add/Remove Question Behaviors
function showAddQuestionForm() {
  document.getElementById('manual-question-form-container').classList.remove('hidden');
  document.getElementById('upload-file-form-container').classList.add('hidden');
  document.getElementById('manual-question-form').reset();
}

function hideAddQuestionForm() {
  document.getElementById('manual-question-form-container').classList.add('hidden');
}

async function handleManualQuestionSubmit(event) {
  event.preventDefault();
  const question_text = document.getElementById('mq-text').value.trim();
  const option_a = document.getElementById('mq-a').value.trim();
  const option_b = document.getElementById('mq-b').value.trim();
  const option_c = document.getElementById('mq-c').value.trim();
  const option_d = document.getElementById('mq-d').value.trim();
  const correct_option = document.getElementById('mq-correct').value;

  try {
    const response = await fetch(`/api/teacher/tests/${currentEditingTestId}/questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question_text, option_a, option_b, option_c, option_d, correct_option })
    });

    if (response.ok) {
      document.getElementById('manual-question-form').reset();
      loadTestQuestions();
    } else {
      const err = await response.json();
      alert(err.error || 'Failed to add question');
    }
  } catch (error) {
    console.error(error);
    alert('Server communication error.');
  }
}

async function removeQuestion(questionId) {
  if (!confirm("Are you sure you want to delete this question?")) return;
  try {
    const response = await fetch(`/api/teacher/tests/${currentEditingTestId}/questions/${questionId}`, {
      method: 'DELETE'
    });
    if (response.ok) {
      loadTestQuestions();
    } else {
      alert("Failed to delete question.");
    }
  } catch (error) {
    console.error(error);
  }
}

// 5. Upload Document Questions
function showUploadFileForm() {
  document.getElementById('upload-file-form-container').classList.remove('hidden');
  document.getElementById('manual-question-form-container').classList.add('hidden');
  document.getElementById('upload-file-name').innerText = '';
  document.getElementById('file-upload-form').reset();
}

function hideUploadFileForm() {
  document.getElementById('upload-file-form-container').classList.add('hidden');
}

function updateUploadLabel(input) {
  const label = document.getElementById('upload-file-name');
  if (input.files && input.files[0]) {
    label.innerText = `Selected File: ${input.files[0].name}`;
  } else {
    label.innerText = '';
  }
}

async function handleFileUpload(event) {
  event.preventDefault();
  const input = document.getElementById('upload-file-input');
  if (!input.files || input.files.length === 0) {
    alert("Please select a file to import");
    return;
  }

  const formData = new FormData();
  formData.append('file', input.files[0]);

  const loadText = document.getElementById('upload-file-name');
  loadText.innerText = "Extracting & Importing questions, please wait...";

  try {
    const response = await fetch(`/api/teacher/tests/${currentEditingTestId}/upload`, {
      method: 'POST',
      body: formData
    });

    const data = await response.json();
    if (response.ok) {
      alert(data.message || 'Questions imported successfully.');
      hideUploadFileForm();
      loadTestQuestions();
    } else {
      alert(data.error || 'Failed to extract questions.');
      loadText.innerText = "Error importing. Try again.";
    }
  } catch (error) {
    console.error(error);
    alert('Server communication error during file upload.');
  }
}

// 6. Manage Tests
async function loadClassTests() {
  const tbody = document.getElementById('manage-tests-tbody');
  tbody.innerHTML = '<tr><td colspan="4" class="text-center">Loading tests list...</td></tr>';

  try {
    const response = await fetch(`/api/teacher/tests?department=${selectedDept}&year=${selectedYear}&section=${selectedSection}`);
    const tests = await response.json();
    currentClassTests = tests;

    if (tests.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="color: var(--text-secondary);">No exams created for this class yet.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    tests.forEach(test => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${test.name}</strong></td>
        <td>${test.duration} minutes</td>
        <td>${test.department} - Y${test.year} (${test.section})</td>
        <td class="text-right">
          <button class="btn btn-secondary btn-sm" onclick="editTestQuestions(${test.id}, '${test.name}')">View Qs</button>
          <button class="btn btn-primary btn-sm" onclick="openAddQuestionDirect(${test.id}, '${test.name}')">Add Q</button>
          <button class="btn btn-danger btn-sm" onclick="deleteTest(${test.id})">Delete</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (error) {
    console.error(error);
    tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="color: #ef4444;">Failed to load tests.</td></tr>';
  }
}

function editTestQuestions(testId, name) {
  currentEditingTestId = testId;
  loadTestContentEditor(name);
}

function openAddQuestionDirect(testId, name) {
  currentEditingTestId = testId;
  loadTestContentEditor(name);
  showAddQuestionForm();
}

async function deleteTest(testId) {
  if (!confirm("WARNING: Deleting this test will permanently remove it and all associated questions and student submissions. Proceed?")) return;
  try {
    const response = await fetch(`/api/teacher/tests/${testId}`, { method: 'DELETE' });
    if (response.ok) {
      loadClassTests();
    } else {
      alert("Failed to delete test.");
    }
  } catch (error) {
    console.error(error);
  }
}


// ----------------------------------------------------
// VIEW RESULTS & EVALUATIONS
// ----------------------------------------------------

async function loadTestsDropdown() {
  const select = document.getElementById('results-test-selector');
  select.innerHTML = '<option value="">-- Choose Exam --</option>';

  try {
    const response = await fetch(`/api/teacher/tests?department=${selectedDept}&year=${selectedYear}&section=${selectedSection}`);
    const tests = await response.json();

    if (tests.length === 0) {
      document.getElementById('test-results-container').classList.add('hidden');
      return;
    }

    tests.forEach(test => {
      const opt = document.createElement('option');
      opt.value = test.id;
      opt.innerText = test.name;
      select.appendChild(opt);
    });
  } catch (error) {
    console.error(error);
  }
}

let activeResultsPayload = null; // Store locally for exporting

async function loadTestResults(testId) {
  if (!testId) {
    document.getElementById('test-results-container').classList.add('hidden');
    return;
  }

  try {
    const response = await fetch(`/api/teacher/tests/${testId}/results`);
    const data = await response.json();
    activeResultsPayload = data;

    document.getElementById('test-results-container').classList.remove('hidden');
    document.getElementById('results-test-title').innerText = `Results: ${data.testName}`;

    // Statistics Card values
    document.getElementById('attendance-stat-value').innerText = `${data.attendance.attended} / ${data.attendance.total}`;
    document.getElementById('class-pct-value').innerText = `${data.analytics.classPercentage}%`;
    document.getElementById('dept-pct-value').innerText = `${data.analytics.departmentPercentage}%`;
    document.getElementById('year-pct-value').innerText = `${data.analytics.yearPercentage}%`;

    // Student grades roster
    const tbody = document.getElementById('student-grades-tbody');
    tbody.innerHTML = '';
    
    data.results.forEach(res => {
      const tr = document.createElement('tr');
      let badgeClass = 'badge-danger';
      if (res.status === 'Attended') badgeClass = 'badge-success';
      else if (res.status === 'CHEAT DETECTED') badgeClass = 'badge-danger';

      const marksFormatted = res.marks === 'ABS' ? 'ABS' : `<strong>${res.marks}</strong>`;

      const actionButton = (res.status === 'Attended' || res.status === 'CHEAT DETECTED')
        ? `<button class="btn btn-primary btn-sm" onclick="reviewStudentResponse(${res.id}, ${testId})" style="padding: 0.2rem 0.5rem; font-size: 0.8rem;">Review Sheet</button>`
        : `<span style="color: var(--text-secondary); font-size: 0.85rem;">-</span>`;

      tr.innerHTML = `
        <td>${res.name}</td>
        <td>${res.registerNumber}</td>
        <td><span class="badge ${badgeClass}">${res.status}</span></td>
        <td>${marksFormatted}</td>
        <td style="text-align: center;">${actionButton}</td>
      `;
      tbody.appendChild(tr);
    });

    // Cheating Logs table
    const cheatBody = document.getElementById('cheating-logs-tbody');
    cheatBody.innerHTML = '';

    if (data.cheatingLogs.length === 0) {
      cheatBody.innerHTML = '<tr><td colspan="5" class="text-center" style="color: var(--text-secondary);">No cheating attempts detected. Good compliance!</td></tr>';
    } else {
      data.cheatingLogs.forEach(log => {
        const tr = document.createElement('tr');
        const formattedTime = new Date(log.timestamp).toLocaleString();
        
        let reason = "Tab Switched / Minimised";
        if (log.test_name && log.test_name.includes('(')) {
          const parts = log.test_name.split('(');
          reason = parts[parts.length - 1].replace(')', '').trim();
        }
        
        tr.innerHTML = `
          <td>${log.student_name}</td>
          <td>${log.register_number}</td>
          <td>${log.department} - Y${log.year} (${log.section})</td>
          <td>${formattedTime}</td>
          <td><span class="badge badge-danger">${reason}</span></td>
        `;
        cheatBody.appendChild(tr);
      });
    }

  } catch (error) {
    console.error(error);
    alert("Failed to load results details.");
  }
}


// ----------------------------------------------------
// EXPORT RESULTS TO EXCEL/CSV
// ----------------------------------------------------

function exportResultsCSV(triggerDownload = true) {
  if (!activeResultsPayload) {
    alert("No results loaded to export.");
    return;
  }

  // Generate CSV rows
  const headers = ["Student Name", "Register Number", "Marks", "Attendance Status"];
  const rows = activeResultsPayload.results.map(r => [
    r.name,
    r.registerNumber,
    r.marks,
    r.status
  ]);

  // Merge headers + rows
  let csvContent = headers.join(",") + "\n";
  rows.forEach(row => {
    // Escape strings if they contain commas
    const escapedRow = row.map(val => {
      let str = String(val);
      if (str.includes(',')) str = `"${str}"`;
      return str;
    });
    csvContent += escapedRow.join(",") + "\n";
  });

  if (triggerDownload) {
    // Standard download payload creation
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const filename = `${activeResultsPayload.testName.replace(/\s+/g, '_')}_Results.csv`;
    
    if (navigator.msSaveBlob) { // IE 10+
      navigator.msSaveBlob(blob, filename);
    } else {
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  } else {
    // Show Online
    showCsvOnlinePreview(csvContent);
  }
}

function closeCsvPreviewModal() {
  document.getElementById('csv-preview-modal').classList.add('hidden');
}

// ----------------------------------------------------
// TEACHER PASSWORD CHANGE
// ----------------------------------------------------

function openTeacherChangePasswordModal() {
  document.getElementById('teacher-pw-change-form').reset();
  document.getElementById('teacher-pw-change-modal').classList.remove('hidden');
}

function closeTeacherChangePasswordModal() {
  document.getElementById('teacher-pw-change-modal').classList.add('hidden');
}

async function handleTeacherPwChangeSubmit(event) {
  event.preventDefault();
  const oldEmail = document.getElementById('teacher-pw-old-email').value.trim();
  const oldPassword = document.getElementById('teacher-pw-old-pass').value.trim();
  const newPassword = document.getElementById('teacher-pw-new-pass').value.trim();

  try {
    const response = await fetch('/api/teacher/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldEmail, oldPassword, newPassword })
    });

    if (response.ok) {
      alert("Password changed successfully!");
      closeTeacherChangePasswordModal();
    } else {
      const err = await response.json();
      alert(err.error || "Failed to change password");
    }
  } catch (error) {
    console.error(error);
    alert("Server communication error.");
  }
}

// ----------------------------------------------------
// VIEW CSV ONLINE INTERACTIVE GRID LOGIC
// ----------------------------------------------------

let csvDataRows = [];
let csvFilteredRows = [];
let csvCurrentPage = 1;
const csvRowsPerPage = 5;
let csvSortDirection = { name: null, reg: null, marks: null, status: null };

function showCsvOnlinePreview(csvContent) {
  csvDataRows = parseCSVText(csvContent);
  csvFilteredRows = [...csvDataRows];
  csvCurrentPage = 1;
  csvSortDirection = { name: null, reg: null, marks: null, status: null };

  const searchInput = document.getElementById('csv-search-input');
  if (searchInput) searchInput.value = '';

  // Reset indicator styles
  const indicators = ['name', 'reg', 'marks', 'status'];
  indicators.forEach(col => {
    const el = document.getElementById(`csv-sort-${col}`);
    if (el) el.innerText = '↕';
  });

  renderCsvTable();
  document.getElementById('csv-preview-modal').classList.remove('hidden');
}

function parseCSVText(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  
  const parsed = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const cells = [];
    let currentCell = '';
    let insideQuotes = false;
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        insideQuotes = !insideQuotes;
      } else if (char === ',' && !insideQuotes) {
        cells.push(currentCell.trim());
        currentCell = '';
      } else {
        currentCell += char;
      }
    }
    cells.push(currentCell.trim());

    if (cells.length >= 4) {
      parsed.push({
        name: cells[0].replace(/^"|"$/g, ''),
        reg: cells[1].replace(/^"|"$/g, ''),
        marks: cells[2].replace(/^"|"$/g, ''),
        status: cells[3].replace(/^"|"$/g, '')
      });
    }
  }
  return parsed;
}

function renderCsvTable() {
  const tbody = document.getElementById('csv-preview-tbody');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (csvFilteredRows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="color: var(--text-secondary);">No matching records found.</td></tr>';
    document.getElementById('csv-pagination-info').innerText = 'Showing 0-0 of 0';
    document.getElementById('csv-btn-prev').disabled = true;
    document.getElementById('csv-btn-next').disabled = true;
    return;
  }

  const startIndex = (csvCurrentPage - 1) * csvRowsPerPage;
  const endIndex = Math.min(startIndex + csvRowsPerPage, csvFilteredRows.length);
  const paginated = csvFilteredRows.slice(startIndex, endIndex);

  paginated.forEach(row => {
    const tr = document.createElement('tr');
    const badgeClass = row.status === 'Attended' ? 'badge-success' : 'badge-danger';
    tr.innerHTML = `
      <td>${row.name}</td>
      <td>${row.reg}</td>
      <td><strong>${row.marks}</strong></td>
      <td><span class="badge ${badgeClass}">${row.status}</span></td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('csv-pagination-info').innerText = `Showing ${startIndex + 1}-${endIndex} of ${csvFilteredRows.length}`;
  document.getElementById('csv-btn-prev').disabled = csvCurrentPage === 1;
  document.getElementById('csv-btn-next').disabled = endIndex >= csvFilteredRows.length;
}

function onCsvSearch() {
  const query = document.getElementById('csv-search-input').value.toLowerCase().trim();
  if (!query) {
    csvFilteredRows = [...csvDataRows];
  } else {
    csvFilteredRows = csvDataRows.filter(r => 
      r.name.toLowerCase().includes(query) || 
      r.reg.toLowerCase().includes(query)
    );
  }
  csvCurrentPage = 1;
  renderCsvTable();
}

function sortCsvTable(column) {
  const currentDir = csvSortDirection[column];
  const newDir = currentDir === 'asc' ? 'desc' : 'asc';
  
  const indicators = ['name', 'reg', 'marks', 'status'];
  indicators.forEach(col => {
    const el = document.getElementById(`csv-sort-${col}`);
    if (el) el.innerText = '↕';
  });

  const activeIndicator = document.getElementById(`csv-sort-${column}`);
  if (activeIndicator) activeIndicator.innerText = newDir === 'asc' ? '▲' : '▼';
  csvSortDirection[column] = newDir;

  csvFilteredRows.sort((a, b) => {
    let valA = a[column];
    let valB = b[column];

    if (column === 'marks') {
      const numA = parseFloat(valA);
      const numB = parseFloat(valB);
      if (!isNaN(numA) && !isNaN(numB)) {
        valA = numA;
        valB = numB;
      }
    }

    if (valA < valB) return newDir === 'asc' ? -1 : 1;
    if (valA > valB) return newDir === 'asc' ? 1 : -1;
    return 0;
  });

  csvCurrentPage = 1;
  renderCsvTable();
}

function prevCsvPage() {
  if (csvCurrentPage > 1) {
    csvCurrentPage--;
    renderCsvTable();
  }
}

function nextCsvPage() {
  const maxPage = Math.ceil(csvFilteredRows.length / csvRowsPerPage);
  if (csvCurrentPage < maxPage) {
    csvCurrentPage++;
    renderCsvTable();
  }
}

async function reviewStudentResponse(studentId, testId) {
  try {
    const response = await fetch(`/api/teacher/tests/${testId}/responses/${studentId}`);
    if (!response.ok) {
      const err = await response.json();
      alert(err.error || "Failed to load response details.");
      return;
    }
    const data = await response.json();

    // Fill metadata
    document.getElementById('review-student-name').innerText = data.studentName;
    document.getElementById('review-register-number').innerText = data.registerNumber;
    document.getElementById('review-test-name').innerText = data.testName;
    document.getElementById('review-submitted-at').innerText = new Date(data.submittedAt).toLocaleString();
    document.getElementById('review-score').innerText = `${data.score} / ${data.totalQuestions}`;

    // Fill cheat status details
    const metadataCard = document.getElementById('answer-review-modal').querySelector('.glass-card');
    const oldBlock = metadataCard.querySelector('#review-cheat-status-block');
    if (oldBlock) oldBlock.remove();

    if (data.cheated) {
      const cheatDiv = document.createElement('div');
      cheatDiv.id = 'review-cheat-status-block';
      cheatDiv.style.cssText = 'margin-top: 1rem; padding: 0.75rem; background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; border-radius: 8px; color: #f87171; font-size: 0.95rem; line-height: 1.5;';
      cheatDiv.innerHTML = `
        <div style="font-weight: 700; color: #ef4444; margin-bottom: 0.25rem;">Status: CHEAT DETECTED</div>
        <div><strong>Reason:</strong> ${data.cheatReason || 'Tab Switched / Minimised'}</div>
      `;
      metadataCard.appendChild(cheatDiv);
    }

    // Fill responses list
    const container = document.getElementById('review-responses-container');
    container.innerHTML = '';

    data.responses.forEach(resp => {
      const qCard = document.createElement('div');
      qCard.className = 'glass-card';
      qCard.style.padding = '1.25rem';
      qCard.style.border = '1px solid var(--border-glass)';
      qCard.style.marginBottom = '1rem';
      
      const badgeClass = resp.isCorrect ? 'badge-success' : 'badge-danger';
      const badgeText = resp.isCorrect ? 'Correct' : 'Wrong';

      qCard.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem;">
          <h4 style="margin: 0; color: var(--secondary);">Question ${resp.questionNumber}</h4>
          <span class="badge ${badgeClass}">${badgeText}</span>
        </div>
        <p style="margin: 0 0 1rem 0; font-weight: 600; color: #fff;">${resp.questionText}</p>
        
        <div style="display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.9rem; color: var(--text-secondary);">
          <div>
            <span style="color: var(--text-secondary); font-weight: 500;">Option Selected:</span> 
            <span style="color: ${resp.isCorrect ? '#22c55e' : '#f87171'}; font-weight: 600;">${resp.optionSelected}</span>
          </div>
          <div>
            <span style="color: var(--text-secondary); font-weight: 500;">Correct Answer:</span> 
            <span style="color: #22c55e; font-weight: 600;">${resp.correctAnswer}</span>
          </div>
        </div>
      `;
      container.appendChild(qCard);
    });

    // Show modal
    document.getElementById('answer-review-modal').classList.remove('hidden');
  } catch (error) {
    console.error(error);
    alert("Server communication error.");
  }
}

function closeAnswerReviewModal() {
  document.getElementById('answer-review-modal').classList.add('hidden');
}

