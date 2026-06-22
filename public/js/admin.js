// =======================================================
// ADMIN PORTAL CLIENT SCRIPT
// =======================================================

let currentStudentClass = { department: '', year: null, section: '' };
let teacherModalClasses = []; // Temporary array for class assignments in modal
let adminDepartments = [];

async function initAdminPortal() {
  await loadAdminDepartments();

  const studDeptSelect = document.getElementById('admin-stud-dept');
  const studYearSelect = document.getElementById('admin-stud-year');
  const studSecSelect = document.getElementById('admin-stud-sec');

  if (studDeptSelect && !studDeptSelect.dataset.listenerAdded) {
    studDeptSelect.addEventListener('change', loadOrGenerateStudentGrid);
    studDeptSelect.dataset.listenerAdded = 'true';
  }
  if (studYearSelect && !studYearSelect.dataset.listenerAdded) {
    studYearSelect.addEventListener('change', loadOrGenerateStudentGrid);
    studYearSelect.dataset.listenerAdded = 'true';
  }
  if (studSecSelect && !studSecSelect.dataset.listenerAdded) {
    studSecSelect.addEventListener('change', loadOrGenerateStudentGrid);
    studSecSelect.dataset.listenerAdded = 'true';
  }

  await checkUndoStatus();
  switchAdminTab('students');
}

async function loadAdminDepartments() {
  try {
    const response = await fetch('/api/departments');
    adminDepartments = await response.json();
    
    // Populate admin student management dropdown
    const studDeptSelect = document.getElementById('admin-stud-dept');
    if (studDeptSelect) {
      studDeptSelect.innerHTML = '';
      adminDepartments.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.innerText = d;
        studDeptSelect.appendChild(opt);
      });
    }

    // Populate teacher modal dropdown
    const teachDeptSelect = document.getElementById('teacher-modal-dept');
    if (teachDeptSelect) {
      teachDeptSelect.innerHTML = '';
      adminDepartments.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.innerText = d;
        teachDeptSelect.appendChild(opt);
      });
    }
  } catch (error) {
    console.error("Failed to load departments", error);
  }
}

function openDeptManager() {
  renderDeptManagerList();
  document.getElementById('dept-modal-input').value = '';
  document.getElementById('dept-modal').classList.remove('hidden');
}

function closeDeptManager() {
  document.getElementById('dept-modal').classList.add('hidden');
}

function renderDeptManagerList() {
  const select = document.getElementById('dept-modal-list');
  select.innerHTML = '';
  adminDepartments.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.innerText = d;
    select.appendChild(opt);
  });
}

function onDeptSelectChange() {
  const select = document.getElementById('dept-modal-list');
  document.getElementById('dept-modal-input').value = select.value || '';
}

async function handleDeptAdd() {
  const name = document.getElementById('dept-modal-input').value.trim();
  if (!name) return alert("Please enter a department name");

  try {
    const response = await fetch('/api/departments/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ department: name })
    });
    if (response.ok) {
      await loadAdminDepartments();
      renderDeptManagerList();
      document.getElementById('dept-modal-input').value = '';
    } else {
      const err = await response.json();
      alert(err.error || "Failed to add department");
    }
  } catch (err) {
    console.error(err);
  }
}

async function handleDeptRename() {
  const select = document.getElementById('dept-modal-list');
  const oldName = select.value;
  const newName = document.getElementById('dept-modal-input').value.trim();

  if (!oldName) return alert("Please select a department to rename from the list");
  if (!newName) return alert("Please enter a new department name");
  if (oldName === newName) return;

  try {
    const response = await fetch('/api/departments/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldName, newName })
    });
    if (response.ok) {
      await loadAdminDepartments();
      renderDeptManagerList();
      document.getElementById('dept-modal-input').value = '';
    } else {
      const err = await response.json();
      alert(err.error || "Failed to rename department");
    }
  } catch (err) {
    console.error(err);
  }
}

