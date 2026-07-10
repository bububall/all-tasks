// ============================================================
// งานของพวกลาบ — app logic
// (login, Firebase realtime sync, CRUD, filters, modals, toasts)
// ============================================================

// ===== THEME TOGGLE (dark-first) =====
let isDark = localStorage.getItem('theme') !== 'light';
function applyTheme() {
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  document.getElementById('theme-toggle-btn').textContent = isDark ? '☀️' : '🌙';
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
}
function toggleTheme() { isDark = !isDark; applyTheme(); }
applyTheme();

const ADMIN_PASS = 'Watcharakorn';
const TEACHER_PASS = 'KRUNIZ1';
const SESSION_MAX_AGE_MS = 48 * 60 * 60 * 1000; // เซสชันหมดอายุใน 48 ชม.

// ===== LOGIN SCREEN: ประกายลอยเบาๆ หลังการ์ดกระจก =====
(function spawnLoginSparkles() {
  const wrap = document.getElementById('login-sparkles');
  if (!wrap) return;
  const count = 22;
  for (let i = 0; i < count; i++) {
    const s = document.createElement('div');
    s.className = 'login-spark';
    const size = 1.5 + Math.random() * 2.5;
    s.style.width = size + 'px';
    s.style.height = size + 'px';
    s.style.left = Math.random() * 100 + '%';
    s.style.setProperty('--dx', (Math.random() * 60 - 30) + 'px');
    s.style.setProperty('--o', (0.25 + Math.random() * 0.4).toFixed(2));
    s.style.animationDuration = (10 + Math.random() * 14) + 's';
    s.style.animationDelay = (Math.random() * -20) + 's';
    wrap.appendChild(s);
  }
})();

// ขนาดรูปสูงสุด (px) และคุณภาพ JPEG ตอนบีบอัดรูป ก่อนเก็บเป็น base64 ขึ้น Firebase
const STUDENT_PHOTO_MAX_DIM = 320;
const STUDENT_PHOTO_QUALITY = 0.82;
const EVIDENCE_PHOTO_MAX_DIM = 900;
const EVIDENCE_PHOTO_QUALITY = 0.72;

let state = {
  subjects: ['คณิตศาสตร์', 'ภาษาไทย', 'วิทยาศาสตร์', 'ภาษาอังกฤษ', 'สังคมศึกษา'],
  assignments: [
    { id: 1, subject: 'คณิตศาสตร์', type: 'hw', title: 'แบบฝึกหัดหน้า 45–50', desc: 'ทำทุกข้อ', due: '2026-06-20' },
    { id: 2, subject: 'ภาษาอังกฤษ', type: 'class', title: 'Reading Comprehension Unit 3', desc: '', due: '2026-06-18' },
    { id: 3, subject: 'วิทยาศาสตร์', type: 'deadline', title: 'รายงานการทดลอง', desc: 'สรุปผลการทดลองเรื่องแรงและการเคลื่อนที่', due: '2026-06-25' },
  ],
  students: [],
  submissions: []
};

let isAdmin = false;
let isTeacher = false;
let currentTeacherName = null;   // ชื่ออาจารย์ที่ login เข้ามา
let currentStudent = null;       // { id, name, photo } ของคนที่ login เข้ามา (ถ้าไม่ใช่แอดมิน/อาจารย์)
let adminLoginContext = 'toggle'; // 'login' = กดเข้าแอดมินจากหน้า login, 'toggle' = สลับโหมดตอนอยู่ในแอปแล้ว
let teacherLoginContext = 'toggle';
let activeTab = 'all';
let activeType = 'all';
let mainView = 'assignments'; // 'assignments' | 'leaderboard' | 'roster'
let editingId = null;
let deletingId = null;
let pendingSubmitId = null;
let selectedLocation = null;
let submitPhotoDataUrl = null;   // รูปหลักฐานที่เลือกไว้ในหน้าต่างส่งงาน (ยังไม่บันทึก)
let newStudentPhotoDataUrl = null; // รูปนักเรียนที่เลือกไว้ตอนเพิ่มนักเรียนใหม่ (ยังไม่บันทึก)
let pendingPhotoStudentIdx = null; // index ของนักเรียนที่กำลังจะเปลี่ยนรูป (ใช้กับ input file ที่ซ่อนไว้)

// แสดงข้อความแจ้งเตือนเล็กๆ มุมจอ (toast)
function showToast(msg, type) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = 'toast ' + (type || 'success');
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ป้องกันการแทรก HTML จากข้อความที่นักเรียนพิมพ์เอง (คำอธิบายหลักฐาน ฯลฯ)
function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

// อ่านไฟล์รูปภาพแล้วบีบอัด/ย่อขนาดก่อนแปลงเป็น base64 (data URL) เพื่อไม่ให้ก้อนข้อมูลใหญ่เกินไปตอนขึ้น Firebase
function readAndCompressImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    if (!file) { resolve(null); return; }
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
          else { w = Math.round(w * maxDim / h); h = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('โหลดรูปภาพไม่สำเร็จ'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
    reader.readAsDataURL(file);
  });
}

// บันทึก state ขึ้น Firebase ทุกครั้งที่มีการเปลี่ยนแปลง
function saveState() {
  window._fb.set(window._fb.stateRef, state)
    .then(() => showToast('บันทึกขึ้น cloud สำเร็จ ✓', 'success'))
    .catch(err => {
      showToast('บันทึกไม่สำเร็จ: ' + err.message, 'error');
    });
}

// เริ่มฟัง Firebase แบบ real-time: ใครเปลี่ยนข้อมูล ทุกคนที่เปิดหน้านี้จะเห็นทันที
// ทำงานตั้งแต่หน้า login เลย เพื่อให้รายชื่อนักเรียนพร้อมใช้ตรวจสอบรหัสผ่าน
let firebaseSyncStarted = false;
let firstSyncDone = false;

