const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'assessment.db');
const db = new sqlite3.Database(dbPath);

// Promise wrappers for sqlite3
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function initialize() {
  // Enable foreign keys
  await run("PRAGMA foreign_keys = ON;");

  // Create tables
  await run(`CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS teacher_classes (
    teacher_id INTEGER,
    department TEXT NOT NULL,
    year INTEGER NOT NULL,
    section TEXT NOT NULL,
    PRIMARY KEY (teacher_id, department, year, section),
    FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
  )`);

  await run(`CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    register_number TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    department TEXT NOT NULL,
    year INTEGER NOT NULL,
    section TEXT NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    duration INTEGER NOT NULL, -- in minutes
    department TEXT NOT NULL,
    year INTEGER NOT NULL,
    section TEXT NOT NULL,
    teacher_id INTEGER,
    FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE SET NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    test_id INTEGER NOT NULL,
    question_text TEXT NOT NULL,
    option_a TEXT NOT NULL,
    option_b TEXT NOT NULL,
    option_c TEXT NOT NULL,
    option_d TEXT NOT NULL,
    correct_option TEXT NOT NULL, -- 'A', 'B', 'C', 'D'
    FOREIGN KEY(test_id) REFERENCES tests(id) ON DELETE CASCADE
  )`);

  await run(`CREATE TABLE IF NOT EXISTS student_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    test_id INTEGER NOT NULL,
    score INTEGER NOT NULL,
    status TEXT NOT NULL, -- 'Attended', 'ABS'
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
    FOREIGN KEY(test_id) REFERENCES tests(id) ON DELETE CASCADE,
    UNIQUE(student_id, test_id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS student_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    test_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    chosen_option TEXT NOT NULL,
    FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
    FOREIGN KEY(test_id) REFERENCES tests(id) ON DELETE CASCADE,
    FOREIGN KEY(question_id) REFERENCES questions(id) ON DELETE CASCADE,
    UNIQUE(student_id, test_id, question_id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS cheating_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    student_name TEXT NOT NULL,
    register_number TEXT NOT NULL,
    department TEXT NOT NULL,
    year INTEGER NOT NULL,
    section TEXT NOT NULL,
    test_id INTEGER NOT NULL,
    test_name TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
    FOREIGN KEY(test_id) REFERENCES tests(id) ON DELETE CASCADE
  )`);

  // Auto-seed data if empty
  const adminCount = await get("SELECT COUNT(*) as count FROM admins");
  if (adminCount.count === 0) {
    // Seed admin
    await run("INSERT INTO admins (username,email, password) VALUES (?,?, ?)", ['admin', 'admin@gmail.com' 'admin123']);

    // Seed teachers
    const teacherId = (await run("INSERT INTO teachers (name, email, password) VALUES (?, ?, ?)",
      ['Dr. Sarah Connor', 'teacher@school.com', 'teacher123'])).id;

    // Assign classes to teacher
    await run("INSERT INTO teacher_classes (teacher_id, department, year, section) VALUES (?, ?, ?, ?)", [teacherId, 'CSE', 3, 'A']);
    await run("INSERT INTO teacher_classes (teacher_id, department, year, section) VALUES (?, ?, ?, ?)", [teacherId, 'CSE', 4, 'B']);

    // Seed students
    await run("INSERT INTO students (name, register_number, password, department, year, section) VALUES (?, ?, ?, ?, ?, ?)",
      ['John Doe', 'REG001', 'student123', 'CSE', 3, 'A']);
    await run("INSERT INTO students (name, register_number, password, department, year, section) VALUES (?, ?, ?, ?, ?, ?)",
      ['Jane Smith', 'REG002', 'student123', 'CSE', 3, 'A']);
    await run("INSERT INTO students (name, register_number, password, department, year, section) VALUES (?, ?, ?, ?, ?, ?)",
      ['Bob Johnson', 'REG003', 'student123', 'CSE', 4, 'B']);

    console.log("Database initialized and successfully seeded with default credentials!");
  } else {
    console.log("Database initialized. Existing records found, skipping seed.");
  }

  // Ensure all existing students have password equal to register_number
  await run("UPDATE students SET password = register_number;");
}

module.exports = {
  db,
  run,
  get,
  all,
  initialize
};