async function handleDeptRemove() {
  const select = document.getElementById('dept-modal-list');
  const name = select.value;
  if (!name) return alert("Please select a department to remove");

  if (!confirm(`Are you sure you want to remove the department '${name}'? Existing student records will not be deleted, but this option will be removed.`)) return;

  try {
    const response = await fetch('/api/departments/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ department: name })
    });
    if (response.ok) {
      await loadAdminDepartments();
      renderDeptManagerList();
      document.getElementById('dept-modal-input').value = '';
    } else {
      const err = await response.json();
      alert(err.error || "Failed to remove department");
    }
  } catch (err) {
    console.error(err);
  }
}

function switchAdminTab(tabName, linkEl) {
  // Update sidebar links
  const links = document.querySelectorAll('.sidebar-link');
  links.forEach(link => {
    if (linkEl && link === linkEl) {
      link.classList.add('active');
    } else if (!linkEl && link.innerText.toLowerCase().includes(tabName)) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // Hide panels
  document.getElementById('admin-tab-students').classList.add('hidden');
  document.getElementById('admin-tab-teachers').classList.add('hidden');
  document.getElementById('admin-tab-analytics').classList.add('hidden');

  // Load specific tab
  if (tabName === 'students') {
    document.getElementById('admin-tab-students').classList.remove('hidden');
    loadOrGenerateStudentGrid();
  } else if (tabName === 'teachers') {
    document.getElementById('admin-tab-teachers').classList.remove('hidden');
    loadTeachersRoster();
  } else if (tabName === 'analytics') {
    document.getElementById('admin-tab-analytics').classList.remove('hidden');
    loadAdminAnalytics();
  }
}


// ----------------------------------------------------
// STUDENT MANAGEMENT
// ----------------------------------------------------

async function loadOrGenerateStudentGrid() {
  const dept = document.getElementById('admin-stud-dept').value;
  const year = parseInt(document.getElementById('admin-stud-year').value);
  const section = document.getElementById('admin-stud-sec').value;

  currentStudentClass = { department: dept, year, section };

  document.getElementById('student-grid-title').innerText = 
    `Class: ${dept} - Year ${year} (Section ${section})`;
  
  const tbody = document.getElementById('student-editable-tbody');
  tbody.innerHTML = '<tr><td colspan="5" class="text-center">Loading student records...</td></tr>';
  document.getElementById('student-grid-container').classList.remove('hidden');

  try {
    const response = await fetch(`/api/admin/students?department=${dept}&year=${year}&section=${section}`);
    const existingStudents = await response.json();

    tbody.innerHTML = '';
    
    if (existingStudents.length > 0) {
      existingStudents.forEach((student, idx) => {
        appendStudentRow(student, idx + 1);
      });
    } else {
      const defaultRowsCount = 50;
      for (let i = 0; i < defaultRowsCount; i++) {
        const student = { id: null, name: '', register_number: '', password: '' };
        appendStudentRow(student, i + 1);
      }
    }

    // Update count display
    updateStudentCountDisplay();

  } catch (error) {
    console.error(error);
    tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="color: #ef4444;">Failed to load student grid.</td></tr>';
  }
}

function updateStudentCountDisplay() {
  const countInput = document.getElementById('admin-stud-count');
  if (!countInput) return;

  const rows = document.querySelectorAll('.student-row');
  let activeCount = 0;
  rows.forEach(row => {
    const name = row.querySelector('.stud-name').value.trim();
    const reg = row.querySelector('.stud-reg').value.trim();
    if (name && reg) {
      activeCount++;
    }
  });
  countInput.value = activeCount;
}

function appendStudentRow(student, serialNo) {
  const tbody = document.getElementById('student-editable-tbody');
  const tr = document.createElement('tr');
  tr.className = 'student-row';
  tr.dataset.id = student.id || ''; // Empty string if new

  tr.innerHTML = `
    <td>${serialNo}</td>
    <td><input type="text" class="table-input stud-name" value="${student.name}" placeholder="Full Name" required></td>
    <td><input type="text" class="table-input stud-reg" value="${student.register_number}" placeholder="Reg Number" required></td>
    <td><input type="text" class="table-input stud-pass" value="${student.password}" placeholder="Password" required></td>
    <td style="text-align: center;">
      <button class="btn btn-danger btn-sm" onclick="removeStudentRow(this, ${student.id})" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;">
        Remove
      </button>
    </td>
  `;
  tbody.appendChild(tr);

  // Setup auto-copy from register_number to password
  const regInput = tr.querySelector('.stud-reg');
  const passInput = tr.querySelector('.stud-pass');
  const nameInput = tr.querySelector('.stud-name');

  // Real-time count update on typing
  nameInput.addEventListener('input', updateStudentCountDisplay);

  // Force password to be identical to register number in real-time
  regInput.addEventListener('input', () => {
    passInput.value = regInput.value;
    updateStudentCountDisplay();
  });
  
  passInput.addEventListener('input', () => {
    passInput.value = regInput.value;
  });
}

function addNewStudentRow() {
  const tbody = document.getElementById('student-editable-tbody');
  const serialNo = tbody.querySelectorAll('.student-row').length + 1;
  const blankStudent = { id: null, name: '', register_number: '', password: '' };
  appendStudentRow(blankStudent, serialNo);
  updateStudentCountDisplay();
}

async function removeStudentRow(button, studentId) {
  if (studentId) {
    if (!confirm("Are you sure you want to permanently delete this student from the database?")) return;
    try {
      const response = await fetch(`/api/admin/students/${studentId}`, { method: 'DELETE' });
      if (!response.ok) {
        alert("Failed to delete student from database");
        return;
      }
    } catch (error) {
      console.error(error);
      alert("Error contacting database.");
      return;
    }
  }

  // Remove row from UI
  const row = button.closest('tr');
  row.remove();

  // Renumber serial numbers
  const rows = document.getElementById('student-editable-tbody').querySelectorAll('.student-row');
  rows.forEach((r, idx) => {
    r.cells[0].innerText = idx + 1;
  });

  updateStudentCountDisplay();
}

async function saveStudentGrid() {
  const rows = document.querySelectorAll('.student-row');
  const studentsList = [];

  rows.forEach(row => {
    const id = row.dataset.id ? parseInt(row.dataset.id) : null;
    const name = row.querySelector('.stud-name').value.trim();
    const register_number = row.querySelector('.stud-reg').value.trim();
    const password = row.querySelector('.stud-pass').value.trim();

    // Ignore row if Name is empty, Register Number is empty, or the entire row is blank
    if (!name || !register_number) {
      return;
    }

    studentsList.push({ id, name, register_number, password: password || register_number });
  });

  try {
    const response = await fetch('/api/admin/students/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        department: currentStudentClass.department,
        year: currentStudentClass.year,
        section: currentStudentClass.section,
        students: studentsList
      })
    });

    if (response.ok) {
      alert("Student roster saved successfully!");
      loadOrGenerateStudentGrid(); // reload grid
    } else {
      const err = await response.json();
      alert(err.error || "Failed to save student details.");
    }
  } catch (error) {
    console.error(error);
    alert("Server communication error.");
  }
}