function startFirebaseSync() {
  if (firebaseSyncStarted) return;
  if (!window._fb) { setTimeout(startFirebaseSync, 100); return; }
  firebaseSyncStarted = true;

  window._fb.onValue(window._fb.stateRef, snapshot => {
    const data = snapshot.val();
    if (data && typeof data === 'object') {
      // ป้องกัน error กรณี array ว่างถูกบันทึกแล้ว Firebase ตัด key นั้นทิ้ง
      state = {
        subjects: Array.isArray(data.subjects) ? data.subjects : [],
        assignments: Array.isArray(data.assignments) ? data.assignments : [],
        students: Array.isArray(data.students) ? data.students : [],
        submissions: Array.isArray(data.submissions) ? data.submissions : []
      };
    } else {
      // ยังไม่มีข้อมูลบน cloud -> อัปโหลดข้อมูลตั้งต้นขึ้นไปครั้งแรก
      window._fb.set(window._fb.stateRef, state);
    }

    if (!firstSyncDone) {
      firstSyncDone = true;
      const btn = document.getElementById('login-btn');
      if (btn) { btn.disabled = false; btn.textContent = 'เข้าสู่ระบบ'; }

      // คืน session อัตโนมัติหลังโหลดข้อมูลจาก Firebase (ถ้ายังไม่หมดอายุ 48 ชม.)
      const saved = localStorage.getItem('session');
      if (saved) {
        try {
          const sess = JSON.parse(saved);
          if (isSessionExpired(sess)) {
            localStorage.removeItem('session');
          } else if (sess.type === 'admin') {
            isAdmin = true;
            isTeacher = false;
            currentStudent = null;
            enterApp(true);
          } else if (sess.type === 'teacher') {
            isTeacher = true;
            isAdmin = false;
            currentStudent = null;
            currentTeacherName = sess.teacherName || null;
            enterApp(true);
          } else if (sess.type === 'student' && sess.student) {
            // ตรวจสอบว่ายังมีนักเรียนคนนี้ในระบบอยู่
            const found = state.students.find(s => s.id === sess.student.id && normalizeName(s.name) === normalizeName(sess.student.name));
            if (found) {
              isAdmin = false;
              currentStudent = found;
              enterApp(true);
            } else {
              localStorage.removeItem('session');
            }
          }
        } catch(e) { localStorage.removeItem('session'); }
      }
    }

    renderTabs();
    renderAssignments();
    if (mainView !== 'assignments') renderPeopleGrid();
    if (document.getElementById('subject-modal').classList.contains('open')) renderSubjectChips();
    if (document.getElementById('student-modal').classList.contains('open')) renderStudentChips();
  });

  // แสดงสถานะออนไลน์/ออฟไลน์
  window._fb.onValue(window._fb.connectedRef, snap => {
    const badge = document.getElementById('sync-badge');
    if (snap.val() === true) {
      badge.textContent = '🟢 ออนไลน์ • ซิงค์ cloud';
      badge.style.color = 'var(--green)';
    } else {
      badge.textContent = '🔴 ออฟไลน์ • รอเชื่อมต่อ';
      badge.style.color = 'var(--red)';
    }
  });
}
window._fbStartSync = startFirebaseSync;
startFirebaseSync();

// ===== LOGIN (นักเรียน: ชื่อ + เลขประจำตัว) =====
function normalizeName(s) { return (s || '').replace(/\s+/g, ' ').trim(); }

// เซสชันหมดอายุถ้าล็อกอินเกิน 48 ชม. (ไม่มี loginTime = เซสชันเก่าก่อนมีระบบนี้ ให้ถือว่าหมดอายุ ต้องล็อกอินใหม่)
function isSessionExpired(sess) {
  if (!sess || typeof sess.loginTime !== 'number') return true;
  return (Date.now() - sess.loginTime) > SESSION_MAX_AGE_MS;
}

// เช็คเป็นระยะระหว่างใช้งานแอปอยู่ ถ้าเซสชันเกิน 48 ชม. ให้บังคับออกจากระบบทันที
let sessionWatcherStarted = false;
function startSessionWatcher() {
  if (sessionWatcherStarted) return;
  sessionWatcherStarted = true;
  setInterval(() => {
    const saved = localStorage.getItem('session');
    if (!saved) return;
    try {
      const sess = JSON.parse(saved);
      if (isSessionExpired(sess)) {
        showToast('เซสชันหมดอายุ (เกิน 48 ชม.) กรุณาเข้าสู่ระบบใหม่', 'error');
        logout();
      }
    } catch (e) { /* ignore */ }
  }, 60 * 1000); // เช็คทุก 1 นาที
}

function doLogin() {
  const name = document.getElementById('login-name').value;
  const id = document.getElementById('login-id').value.trim();
  const errEl = document.getElementById('login-error');

  if (!normalizeName(name) || !id) {
    errEl.textContent = 'กรอกชื่อและเลขประจำตัวให้ครบ';
    errEl.style.display = 'block';
    return;
  }

  const student = state.students.find(s => s.id === id && normalizeName(s.name) === normalizeName(name));
  if (student) {
    currentStudent = student;
    isAdmin = false;
    errEl.style.display = 'none';
    enterApp();
  } else {
    errEl.textContent = 'ไม่พบชื่อหรือเลขประจำตัวนี้ในระบบ ลองใหม่อีกครั้ง';
    errEl.style.display = 'block';
    document.getElementById('login-id').value = '';
  }
}

['login-name', 'login-id'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
});