async function clearAllStudents() {
  if (!confirm("Are you sure you want to delete all students in this class?")) {
    return;
  }

  const dept = currentStudentClass.department;
  const year = currentStudentClass.year;
  const section = currentStudentClass.section;

  try {
    const response = await fetch('/api/admin/students/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ department: dept, year, section })
    });

    if (response.ok) {
      alert("All students in this class have been cleared successfully!");
      loadOrGenerateStudentGrid(); // reload grid
    } else {
      const err = await response.json();
      alert(err.error || "Failed to clear student roster.");
    }
  } catch (error) {
    console.error(error);
    alert("Server communication error.");
  }
}


// ----------------------------------------------------
// TEACHER MANAGEMENT
// ----------------------------------------------------

async function loadTeachersRoster() {
  const tbody = document.getElementById('teacher-roster-tbody');
  tbody.innerHTML = '<tr><td colspan="5" class="text-center">Loading faculty records...</td></tr>';

  try {
    const response = await fetch('/api/admin/teachers');
    const teachers = await response.json();

    if (teachers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="color: var(--text-secondary);">No teachers registered yet.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    teachers.forEach(t => {
      const tr = document.createElement('tr');
      
      const classTags = t.classes.map(c => 
        `<span class="badge badge-info" style="margin-right: 0.25rem; margin-bottom: 0.25rem;">${c.department}-Y${c.year}(${c.section})</span>`
      ).join('') || '<span style="color: var(--text-muted); font-size:0.85rem;">No classes assigned</span>';

      tr.innerHTML = `
        <td><strong>${t.name}</strong></td>
        <td>${t.email}</td>
        <td><code>${t.password}</code></td>
        <td>
          <div style="display: flex; flex-wrap: wrap;">${classTags}</div>
        </td>
        <td style="text-align: center;">
          <div style="display: flex; gap: 0.5rem; justify-content: center;">
            <button class="btn btn-secondary btn-sm" onclick="editTeacherAccount(${JSON.stringify(t).replace(/"/g, '&quot;')})">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deleteTeacherAccount(${t.id})">Delete</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (error) {
    console.error(error);
    tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="color: #ef4444;">Failed to load teachers list.</td></tr>';
  }
}

function openTeacherModal() {
  document.getElementById('teacher-modal-title').innerText = 'Create Teacher Account';
  document.getElementById('teacher-modal-id').value = '';
  document.getElementById('teacher-modal-form').reset();
  
  teacherModalClasses = [];
  renderTeacherModalClasses();
  
  document.getElementById('teacher-modal').classList.remove('hidden');
}

function closeTeacherModal() {
  document.getElementById('teacher-modal').classList.add('hidden');
}

function addTeacherModalClass() {
  const dept = document.getElementById('teacher-modal-dept').value;
  const year = parseInt(document.getElementById('teacher-modal-year').value);
  const section = document.getElementById('teacher-modal-sec').value;

  // Avoid duplicates
  const exists = teacherModalClasses.some(c => c.department === dept && c.year === year && c.section === section);
  if (!exists) {
    teacherModalClasses.push({ department: dept, year, section });
    renderTeacherModalClasses();
  }
}

function removeTeacherModalClass(index) {
  teacherModalClasses.splice(index, 1);
  renderTeacherModalClasses();
}

function renderTeacherModalClasses() {
  const container = document.getElementById('teacher-modal-classes-list');
  container.innerHTML = '';

  teacherModalClasses.forEach((c, idx) => {
    const tag = document.createElement('span');
    tag.className = 'badge badge-success';
    tag.style.cssText = 'cursor: pointer; display: inline-flex; align-items: center; gap: 0.35rem; margin-right: 0.25rem; margin-bottom: 0.25rem;';
    tag.innerHTML = `${c.department}-Y${c.year}(${c.section}) <span style="font-weight: 800; font-size: 0.7rem; color: #ff8a8a;">✖</span>`;
    tag.onclick = () => removeTeacherModalClass(idx);
    container.appendChild(tag);
  });
}

function editTeacherAccount(teacher) {
  document.getElementById('teacher-modal-title').innerText = 'Edit Teacher Account';
  document.getElementById('teacher-modal-id').value = teacher.id;
  document.getElementById('teacher-modal-name').value = teacher.name;
  document.getElementById('teacher-modal-email').value = teacher.email;
  document.getElementById('teacher-modal-password').value = teacher.password;

  teacherModalClasses = [...teacher.classes];
  renderTeacherModalClasses();

  document.getElementById('teacher-modal').classList.remove('hidden');
}

async function handleTeacherModalSubmit(event) {
  event.preventDefault();
  const id = document.getElementById('teacher-modal-id').value;
  const name = document.getElementById('teacher-modal-name').value.trim();
  const email = document.getElementById('teacher-modal-email').value.trim();
  const password = document.getElementById('teacher-modal-password').value.trim();

  try {
    const response = await fetch('/api/admin/teachers/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: id ? parseInt(id) : null,
        name,
        email,
        password,
        classes: teacherModalClasses
      })
    });

    if (response.ok) {
      closeTeacherModal();
      loadTeachersRoster();
    } else {
      const err = await response.json();
      alert(err.error || 'Failed to save teacher account');
    }
  } catch (error) {
    console.error(error);
    alert('Server communication error.');
  }
}

async function deleteTeacherAccount(teacherId) {
  if (!confirm("Are you sure you want to delete this teacher account?")) return;
  try {
    const response = await fetch(`/api/admin/teachers/${teacherId}`, { method: 'DELETE' });
    if (response.ok) {
      loadTeachersRoster();
    } else {
      alert("Failed to delete teacher account");
    }
  } catch (error) {
    console.error(error);
  }
}


// ----------------------------------------------------
// ANALYTICS & STATS OVERVIEW
// ----------------------------------------------------

async function loadAdminAnalytics() {
  try {
    const response = await fetch('/api/admin/analytics');
    const data = await response.json();

    // Overall stat badges
    document.getElementById('admin-total-teachers').innerText = data.totalTeachers;
    document.getElementById('admin-overall-pct').innerText = 
      data.overallPercentage === 'N/A' ? 'N/A' : `${data.overallPercentage}%`;

    // Department averages
    const deptList = document.getElementById('admin-dept-averages');
    deptList.innerHTML = '';
    const deptKeys = Object.keys(data.departmentPercentages);
    if (deptKeys.length === 0) {
      deptList.innerHTML = '<li style="color: var(--text-muted);">No submissions recorded</li>';
    } else {
      deptKeys.forEach(dept => {
        const li = document.createElement('li');
        li.style.display = 'flex';
        li.style.justifyContent = 'space-between';
        li.innerHTML = `<span>${dept} Dept:</span> <strong>${data.departmentPercentages[dept]}%</strong>`;
        deptList.appendChild(li);
      });
    }

    // Year averages
    const yearList = document.getElementById('admin-year-averages');
    yearList.innerHTML = '';
    const yrKeys = Object.keys(data.yearPercentages);
    if (yrKeys.length === 0) {
      yearList.innerHTML = '<li style="color: var(--text-muted);">No submissions recorded</li>';
    } else {
      yrKeys.forEach(yr => {
        const li = document.createElement('li');
        li.style.display = 'flex';
        li.style.justifyContent = 'space-between';
        li.innerHTML = `<span>Year ${yr}:</span> <strong>${data.yearPercentages[yr]}%</strong>`;
        yearList.appendChild(li);
      });
    }

    // Workload list
    const wlBody = document.getElementById('admin-faculty-workload-tbody');
    wlBody.innerHTML = '';
    data.teacherClasses.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${item.name}</strong></td>
        <td>${item.classes}</td>
      `;
      wlBody.appendChild(tr);
    });

    // Demographics accordion list
    const demoContainer = document.getElementById('admin-class-student-details-container');
    demoContainer.innerHTML = '';
    
    if (data.classStudentDetails.length === 0) {
      demoContainer.innerHTML = '<div style="color: var(--text-muted);">No registered students in database.</div>';
    } else {
      data.classStudentDetails.forEach(cls => {
        const classCard = document.createElement('div');
        classCard.style.cssText = 'background: rgba(0,0,0,0.1); border: 1px solid var(--border-glass); border-radius: 12px; padding: 1rem;';
        
        const listStr = cls.students.map(s => 
          `<li style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 0.25rem;">${s.name} (${s.register_number})</li>`
        ).join('') || '<li style="color: var(--text-muted); font-size: 0.9rem;">No students registered</li>';

        classCard.innerHTML = `
          <h4 style="font-size: 0.95rem; color: var(--secondary); margin-bottom: 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 0.25rem;">
            ${cls.className} (${cls.students.length} students)
          </h4>
          <ul style="list-style: decimal; padding-left: 1.25rem;">
            ${listStr}
          </ul>
        `;
        demoContainer.appendChild(classCard);
      });
    }

  } catch (error) {
    console.error(error);
    alert("Failed to load overall dashboard statistics.");
  }
}

// ----------------------------------------------------
// ADMIN CREDENTIALS CHANGE
// ----------------------------------------------------

function openAdminCredsModal() {
  document.getElementById('admin-creds-form').reset();
  document.getElementById('admin-creds-modal').classList.remove('hidden');
}

function closeAdminCredsModal() {
  document.getElementById('admin-creds-modal').classList.add('hidden');
}

async function handleAdminCredsSubmit(event) {
  event.preventDefault();
  const oldEmail = document.getElementById('admin-creds-old-email').value.trim();
  const oldPassword = document.getElementById('admin-creds-old-pass').value.trim();
  const newEmail = document.getElementById('admin-creds-new-email').value.trim();
  const newPassword = document.getElementById('admin-creds-new-pass').value.trim();

  try {
    const response = await fetch('/api/admin/change-credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldEmail, oldPassword, newEmail, newPassword })
    });

    if (response.ok) {
      alert("Admin credentials updated successfully! Please log in again.");
      closeAdminCredsModal();
      logout();
    } else {
      const err = await response.json();
      alert(err.error || "Failed to update admin credentials");
    }
  } catch (error) {
    console.error(error);
    alert("Server communication error.");
  }
}

// ----------------------------------------------------
// BULK IMPORTS
// ----------------------------------------------------

async function handleStudentBulkImport(input) {
  const statusEl = document.getElementById('student-import-status');
  if (!input.files || input.files.length === 0) return;
  
  const file = input.files[0];
  const ext = file.name.split('.').pop().toLowerCase();
  const isImage = ['jpg', 'jpeg', 'png', 'webp'].includes(ext);

  const dept = document.getElementById('admin-stud-dept').value;
  const year = parseInt(document.getElementById('admin-stud-year').value);
  const section = document.getElementById('admin-stud-sec').value;

  currentStudentClass = { department: dept, year, section };
  document.getElementById('student-grid-title').innerText = `Class: ${dept} - Year ${year} (Section ${section})`;

  if (isImage) {
    statusEl.innerText = "Initializing OCR Engine...";
    try {
      if (typeof Tesseract === 'undefined') {
        statusEl.innerText = "Loading OCR library...";
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
          script.onload = resolve;
          script.onerror = () => reject(new Error("Failed to load OCR library. Please check your internet connection."));
          document.head.appendChild(script);
        });
      }

      statusEl.innerText = "Scanning image (OCR)... 0%";
      const result = await Tesseract.recognize(
        file,
        'eng',
        {
          logger: m => {
            if (m.status === 'recognizing text') {
              statusEl.innerText = `Scanning image (OCR)... ${Math.round(m.progress * 100)}%`;
            }
          }
        }
      );

      const text = result.data.text;
      const students = parseOcrStudentList(text);

      if (students.length === 0) {
        statusEl.innerText = "";
        alert("No valid student records (Name and Register Number) could be extracted from this image. Please ensure the columns are clearly visible.");
        return;
      }

      statusEl.innerText = `Successfully extracted ${students.length} students. Saving roster...`;

      const tbody = document.getElementById('student-editable-tbody');
      tbody.innerHTML = '';

      students.forEach((stud, idx) => {
        appendStudentRow({
          id: null,
          name: stud.name,
          register_number: stud.register_number,
          password: stud.register_number
        }, idx + 1);
      });

      document.getElementById('student-grid-container').classList.remove('hidden');
      await saveStudentGrid();
    } catch (error) {
      console.error(error);
      statusEl.innerText = "";
      alert(error.message || "Error running OCR on image.");
    } finally {
      input.value = '';
    }
    return;
  }

  // Original Spreadsheet Import Flow
  const formData = new FormData();
  formData.append('file', file);
  statusEl.innerText = "Parsing file...";

  try {
    const response = await fetch('/api/admin/students/import', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();
    if (response.ok) {
      statusEl.innerText = `Successfully parsed ${data.students.length} students. Saving roster...`;
      
      const tbody = document.getElementById('student-editable-tbody');
      tbody.innerHTML = '';
      
      // Populate editable student grid with register number as default password
      data.students.forEach((stud, idx) => {
        appendStudentRow({
          id: null,
          name: stud.name,
          register_number: stud.register_number,
          password: stud.register_number
        }, idx + 1);
      });

      document.getElementById('student-grid-container').classList.remove('hidden');
      
      // Automatically trigger save roster persistence
      await saveStudentGrid();
    } else {
      statusEl.innerText = '';
      alert(data.error || "Failed to parse students file");
    }
  } catch (error) {
    console.error(error);
    statusEl.innerText = '';
    alert("Error uploading file.");
  } finally {
    input.value = ''; // Reset input
  }
}