function enterApp(isRestoring) {
  // บันทึก session ลง localStorage พร้อมเวลาล็อกอิน (ใช้คำนวณวันหมดอายุ 48 ชม.)
  // ตอนคืน session เดิม (isRestoring) ไม่เขียนทับ loginTime เดิม จะได้หมดอายุตามเวลาล็อกอินจริง
  if (!isRestoring) {
    const loginTime = Date.now();
    if (isAdmin) {
      localStorage.setItem('session', JSON.stringify({ type: 'admin', loginTime }));
    } else if (isTeacher) {
      localStorage.setItem('session', JSON.stringify({ type: 'teacher', teacherName: currentTeacherName, loginTime }));
    } else if (currentStudent) {
      localStorage.setItem('session', JSON.stringify({ type: 'student', student: currentStudent, loginTime }));
    }
  }
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  initApp();
  startSessionWatcher();
}

function logout() {
  isAdmin = false;
  isTeacher = false;
  currentTeacherName = null;
  currentStudent = null;
  localStorage.removeItem('session');
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-name').value = '';
  document.getElementById('login-id').value = '';
  document.getElementById('login-error').style.display = 'none';
  updateAdminUI();
}

// ===== ADMIN =====
function openAdminLoginFromMain() {
  adminLoginContext = 'login';
  document.getElementById('admin-pw-input').value = '';
  document.getElementById('admin-error').style.display = 'none';
  openModal('admin-modal');
  setTimeout(() => document.getElementById('admin-pw-input').focus(), 100);
}

function toggleAdminMode() {
  if (isAdmin) {
    isAdmin = false;
    updateAdminUI();
  } else {
    adminLoginContext = 'toggle';
    document.getElementById('admin-pw-input').value = '';
    document.getElementById('admin-error').style.display = 'none';
    openModal('admin-modal');
    setTimeout(() => document.getElementById('admin-pw-input').focus(), 100);
  }
}

function doAdminLogin() {
  const pw = document.getElementById('admin-pw-input').value;
  if (pw === ADMIN_PASS) {
    isAdmin = true;
    isTeacher = false;
    closeModal('admin-modal');
    if (adminLoginContext === 'login') {
      currentStudent = null;
      enterApp();
    } else {
      updateAdminUI();
    }
  } else {
    document.getElementById('admin-error').style.display = 'block';
    document.getElementById('admin-pw-input').value = '';
  }
}

// ===== TEACHER (อาจารย์) =====
function openTeacherLoginFromMain() {
  teacherLoginContext = 'login';
  document.getElementById('teacher-name-input').value = '';
  document.getElementById('teacher-pw-input').value = '';
  document.getElementById('teacher-error').style.display = 'none';
  openModal('teacher-modal');
  setTimeout(() => document.getElementById('teacher-name-input').focus(), 100);
}

function toggleTeacherMode() {
  if (isTeacher) {
    isTeacher = false;
    currentTeacherName = null;
    updateAdminUI();
  } else {
    teacherLoginContext = 'toggle';
    document.getElementById('teacher-name-input').value = '';
    document.getElementById('teacher-pw-input').value = '';
    document.getElementById('teacher-error').style.display = 'none';
    openModal('teacher-modal');
    setTimeout(() => document.getElementById('teacher-name-input').focus(), 100);
  }
}

function doTeacherLogin() {
  const name = normalizeName(document.getElementById('teacher-name-input').value);
  const pw = document.getElementById('teacher-pw-input').value;
  const errEl = document.getElementById('teacher-error');

  if (!name) {
    errEl.textContent = 'กรอกชื่ออาจารย์ด้วย';
    errEl.style.display = 'block';
    return;
  }

  if (pw === TEACHER_PASS) {
    isTeacher = true;
    isAdmin = false;
    currentTeacherName = name;
    closeModal('teacher-modal');
    if (teacherLoginContext === 'login') {
      currentStudent = null;
      enterApp();
    } else {
      updateAdminUI();
    }
  } else {
    errEl.textContent = 'รหัสไม่ถูกต้อง';
    errEl.style.display = 'block';
    document.getElementById('teacher-pw-input').value = '';
  }
}

function updateAdminUI() {
  document.getElementById('admin-badge').style.display = isAdmin ? 'inline-flex' : 'none';
  document.getElementById('teacher-badge').style.display = isTeacher ? 'inline-flex' : 'none';
  document.getElementById('admin-toggle-btn').textContent = isAdmin ? 'ออกจากแอดมิน' : 'เข้าโหมดแอดมินอย่าเสือก';
  document.getElementById('teacher-toggle-btn').textContent = isTeacher ? 'ออกจากโหมดอาจารย์' : 'โหมดอาจารย์';
  document.getElementById('admin-toolbar').style.display = (isAdmin || isTeacher) ? 'flex' : 'none';
  // เฉพาะแอดมินเท่านั้นที่จัดการงาน/วิชาได้ อาจารย์ดูข้อมูลนักเรียน + เพิ่มรูปได้อย่างเดียว
  document.getElementById('btn-add-assignment').style.display = isAdmin ? 'inline-flex' : 'none';
  document.getElementById('btn-manage-subjects').style.display = isAdmin ? 'inline-flex' : 'none';
  renderMainViewSwitch();
  if (mainView !== 'assignments') renderPeopleGrid();
  renderAssignments();
}

// INIT
function initApp() {
  setGreeting();
  renderTabs();
  renderAssignments();
  renderMainViewSwitch();
  renderMainView();
  updateAdminUI();
  startFirebaseSync();
}

function setGreeting() {
  const now = new Date();
  const h = now.getHours();
  const greet = h < 12 ? 'มอนิ่งไอ่พวกขี้เกียจ' : h < 17 ? 'บายละไมไม่เข้าเรียน' : 'เย็นละกลับบ่นได้ละอย่าแอบเที่ยว';
  const who = currentStudent ? ' ' + currentStudent.name : (isAdmin ? ' แอดมิน' : (isTeacher ? ' อาจารย์' + (currentTeacherName ? ' ' + currentTeacherName : '') : ''));
  document.getElementById('greeting').textContent = greet + who;
  const days = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
  const months = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  document.getElementById('date-display').textContent = `วัน${days[now.getDay()]}ที่ ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear() + 543}`;
}