function parseOcrStudentList(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const students = [];

  let headerRowIndex = -1;
  let nameColIdx = -1;
  let regColIdx = -1;
  let snoColIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    const hasName = line.includes('name') || line.includes('student');
    const hasReg = line.includes('reg') || line.includes('roll') || line.includes('id') || line.includes('number') || line.includes('admission');
    
    if (hasName && hasReg) {
      headerRowIndex = i;
      
      let namePos = line.indexOf('name');
      if (namePos === -1) namePos = line.indexOf('student');
      
      let regPos = -1;
      const regKeywords = ['register number', 'reg number', 'reg.no', 'reg no', 'register_number', 'roll no', 'roll number', 'roll_number', 'student id', 'id', 'reg', 'roll', 'admission', 'admission number', 'admission_number', 'admission no'];
      for (const key of regKeywords) {
        const p = line.indexOf(key);
        if (p !== -1) {
          regPos = p;
          break;
        }
      }

      let snoPos = -1;
      const snoKeywords = ['s.no', 'sno', 's. no', 'sl.no', 'sl no', 'serial'];
      for (const key of snoKeywords) {
        const p = line.indexOf(key);
        if (p !== -1) {
          snoPos = p;
          break;
        }
      }

      const positions = [];
      if (namePos !== -1) positions.push({ type: 'name', pos: namePos });
      if (regPos !== -1) positions.push({ type: 'reg', pos: regPos });
      if (snoPos !== -1) positions.push({ type: 'sno', pos: snoPos });

      positions.sort((a, b) => a.pos - b.pos);

      positions.forEach((p, idx) => {
        if (p.type === 'name') nameColIdx = idx;
        if (p.type === 'reg') regColIdx = idx;
        if (p.type === 'sno') snoColIdx = idx;
      });
      break;
    }
  }

  const dataStartIdx = headerRowIndex !== -1 ? headerRowIndex + 1 : 0;

  for (let i = dataStartIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    let parts = [];
    if (line.includes('|')) {
      parts = line.split('|');
    } else if (line.includes('\t')) {
      parts = line.split('\t');
    } else if (line.includes(',')) {
      parts = line.split(',');
    } else {
      parts = line.split(/\s{2,}/);
    }
    parts = parts.map(p => p.trim()).filter(Boolean);

    let name = '';
    let reg = '';

    if (parts.length >= 2 && regColIdx !== -1 && nameColIdx !== -1) {
      if (nameColIdx < parts.length) name = parts[nameColIdx];
      if (regColIdx < parts.length) reg = parts[regColIdx];
      reg = reg.trim(); 
    }

    if (!name || !reg || reg.length < 5) {
      const words = line.split(/\s+/).filter(Boolean);
      if (words.length >= 2) {
        const regIdx = words.findIndex(w => /^[A-Z0-9_-]{5,}$/i.test(w.replace(/[^A-Za-z0-9_-]/g, '')));
        if (regIdx !== -1) {
          reg = words[regIdx].replace(/[^A-Za-z0-9_-]/g, '');
          
          const nameWords = words.filter((w, idx) => {
            if (idx === regIdx) return false;
            if (idx === 0 && /^\d+$/.test(w) && parseInt(w) < 200) return false;
            if (idx === words.length - 1 && /^\d+$/.test(w) && parseInt(w) < 200) return false;
            return true;
          });
          name = nameWords.join(' ');
        }
      }
    }

    if (name && reg && reg.length >= 5) {
      const cleanName = name.replace(/[^a-zA-Z\s\.]/g, '').trim().toUpperCase();
      if (cleanName && reg) {
        students.push({
          name: cleanName,
          register_number: reg
        });
      }
    }
  }

  return students;
}