// TYPE FILTER
function setTypeFilter(type) {
  activeType = type;
  ['all','hw','class','deadline'].forEach(t => {
    const btn = document.getElementById('tf-' + t);
    btn.className = 'type-btn' + (t === type ? ' active-' + t : '');
  });
  renderAssignments();
}

// TABS
function renderTabs() {
  const wrap = document.getElementById('tabs-wrap');
  wrap.innerHTML = '';

  const all = document.createElement('button');
  all.className = 'tab' + (activeTab === 'all' ? ' active' : '');
  all.textContent = 'ทุกวิชา';
  all.onclick = () => { activeTab = 'all'; renderTabs(); renderAssignments(); };
  wrap.appendChild(all);

  state.subjects.forEach(s => {
    const t = document.createElement('button');
    t.className = 'tab' + (activeTab === s ? ' active' : '');
    t.textContent = s;
    t.onclick = () => { activeTab = s; renderTabs(); renderAssignments(); };
    wrap.appendChild(t);
  });
}

// ASSIGNMENTS
// สถานะตามวันกำหนดส่ง: เกินกำหนด = แดง, วันนี้ = เขียว, ยังไม่ถึงกำหนด = ฟ้า
function getStatus(dueStr) {
  const today = new Date(); today.setHours(0,0,0,0);
  const due = new Date(dueStr); due.setHours(0,0,0,0);
  const diff = Math.floor((due - today) / 86400000);
  if (diff < 0) return { label: 'เกินกำหนดแล้วไอ่โง่', cls: 'badge-red', extra: 'overdue' };
  if (diff === 0) return { label: 'ส่งวันนี้ไอ่ฟาย!', cls: 'badge-green', extra: 'today' };
  return { label: `อีก ${diff} วันนะไอ่ลาบ`, cls: 'badge-blue', extra: 'upcoming' };
}

function formatDate(dueStr) {
  const d = new Date(dueStr);
  const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  return { day: d.getDate(), month: months[d.getMonth()] };
}

function formatFullDate(dueStr) {
  const d = new Date(dueStr);
  const days = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
  const months = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  return `วัน${days[d.getDay()]}ที่ ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`;
}

const TYPE_LABEL = { hw: 'การบ้าน', class: 'งานในคาบ', deadline: 'กำหนดส่ง' };
const TYPE_TAG = { hw: 'tag-hw', class: 'tag-class', deadline: 'tag-deadline' };
const TYPE_CARD = { hw: 'card-type-hw', class: 'card-type-class', deadline: 'card-type-deadline' };