async function handleTeacherBulkImport(input) {
  const statusEl = document.getElementById('teacher-import-status');
  if (!input.files || input.files.length === 0) return;

  const formData = new FormData();
  formData.append('file', input.files[0]);
  statusEl.innerText = "Processing teacher accounts creation...";

  try {
    const response = await fetch('/api/admin/teachers/import', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();
    if (response.ok) {
      statusEl.innerText = data.message;
      alert(data.message);
      loadTeachersRoster(); // Reload roster list
    } else {
      statusEl.innerText = '';
      alert(data.error || "Failed to parse teachers file");
    }
  } catch (error) {
    console.error(error);
    statusEl.innerText = '';
    alert("Error uploading file.");
  } finally {
    input.value = ''; // Reset input
  }
}

async function checkUndoStatus() {
  try {
    const response = await fetch('/api/admin/students/undo-status');
    const data = await response.json();
    const undoBtn = document.getElementById('undo-switch-year-btn');
    if (undoBtn) {
      undoBtn.disabled = !data.canUndo;
    }
  } catch (error) {
    console.error("Failed to check undo status", error);
  }
}

async function handleSwitchYear() {
  const dept = document.getElementById('admin-stud-dept').value;
  const year = parseInt(document.getElementById('admin-stud-year').value);
  const section = document.getElementById('admin-stud-sec').value;
  const activeCount = parseInt(document.getElementById('admin-stud-count').value) || 0;

  if (activeCount === 0) {
    alert("No active students found in the selected class to promote.");
    return;
  }

  // Safety confirmation
  if (year === 4) {
    if (!confirm("4th Year students will be archived and removed from active records. Continue?")) {
      return;
    }
  } else {
    if (!confirm("Are you sure you want to promote students to the next academic year?")) {
      return;
    }
  }

  try {
    const response = await fetch('/api/admin/students/switch-year', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ department: dept, year, section })
    });

    const data = await response.json();
    if (response.ok) {
      if (data.archived) {
        alert(`4th Year students successfully archived and saved as: ${data.archiveFile}`);
      } else {
        alert("Students promoted successfully to the next year!");
      }
      await checkUndoStatus();
      await loadOrGenerateStudentGrid();
    } else {
      alert(data.error || "Failed to perform year switch.");
    }
  } catch (error) {
    console.error(error);
    alert("Server communication error.");
  }
}

async function handleUndoSwitchYear() {
  if (!confirm("Are you sure you want to undo the most recent year-switch operation?")) {
    return;
  }

  try {
    const response = await fetch('/api/admin/students/undo-switch-year', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (response.ok) {
      alert("Year-switch operation undone successfully!");
      await checkUndoStatus();
      await loadOrGenerateStudentGrid();
    } else {
      const data = await response.json();
      alert(data.error || "Failed to undo year-switch.");
    }
  } catch (error) {
    console.error(error);
    alert("Server communication error.");
  }
}