function renderAssignments() {
  const list = document.getElementById('assignments-list');
  let filtered = activeTab === 'all' ? [...state.assignments] : state.assignments.filter(a => a.subject === activeTab);
  if (activeType !== 'all') filtered = filtered.filter(a => a.type === activeType);
  filtered.sort((a, b) => new Date(a.due) - new Date(b.due));

  // Stats (always from all assignments)
  const today = new Date(); today.setHours(0,0,0,0);
  let overdue = 0, dueToday = 0;
  state.assignments.forEach(a => {
    const due = new Date(a.due); due.setHours(0,0,0,0);
    const diff = Math.floor((due - today) / 86400000);
    if (diff < 0) overdue++;
    else if (diff === 0) dueToday++;
  });
  document.getElementById('stat-overdue').textContent = overdue;
  document.getElementById('stat-today').textContent = dueToday;
  document.getElementById('stat-total').textContent = state.assignments.length;

  const fourthLabel = document.getElementById('stat-fourth-label');
  const fourthValue = document.getElementById('stat-fourth-value');
  if (isAdmin || isTeacher) {
    fourthLabel.textContent = 'นักเรียนทั้งหมด';
    fourthValue.textContent = state.students.length;
  } else if (currentStudent) {
    fourthLabel.textContent = 'ส่งแล้ว';
    const mySubs = state.submissions.filter(s => s.studentId === currentStudent.id).length;
    fourthValue.textContent = `${mySubs}/${state.assignments.length}`;
  } else {
    fourthLabel.textContent = 'งานทั้งหมด';
    fourthValue.textContent = state.assignments.length;
  }

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="e-icon">—</div><h3>ไม่มีงานในหมวดนี้</h3><p>ยังไม่มีงานที่ตรงกับที่เลือก</p></div>`;
    return;
  }

  list.innerHTML = filtered.map((a, i) => {
    const st = getStatus(a.due);
    const fd = formatDate(a.due);
    const typeLabel = TYPE_LABEL[a.type] || a.type;
    const typeTagCls = TYPE_TAG[a.type] || 'tag-hw';
    const typeCardCls = TYPE_CARD[a.type] || 'card-type-hw';

    let actionsHtml = '';
    if (isAdmin) {
      actionsHtml = `
          <div class="card-actions">
            <button class="btn-icon" onclick="event.stopPropagation(); editAssignment(${a.id})">แก้ไข</button>
            <button class="btn-icon delete" onclick="event.stopPropagation(); askDelete(${a.id})">ลบ</button>
          </div>`;
    } else if (currentStudent) {
      const mine = state.submissions.find(s => s.assignmentId === a.id && s.studentId === currentStudent.id);
      actionsHtml = mine
        ? `<button class="btn-submit done" onclick="event.stopPropagation(); toggleSubmit(${a.id})">ส่งแล้ว (${escapeHtml(mine.location)})</button>`
        : `<button class="btn-submit" onclick="event.stopPropagation(); toggleSubmit(${a.id})">ส่งแล้ว</button>`;
    }

    return `
      <div class="assignment-card tilt-card ${typeCardCls} ${st.extra}" style="--i:${i}" onclick="openDetail(${a.id})">
        <div class="card-date">
          <div class="month">${fd.month}</div>
          <div class="day">${fd.day}</div>
        </div>
        <div class="card-body">
          <div class="card-top">
            <span class="card-subject">${a.subject}</span>
            <span class="type-tag ${typeTagCls}">${typeLabel}</span>
          </div>
          <div class="card-title">${a.title}</div>
          ${a.desc ? `<div class="card-desc">${a.desc}</div>` : ''}
        </div>
        <div class="card-meta">
          <span class="deadline-badge ${st.cls}">${st.label}</span>
          ${actionsHtml}
        </div>
      </div>`;
  }).join('');
}

// DETAIL MODAL
function openDetail(id) {
  const a = state.assignments.find(x => x.id === id);
  if (!a) return;
  const st = getStatus(a.due);
  const typeLabel = TYPE_LABEL[a.type] || a.type;

  document.getElementById('detail-subject').textContent = a.subject;
  const typeEl = document.getElementById('detail-type');
  typeEl.textContent = typeLabel;
  typeEl.className = 'type-tag ' + (TYPE_TAG[a.type] || 'tag-hw');
  document.getElementById('detail-title').textContent = a.title;
  document.getElementById('detail-desc').textContent = a.desc ? a.desc : 'ไม่มีรายละเอียดเพิ่มเติม';
  document.getElementById('detail-due').textContent = formatFullDate(a.due);

  const statusEl = document.getElementById('detail-status');
  statusEl.textContent = st.label;
  statusEl.className = 'deadline-badge ' + st.cls;

  const subWrap = document.getElementById('detail-submissions');
  const subLabel = document.getElementById('detail-sub-label');
  const subList = document.getElementById('submission-list');

  if (isAdmin || isTeacher) {
    subWrap.style.display = 'block';
    const subs = state.submissions.filter(s => s.assignmentId === a.id);
    subLabel.textContent = `สถานะการส่ง (${subs.length}/${state.students.length})`;
    subList.innerHTML = subs.length
      ? subs.map(s => `
          <div class="submission-item">
            <div class="sub-item-head"><span>${escapeHtml(s.studentName)}</span><span class="loc">${escapeHtml(s.location)}</span></div>
            ${s.note ? `<div class="sub-note">${escapeHtml(s.note)}</div>` : ''}
            ${s.photo ? `<img class="sub-evidence" src="${s.photo}" onclick="openImageViewer(this.src)" alt="หลักฐานการส่งงาน">` : ''}
          </div>`).join('')
      : '<div style="color:var(--muted);font-size:13px;">ยังไม่มีใครส่ง</div>';
  } else if (currentStudent) {
    subWrap.style.display = 'block';
    subLabel.textContent = 'สถานะของคุณ';
    const mine = state.submissions.find(s => s.assignmentId === a.id && s.studentId === currentStudent.id);
    subList.innerHTML = mine
      ? `<div class="submission-item">
           <div class="sub-item-head"><span>ส่งแล้ว</span><span class="loc">${escapeHtml(mine.location)}</span></div>
           ${mine.note ? `<div class="sub-note">${escapeHtml(mine.note)}</div>` : ''}
           ${mine.photo ? `<img class="sub-evidence" src="${mine.photo}" onclick="openImageViewer(this.src)" alt="หลักฐานการส่งงาน">` : ''}
         </div>`
      : '<div style="color:var(--muted);font-size:13px;">ยังไม่ได้ส่ง</div>';
  } else {
    subWrap.style.display = 'none';
  }

  openModal('detail-modal');
}

// SUBMIT (นักเรียนกดว่า "ส่งแล้ว" + เลือกแบบที่ส่ง + พิมพ์อธิบาย + แนบรูปหลักฐาน)
function openSubmitModal(id) {
  pendingSubmitId = id;
  selectedLocation = null;
  submitPhotoDataUrl = null;
  const a = state.assignments.find(x => x.id === id);
  document.getElementById('submit-assignment-title').textContent = a ? `${a.subject} • ${a.title}` : '';
  document.querySelectorAll('.location-chip').forEach(c => c.classList.remove('active'));
  document.getElementById('location-other-input').style.display = 'none';
  document.getElementById('location-other-input').value = '';
  document.getElementById('submit-note-input').value = '';
  document.getElementById('submit-photo-input').value = '';
  document.getElementById('submit-photo-preview').style.display = 'none';
  document.getElementById('submit-photo-preview').src = '';
  document.getElementById('submit-photo-label').textContent = 'เลือกรูปภาพหลักฐาน';
  validateSubmitForm();
  openModal('submit-modal');
}

function selectLocation(loc) {
  selectedLocation = loc;
  document.querySelectorAll('.location-chip').forEach(c => c.classList.toggle('active', c.dataset.loc === loc));
  const otherInput = document.getElementById('location-other-input');
  otherInput.style.display = loc === 'อื่นๆ' ? 'block' : 'none';
  if (loc === 'อื่นๆ') otherInput.focus();
  validateSubmitForm();
}

async function previewSubmitPhoto(input) {
  const file = input.files && input.files[0];
  if (!file) { submitPhotoDataUrl = null; validateSubmitForm(); return; }
  const label = document.getElementById('submit-photo-label');
  label.textContent = 'กำลังประมวลผลรูป...';
  try {
    const dataUrl = await readAndCompressImage(file, EVIDENCE_PHOTO_MAX_DIM, EVIDENCE_PHOTO_QUALITY);
    submitPhotoDataUrl = dataUrl;
    const preview = document.getElementById('submit-photo-preview');
    preview.src = dataUrl;
    preview.style.display = 'block';
    label.textContent = 'เปลี่ยนรูปภาพหลักฐาน';
  } catch (err) {
    submitPhotoDataUrl = null;
    label.textContent = 'เลือกรูปภาพหลักฐาน';
    showToast('แนบรูปไม่สำเร็จ: ' + err.message, 'error');
  }
  validateSubmitForm();
}

// ปุ่มยืนยันจะกดได้ก็ต่อเมื่อ เลือกแบบที่ส่ง + พิมพ์อธิบาย + แนบรูปหลักฐาน ครบทั้งสามอย่าง
function validateSubmitForm() {
  const note = document.getElementById('submit-note-input').value.trim();
  const ok = !!selectedLocation && !!note && !!submitPhotoDataUrl;
  document.getElementById('confirm-submit-btn').disabled = !ok;
}

document.getElementById('submit-note-input').addEventListener('input', validateSubmitForm);

function confirmSubmit() {
  const note = document.getElementById('submit-note-input').value.trim();
  if (!selectedLocation) { alert('เลือกก่อนว่าส่งงานนี้แบบไหน'); return; }
  if (!note) { alert('พิมพ์อธิบายหลักฐานการส่งงานก่อนนะ'); return; }
  if (!submitPhotoDataUrl) { alert('แนบรูปภาพหลักฐานการส่งงานก่อนนะ'); return; }
  if (!currentStudent) { alert('ไม่พบข้อมูลผู้ใช้ กรุณาเข้าสู่ระบบใหม่'); return; }

  let loc = selectedLocation;
  if (loc === 'อื่นๆ') {
    const custom = document.getElementById('location-other-input').value.trim();
    if (custom) loc = custom;
  }

  state.submissions = state.submissions.filter(s => !(s.assignmentId === pendingSubmitId && s.studentId === currentStudent.id));
  state.submissions.push({
    assignmentId: pendingSubmitId,
    studentId: currentStudent.id,
    studentName: currentStudent.name,
    location: loc,
    note: note,
    photo: submitPhotoDataUrl,
    doneAt: new Date().toISOString()
  });

  saveState();
  closeModal('submit-modal');
  renderAssignments();
  showToast('ส่งงานเรียบร้อยแล้ว', 'success');
}

function toggleSubmit(id) {
  if (!currentStudent) return;
  const existing = state.submissions.find(s => s.assignmentId === id && s.studentId === currentStudent.id);
  if (existing) {
    state.submissions = state.submissions.filter(s => !(s.assignmentId === id && s.studentId === currentStudent.id));
    saveState();
    renderAssignments();
    showToast('ยกเลิกการส่งงานแล้ว', 'success');
  } else {
    openSubmitModal(id);
  }
}

// ADD / EDIT (admin)
function populateSubjectSelect() {
  const sel = document.getElementById('f-subject');
  sel.innerHTML = state.subjects.map(s => `<option value="${s}">${s}</option>`).join('');
}

function openAddModal() {
  editingId = null;
  document.getElementById('modal-title').textContent = 'เพิ่มงานใหม่';
  populateSubjectSelect();
  document.getElementById('f-type').value = 'hw';
  document.getElementById('f-title').value = '';
  document.getElementById('f-desc').value = '';
  document.getElementById('f-due').value = '';
  openModal('assignment-modal');
}

function editAssignment(id) {
  const a = state.assignments.find(x => x.id === id);
  if (!a) return;
  editingId = id;
  document.getElementById('modal-title').textContent = 'แก้ไขงาน';
  populateSubjectSelect();
  document.getElementById('f-subject').value = a.subject;
  document.getElementById('f-type').value = a.type || 'hw';
  document.getElementById('f-title').value = a.title;
  document.getElementById('f-desc').value = a.desc;
  document.getElementById('f-due').value = a.due;
  openModal('assignment-modal');
}

function saveAssignment() {
  const subject = document.getElementById('f-subject').value.trim();
  const type = document.getElementById('f-type').value;
  const title = document.getElementById('f-title').value.trim();
  const desc = document.getElementById('f-desc').value.trim();
  const due = document.getElementById('f-due').value;
  if (!title || !due) { alert('กรุณากรอกชื่องานและวันที่'); return; }

  if (editingId) {
    const idx = state.assignments.findIndex(x => x.id === editingId);
    if (idx !== -1) state.assignments[idx] = { id: editingId, subject, type, title, desc, due };
  } else {
    state.assignments.push({ id: Date.now(), subject, type, title, desc, due });
  }
  saveState();
  closeModal('assignment-modal');
  renderAssignments();
}

// DELETE
function askDelete(id) { deletingId = id; openModal('confirm-modal'); }
function confirmDelete() {
  state.assignments = state.assignments.filter(a => a.id !== deletingId);
  state.submissions = state.submissions.filter(s => s.assignmentId !== deletingId);
  saveState();
  closeModal('confirm-modal');
  renderAssignments();
}

// SUBJECTS
function openSubjectModal() { renderSubjectChips(); openModal('subject-modal'); }

function renderSubjectChips() {
  const wrap = document.getElementById('subject-chips');
  if (!state.subjects.length) { wrap.innerHTML = '<span style="color:var(--muted);font-size:13px;">ยังไม่มีวิชา</span>'; return; }
  wrap.innerHTML = state.subjects.map((s, i) => `
    <div class="subject-chip">${s}<button onclick="removeSubject(${i})">×</button></div>`).join('');
}

function addSubject() {
  const input = document.getElementById('new-subject-input');
  const name = input.value.trim();
  if (!name) return;
  if (state.subjects.includes(name)) { alert('มีวิชานี้อยู่แล้ว'); return; }
  state.subjects.push(name);
  saveState();
  input.value = '';
  renderSubjectChips();
  renderTabs();
}

document.getElementById('new-subject-input').addEventListener('keydown', e => { if (e.key === 'Enter') addSubject(); });

function removeSubject(idx) {
  const name = state.subjects[idx];
  if (state.assignments.some(a => a.subject === name)) {
    if (!confirm(`วิชา "${name}" มีงานอยู่ ต้องการลบวิชาและงานทั้งหมดในวิชานี้?`)) return;
    const removingIds = state.assignments.filter(a => a.subject === name).map(a => a.id);
    state.assignments = state.assignments.filter(a => a.subject !== name);
    state.submissions = state.submissions.filter(s => !removingIds.includes(s.assignmentId));
  }
  state.subjects.splice(idx, 1);
  saveState();
  renderSubjectChips();
  renderTabs();
  if (activeTab === name) activeTab = 'all';
  renderAssignments();
}

// STUDENTS (roster ที่แอดมิน/อาจารย์จัดการ — ใช้ตรวจสอบตอน login และเก็บรูปนักเรียน)
function openStudentModal() { renderStudentChips(); openModal('student-modal'); }

function initials(name) {
  const n = normalizeName(name);
  return n ? n.charAt(0).toUpperCase() : '?';
}

function renderStudentChips() {
  const wrap = document.getElementById('student-chips');
  if (!state.students.length) { wrap.innerHTML = '<span style="color:var(--muted);font-size:13px;">ยังไม่มีนักเรียน</span>'; return; }
  const canDelete = isAdmin; // เฉพาะแอดมินเท่านั้นที่ลบนักเรียนได้ อาจารย์เปลี่ยนรูปได้อย่างเดียว
  wrap.innerHTML = state.students.map((s, i) => `
    <div class="student-row">
      ${s.photo
        ? `<img class="student-avatar" src="${s.photo}" alt="${escapeHtml(s.name)}">`
        : `<div class="student-avatar-placeholder">${initials(s.name)}</div>`}
      <div class="student-row-info">
        <div class="student-row-name">${escapeHtml(s.name)}</div>
        <div class="student-row-id">${escapeHtml(s.id)}</div>
      </div>
      <div class="student-row-actions">
        <button class="btn-icon" onclick="openStudentPhotoPicker(${i})">เปลี่ยนรูป</button>
        ${canDelete ? `<button class="btn-icon delete" onclick="removeStudent(${i})">ลบ</button>` : ''}
      </div>
    </div>`).join('');
}

async function previewNewStudentPhoto(input) {
  const file = input.files && input.files[0];
  const label = document.getElementById('new-student-photo-label');
  if (!file) { newStudentPhotoDataUrl = null; label.textContent = 'เลือกรูป'; return; }
  label.textContent = 'กำลังประมวลผล...';
  try {
    newStudentPhotoDataUrl = await readAndCompressImage(file, STUDENT_PHOTO_MAX_DIM, STUDENT_PHOTO_QUALITY);
    label.textContent = 'เลือกรูปแล้ว';
  } catch (err) {
    newStudentPhotoDataUrl = null;
    label.textContent = 'เลือกรูป';
    showToast('แนบรูปไม่สำเร็จ: ' + err.message, 'error');
  }
}

function addStudent() {
  const nameInput = document.getElementById('new-student-name');
  const idInput = document.getElementById('new-student-id');
  const name = normalizeName(nameInput.value);
  const id = idInput.value.trim();
  if (!name || !id) { alert('กรอกชื่อและเลขประจำตัวให้ครบ'); return; }
  if (state.students.some(s => s.id === id)) { alert('มีเลขประจำตัวนี้อยู่แล้ว'); return; }
  state.students.push({ id, name, photo: newStudentPhotoDataUrl || null });
  saveState();
  nameInput.value = '';
  idInput.value = '';
  newStudentPhotoDataUrl = null;
  document.getElementById('new-student-photo').value = '';
  document.getElementById('new-student-photo-label').textContent = 'เลือกรูป';
  renderStudentChips();
}

document.getElementById('new-student-name').addEventListener('keydown', e => { if (e.key === 'Enter') addStudent(); });
document.getElementById('new-student-id').addEventListener('keydown', e => { if (e.key === 'Enter') addStudent(); });

// เปิดตัวเลือกไฟล์เพื่อเปลี่ยน/เพิ่มรูปของนักเรียนที่มีอยู่แล้ว (ใช้ได้ทั้งแอดมินและอาจารย์)
function openStudentPhotoPicker(idx) {
  pendingPhotoStudentIdx = idx;
  document.getElementById('student-photo-file-hidden').click();
}

async function handleStudentPhotoChosen(input) {
  const file = input.files && input.files[0];
  if (!file || pendingPhotoStudentIdx === null) { input.value = ''; return; }
  try {
    const dataUrl = await readAndCompressImage(file, STUDENT_PHOTO_MAX_DIM, STUDENT_PHOTO_QUALITY);
    if (state.students[pendingPhotoStudentIdx]) {
      state.students[pendingPhotoStudentIdx].photo = dataUrl;
      saveState();
      renderStudentChips();
      showToast('อัปเดตรูปนักเรียนแล้ว', 'success');
    }
  } catch (err) {
    showToast('แนบรูปไม่สำเร็จ: ' + err.message, 'error');
  }
  input.value = '';
  pendingPhotoStudentIdx = null;
}

function removeStudent(idx) {
  if (!isAdmin) return; // อาจารย์เปลี่ยนรูปได้อย่างเดียว ลบนักเรียนได้เฉพาะแอดมิน
  const s = state.students[idx];
  if (!confirm(`ลบนักเรียน "${s.name}" ออกจากระบบ?`)) return;
  state.submissions = state.submissions.filter(sub => sub.studentId !== s.id);
  state.students.splice(idx, 1);
  saveState();
  renderStudentChips();
  renderAssignments();
}

// IMAGE VIEWER (lightbox สำหรับรูปหลักฐาน)
function openImageViewer(src) {
  document.getElementById('image-viewer-img').src = src;
  openModal('image-viewer-modal');
}

// ===== MAIN VIEW SWITCHER (งานทั้งหมด / อันดับส่งงาน / ข้อมูลนักเรียน-รายชื่อนักเรียน) =====
// สำหรับแอดมิน/อาจารย์: หมวด "ข้อมูลนักเรียน" แสดงชื่อ + รหัสนักเรียน + รูปภาพ + จำนวนงานที่ส่ง
// สำหรับนักเรียนทั่วไป: หมวด "รายชื่อนักเรียน" แสดงชื่อ + รูปภาพ + จำนวนงานที่ส่ง (ไม่แสดงรหัสประจำตัว)
function rosterCategoryLabel() { return (isAdmin || isTeacher) ? 'ข้อมูลนักเรียน' : 'รายชื่อนักเรียน'; }

function renderMainViewSwitch() {
  const wrap = document.getElementById('main-view-switch');
  const views = [
    { id: 'assignments', label: 'งานทั้งหมด' },
    { id: 'leaderboard', label: 'อันดับคนส่งงานเยอะที่สุด' },
    { id: 'roster', label: rosterCategoryLabel() }
  ];
  wrap.innerHTML = views.map(v =>
    `<button class="view-tab${mainView === v.id ? ' active' : ''}" onclick="setMainView('${v.id}')">${v.label}</button>`
  ).join('');
}

function setMainView(view) {
  mainView = view;
  renderMainViewSwitch();
  renderMainView();
}

function renderMainView() {
  const isAssignments = mainView === 'assignments';
  document.getElementById('assignments-view').style.display = isAssignments ? 'block' : 'none';
  document.getElementById('people-view').style.display = isAssignments ? 'none' : 'block';
  if (!isAssignments) renderPeopleGrid();
}

// สร้างการ์ดของนักเรียนแต่ละคน (ใช้ร่วมกันทั้งหมวดอันดับและหมวดรายชื่อ/ข้อมูลนักเรียน)
function renderPeopleGrid() {
  const titleEl = document.getElementById('people-view-title');
  const grid = document.getElementById('people-grid');
  const showId = isAdmin || isTeacher;

  if (!state.students.length) {
    titleEl.textContent = mainView === 'leaderboard' ? 'อันดับคนส่งงานเยอะที่สุด' : rosterCategoryLabel();
    grid.innerHTML = '<div class="empty-state"><div class="e-icon">—</div><h3>ยังไม่มีนักเรียนในระบบ</h3><p>รอแอดมินหรืออาจารย์เพิ่มรายชื่อนักเรียนก่อนนะ</p></div>';
    return;
  }

  const withCounts = state.students.map(s => ({
    ...s,
    count: state.submissions.filter(sub => sub.studentId === s.id).length
  }));

  let list;
  if (mainView === 'leaderboard') {
    titleEl.textContent = 'อันดับคนส่งงานเยอะที่สุด';
    list = [...withCounts].sort((a, b) => b.count - a.count || normalizeName(a.name).localeCompare(normalizeName(b.name), 'th'));
  } else {
    titleEl.textContent = rosterCategoryLabel();
    list = [...withCounts].sort((a, b) => normalizeName(a.name).localeCompare(normalizeName(b.name), 'th'));
  }

  grid.innerHTML = list.map((s, i) => {
    const avatar = s.photo
      ? `<img class="person-avatar" src="${s.photo}" alt="${escapeHtml(s.name)}">`
      : `<div class="person-avatar-placeholder">${initials(s.name)}</div>`;
    const medals = ['🥇', '🥈', '🥉'];
    const rankHtml = mainView === 'leaderboard'
      ? `<div class="person-rank${i < 3 ? ' rank-' + (i + 1) : ''}">${i < 3 ? `<span class="rank-medal">${medals[i]}</span>` : (i + 1)}</div>`
      : '';
    return `
      <div class="person-card tilt-card">
        ${rankHtml}
        ${avatar}
        <div class="person-info">
          <div class="person-name">${escapeHtml(s.name)}</div>
          ${showId ? `<div class="person-id">รหัส ${escapeHtml(s.id)}</div>` : ''}
        </div>
        <div class="person-count">ส่งแล้ว ${s.count} ชิ้น</div>
      </div>`;
  }).join('');
}

// MODAL HELPERS
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

document.querySelectorAll('.modal-overlay').forEach(o => {
  o.addEventListener('click', e => { if (e.target === o) closeModal(o.id); });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('admin-modal').classList.contains('open')) doAdminLogin();
  if (e.key === 'Enter' && document.getElementById('teacher-modal').classList.contains('open')) doTeacherLogin();
  if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(m => closeModal(m.id));
});

// ===== 3D POINTER TILT + GLARE =====
// Works via event delegation so it keeps applying to cards that get
// re-rendered dynamically (assignment list, stats, login box).
(function initTilt() {
  const TILT_MAX = 7; // degrees
  const supportsHover = window.matchMedia('(hover: hover)').matches;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!supportsHover || reduceMotion) return;

  let activeCard = null;

  document.addEventListener('pointermove', (e) => {
    const card = e.target.closest && e.target.closest('.tilt-card');
    if (!card) {
      if (activeCard) resetCard(activeCard);
      activeCard = null;
      return;
    }
    activeCard = card;
    const rect = card.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const rx = (py - 0.5) * -TILT_MAX;
    const ry = (px - 0.5) * TILT_MAX;
    card.style.setProperty('--rx', rx.toFixed(2) + 'deg');
    card.style.setProperty('--ry', ry.toFixed(2) + 'deg');
    card.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
    card.style.setProperty('--my', (py * 100).toFixed(1) + '%');
  });

  document.addEventListener('pointerleave', (e) => {
    const card = e.target.closest && e.target.closest('.tilt-card');
    if (card) resetCard(card);
    if (card === activeCard) activeCard = null;
  }, true);

  function resetCard(card) {
    card.style.setProperty('--rx', '0deg');
    card.style.setProperty('--ry', '0deg');
  }
})();
