// ============================================================
// งานของพวกลาบ — app logic
// (login, Firebase realtime sync, CRUD, filters, modals, toasts)
// ============================================================

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
  submissions: [],
  customFields: [] // [{ id, label, private: bool }] — หมวดข้อมูลเพิ่มเติมที่แอดมินสร้าง ให้นักเรียนกรอกเอง
};

let isAdmin = false;
let isTeacher = false;
let currentTeacherName = null;   // ชื่ออาจารย์ที่ login เข้ามา
let currentStudent = null;       // { id, name, photo } ของคนที่ login เข้ามา (ถ้าไม่ใช่แอดมิน/อาจารย์)
let adminLoginContext = 'toggle'; // 'login' = กดเข้าแอดมินจากหน้า login, 'toggle' = สลับโหมดตอนอยู่ในแอปแล้ว
let teacherLoginContext = 'toggle';
let activeTab = 'all';
let activeType = 'all';
// ค้นหางาน/วิชา: กรองเพิ่มจากแท็บวิชา+ประเภทงานที่เลือกอยู่ (ไม่ใช่แทนที่)
let searchQuery = '';
function setSearchQuery(v) {
  searchQuery = v.trim().toLowerCase();
  renderAssignments();
}
let mainView = 'assignments'; // 'assignments' | 'leaderboard' | 'roster'
let editingId = null;
let deletingId = null;
let pendingSubmitId = null;
let selectedLocation = null;
let submitPhotoDataUrl = null;   // รูปหลักฐานที่เลือกไว้ในหน้าต่างส่งงาน (ยังไม่บันทึก)
let newStudentPhotoDataUrl = null; // รูปนักเรียนที่เลือกไว้ตอนเพิ่มนักเรียนใหม่ (ยังไม่บันทึก)
let pendingPhotoStudentIdx = null; // index ของนักเรียนที่กำลังจะเปลี่ยนรูป (ใช้กับ input file ที่ซ่อนไว้)
let viewingStudentId = null;     // id ของนักเรียนที่กำลังเปิดดูรายละเอียดอยู่ (person-detail-modal)
let editingStudentId = null;     // id ของนักเรียนที่กำลังแก้ไขข้อมูลส่วนตัวอยู่ (profile-edit-modal)
let profileEditPhotoDataUrl = undefined; // undefined = ไม่เปลี่ยนรูป, null/string = เปลี่ยนแล้ว

// ===== IMAGE CROPPER STATE (ล็อกอัตราส่วน 1:1) =====
let cropState = null; // { natW, natH, scale, minScale, x, y, dragging, startX, startY, startPX, startPY, callback }
const CROP_BOX_SIZE = 280;

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

// ===== IMAGE CROPPER (ล็อกอัตราส่วน 1:1) =====
// เปิดหน้าต่างปรับกรอบรูปก่อนบันทึกเสมอเวลาแนบรูปนักเรียน/รูปโปรไฟล์
// callback(dataUrl) จะถูกเรียกตอนกด "ใช้รูปนี้" (dataUrl ผ่านการบีบอัดแล้ว)
function openCropper(file, callback) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = document.getElementById('crop-img');
    img.onload = () => {
      const natW = img.naturalWidth, natH = img.naturalHeight;
      const minScale = CROP_BOX_SIZE / Math.min(natW, natH);
      cropState = {
        natW, natH, scale: minScale, minScale,
        x: (CROP_BOX_SIZE - natW * minScale) / 2,
        y: (CROP_BOX_SIZE - natH * minScale) / 2,
        callback
      };
      document.getElementById('crop-zoom').value = 100;
      applyCropTransform();
      openModal('crop-modal');
    };
    img.src = e.target.result;
  };
  reader.onerror = () => showToast('อ่านไฟล์รูปไม่สำเร็จ', 'error');
  reader.readAsDataURL(file);
}

function applyCropTransform() {
  if (!cropState) return;
  const img = document.getElementById('crop-img');
  img.style.width = (cropState.natW * cropState.scale) + 'px';
  img.style.height = (cropState.natH * cropState.scale) + 'px';
  img.style.transform = `translate(${cropState.x}px, ${cropState.y}px)`;
}

// ให้ภาพเลื่อนได้แค่ในขอบเขตที่ยังคลุมกรอบสี่เหลี่ยม 1:1 อยู่เสมอ (กันลากจนเห็นขอบขาว)
function clampCropOffset() {
  if (!cropState) return;
  const w = cropState.natW * cropState.scale;
  const h = cropState.natH * cropState.scale;
  cropState.x = Math.min(0, Math.max(CROP_BOX_SIZE - w, cropState.x));
  cropState.y = Math.min(0, Math.max(CROP_BOX_SIZE - h, cropState.y));
}

function onCropZoom(sliderVal) {
  if (!cropState) return;
  const cx = CROP_BOX_SIZE / 2, cy = CROP_BOX_SIZE / 2;
  // จุดกึ่งกลางกรอบต้องคงที่อยู่บนภาพเดิมตอนซูม (ซูมเข้าที่ศูนย์กลาง)
  const imgCx = (cx - cropState.x) / cropState.scale;
  const imgCy = (cy - cropState.y) / cropState.scale;
  cropState.scale = cropState.minScale * (sliderVal / 100);
  cropState.x = cx - imgCx * cropState.scale;
  cropState.y = cy - imgCy * cropState.scale;
  clampCropOffset();
  applyCropTransform();
}

(function initCropDrag() {
  const box = document.getElementById('crop-box');
  if (!box) return;
  let dragging = false, startX = 0, startY = 0, startImgX = 0, startImgY = 0;

  function pointerDown(e) {
    if (!cropState) return;
    dragging = true;
    const p = e.touches ? e.touches[0] : e;
    startX = p.clientX; startY = p.clientY;
    startImgX = cropState.x; startImgY = cropState.y;
  }
  function pointerMove(e) {
    if (!dragging || !cropState) return;
    const p = e.touches ? e.touches[0] : e;
    cropState.x = startImgX + (p.clientX - startX);
    cropState.y = startImgY + (p.clientY - startY);
    clampCropOffset();
    applyCropTransform();
    e.preventDefault();
  }
  function pointerUp() { dragging = false; }

  box.addEventListener('pointerdown', pointerDown);
  window.addEventListener('pointermove', pointerMove);
  window.addEventListener('pointerup', pointerUp);
})();

function cancelCrop() {
  closeModal('crop-modal');
  cropState = null;
  document.getElementById('crop-img').src = '';
}

async function confirmCrop() {
  if (!cropState) return;
  const { natW, natH, scale, x, y, callback } = cropState;
  // คำนวณพื้นที่ที่มองเห็นในกรอบ (พิกเซลจริงของภาพต้นฉบับ) แล้ววาดลง canvas สี่เหลี่ยมจัตุรัส
  const srcX = -x / scale;
  const srcY = -y / scale;
  const srcSize = CROP_BOX_SIZE / scale;
  const canvas = document.createElement('canvas');
  canvas.width = STUDENT_PHOTO_MAX_DIM;
  canvas.height = STUDENT_PHOTO_MAX_DIM;
  const ctx = canvas.getContext('2d');
  const img = document.getElementById('crop-img');
  ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, STUDENT_PHOTO_MAX_DIM, STUDENT_PHOTO_MAX_DIM);
  const dataUrl = canvas.toDataURL('image/jpeg', STUDENT_PHOTO_QUALITY);
  closeModal('crop-modal');
  cropState = null;
  document.getElementById('crop-img').src = '';
  if (callback) callback(dataUrl);
}


function saveState() {
  return window._fb.set(window._fb.stateRef, state)
    .then(() => { showToast('บันทึกขึ้น cloud สำเร็จ ✓', 'success'); return true; })
    .catch(err => {
      showToast('บันทึกไม่สำเร็จ: ' + err.message, 'error');
      return false;
    });
}

// เริ่มฟัง Firebase แบบ real-time: ใครเปลี่ยนข้อมูล ทุกคนที่เปิดหน้านี้จะเห็นทันที
// ทำงานตั้งแต่หน้า login เลย เพื่อให้รายชื่อนักเรียนพร้อมใช้ตรวจสอบรหัสผ่าน
let firebaseSyncStarted = false;
let firstSyncDone = false;
let _lastRenderedStateSig = null; // ใช้เช็คว่าข้อมูลจาก Firebase เปลี่ยนจริงไหมก่อน re-render ทั้งหน้า

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
        submissions: Array.isArray(data.submissions) ? data.submissions : [],
        customFields: Array.isArray(data.customFields) ? data.customFields : []
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

    // ข้ามการ re-render ทั้งหน้าถ้าข้อมูลจริงๆ ไม่ได้เปลี่ยนเลย (เช่น echo ของการบันทึกของตัวเอง
    // หรือของเพื่อนคนอื่นในห้องที่ไม่เกี่ยวกับเรา) — ไม่งั้นทุกครั้งที่มีใครกดบันทึกอะไรก็ตามในระบบ
    // จะทำให้ทุกคนที่เปิดเว็บอยู่โดนสร้างการ์ดทั้งหมดใหม่พร้อมเล่นแอนิเมชันซ้ำ รู้สึกกระตุกทั้งที่ข้อมูลเหมือนเดิม
    const sig = JSON.stringify(state);
    if (sig === _lastRenderedStateSig) return;
    _lastRenderedStateSig = sig;

    renderTabs();
    renderAssignments();
    if (mainView !== 'assignments') renderPeopleGrid();
    if (document.getElementById('subject-modal').classList.contains('open')) renderSubjectChips();
    if (document.getElementById('student-modal').classList.contains('open')) renderStudentChips();
    if (document.getElementById('customfield-modal').classList.contains('open')) renderCustomFieldChips();
    if (document.getElementById('person-detail-modal').classList.contains('open') && viewingStudentId != null) renderPersonDetail(viewingStudentId);
  });

  // แสดงสถานะออนไลน์/ออฟไลน์
  window._fb.onValue(window._fb.connectedRef, snap => {
    const badge = document.getElementById('sync-badge');
    if (snap.val() === true) {
      badge.textContent = 'ออนไลน์ • ซิงค์ cloud';
      badge.style.color = 'var(--green)';
    } else {
      badge.textContent = 'ออฟไลน์ • รอเชื่อมต่อ';
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
  viewingStudentId = null;
  editingStudentId = null;
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
  document.getElementById('admin-toggle-btn').textContent = isAdmin ? 'ออกจากแอดมิน' : 'โหมดแอดมิน';
  document.getElementById('teacher-toggle-btn').textContent = isTeacher ? 'ออกจากโหมดอาจารย์' : 'โหมดอาจารย์';
  document.getElementById('admin-toolbar').style.display = (isAdmin || isTeacher) ? 'flex' : 'none';
  // แอดมินและอาจารย์จัดการงาน/วิชา/หมวดข้อมูลเพิ่มเติมได้เหมือนกันทุกอย่าง
  document.getElementById('btn-add-assignment').style.display = (isAdmin || isTeacher) ? 'inline-flex' : 'none';
  document.getElementById('btn-manage-subjects').style.display = (isAdmin || isTeacher) ? 'inline-flex' : 'none';
  document.getElementById('btn-manage-customfields').style.display = (isAdmin || isTeacher) ? 'inline-flex' : 'none';
  // ปุ่ม "แก้ไขข้อมูลของฉัน" แสดงเฉพาะนักเรียนที่ login เข้ามาเอง (ไม่ใช่แอดมิน/อาจารย์)
  document.getElementById('self-edit-btn').style.display = (!isAdmin && !isTeacher && currentStudent) ? 'inline-flex' : 'none';
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
// สำคัญ: ห้ามทุบ (innerHTML='') แล้วสร้างปุ่มใหม่ทั้งหมดทุกครั้งที่คลิก เพราะ .tab มี
// animation entrance (tabPop) ผูกกับตอน DOM element ถูกสร้าง/แทรกใหม่ — ถ้าสร้างใหม่หมดทุกครั้ง
// ปุ่มทุกปุ่มจะเล่นแอนิเมชัน "เด้ง" พร้อมกันหมดทั้งที่กดแค่ปุ่มเดียว (ต้นเหตุของบั๊ก + อาการกระตุก)
// วิธีแก้ที่ต้นเหตุ: สร้างปุ่มใหม่เฉพาะตอนรายชื่อวิชาเปลี่ยนจริงๆ (เพิ่ม/ลบ/เปลี่ยนชื่อวิชา)
// ส่วนการสลับแท็บปกติแค่ toggle class .active บนปุ่มเดิมที่มีอยู่แล้ว ไม่แตะ DOM เลย
function renderTabs() {
  const wrap = document.getElementById('tabs-wrap');
  const tabIds = ['all', ...state.subjects];
  const existing = Array.from(wrap.children);
  const sameStructure = existing.length === tabIds.length &&
    existing.every((btn, i) => btn.dataset.tabId === tabIds[i]);

  if (sameStructure) {
    existing.forEach(btn => btn.classList.toggle('active', btn.dataset.tabId === activeTab));
    return;
  }

  wrap.innerHTML = '';
  tabIds.forEach(id => {
    const t = document.createElement('button');
    t.className = 'tab' + (activeTab === id ? ' active' : '');
    t.textContent = id === 'all' ? 'ทุกวิชา' : id;
    t.dataset.tabId = id;
    t.onclick = () => { activeTab = id; renderTabs(); renderAssignments(); };
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

// ใช้เป็น caption ใต้รูปหลักฐานตอนเปิดดูรูปเต็มจอ (วันที่ + เวลาที่ส่งจริง)
function formatFullDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${formatFullDate(iso)} เวลา ${hh}:${mm} น.`;
}

const TYPE_LABEL = { hw: 'การบ้าน', class: 'งานในคาบ', deadline: 'กำหนดส่ง' };
const TYPE_TAG = { hw: 'tag-hw', class: 'tag-class', deadline: 'tag-deadline' };
const TYPE_CARD = { hw: 'card-type-hw', class: 'card-type-class', deadline: 'card-type-deadline' };

// การ์ดงาน (.assignment-card) มี animation entrance (cardIn) ที่ตั้งใจให้เล่นตอนโหลดหน้าครั้งแรกเท่านั้น
// แต่เพราะ list ทั้งก้อนถูกสร้างใหม่ทุกครั้งที่สลับแท็บวิชา/ประเภทงาน (ข้อมูลเปลี่ยนจริง เลยรีบิลด์ไม่ได้)
// การ์ดทุกใบเลยเล่นแอนิเมชันเด้งเข้าใหม่พร้อมกันหมดทุกครั้งที่กรอง — ตัวแปรนี้ใช้ปิดแอนิเมชันหลังโหลดครั้งแรก
let assignmentsFirstPaintDone = false;

function renderAssignments() {
  const list = document.getElementById('assignments-list');
  let filtered = activeTab === 'all' ? [...state.assignments] : state.assignments.filter(a => a.subject === activeTab);
  if (activeType !== 'all') filtered = filtered.filter(a => a.type === activeType);
  if (searchQuery) {
    filtered = filtered.filter(a =>
      (a.title || '').toLowerCase().includes(searchQuery) ||
      (a.subject || '').toLowerCase().includes(searchQuery) ||
      (a.desc || '').toLowerCase().includes(searchQuery)
    );
  }
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
    assignmentsFirstPaintDone = true;
    return;
  }

  list.innerHTML = filtered.map((a, i) => {
    const st = getStatus(a.due);
    const fd = formatDate(a.due);
    const typeLabel = TYPE_LABEL[a.type] || a.type;
    const typeTagCls = TYPE_TAG[a.type] || 'tag-hw';
    const typeCardCls = TYPE_CARD[a.type] || 'card-type-hw';

    let actionsHtml = '';
    if (isAdmin || isTeacher) {
      actionsHtml = `
          <div class="card-actions">
            <button class="btn-icon" onclick="event.stopPropagation(); editAssignment(${a.id})">แก้ไข</button>
            <button class="btn-icon delete" onclick="event.stopPropagation(); askDelete(${a.id})">ลบ</button>
          </div>`;
    } else if (currentStudent) {
      const mine = state.submissions.find(s => s.assignmentId === a.id && s.studentId === currentStudent.id);
      actionsHtml = mine
        ? `<button class="btn-submit done" onclick="event.stopPropagation(); toggleSubmit(${a.id})">ส่งแล้ว (${escapeHtml(mine.location)})</button>`
        : `<button class="btn-submit" onclick="event.stopPropagation(); toggleSubmit(${a.id})">ส่งงาน</button>`;
    }

    return `
      <div class="assignment-card tilt-card ${typeCardCls} ${st.extra}${assignmentsFirstPaintDone ? ' no-anim' : ''}" style="--i:${i}" onclick="openDetail(${a.id})">
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
  assignmentsFirstPaintDone = true;
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
            ${s.photo ? `<img class="sub-evidence" src="${s.photo}" data-title="${escapeHtml(a.title)}" data-location="${escapeHtml(s.location || '')}" data-date="${escapeHtml(formatDateOnly(s.doneAt))}" data-time="${escapeHtml(formatTimeOnly(s.doneAt))}" onclick="openImageViewer(this.src, {title:this.dataset.title, location:this.dataset.location, date:this.dataset.date, time:this.dataset.time})" alt="หลักฐานการส่งงาน">` : ''}
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
           ${mine.photo ? `<img class="sub-evidence" src="${mine.photo}" data-title="${escapeHtml(a.title)}" data-location="${escapeHtml(mine.location || '')}" data-date="${escapeHtml(formatDateOnly(mine.doneAt))}" data-time="${escapeHtml(formatTimeOnly(mine.doneAt))}" onclick="openImageViewer(this.src, {title:this.dataset.title, location:this.dataset.location, date:this.dataset.date, time:this.dataset.time})" alt="หลักฐานการส่งงาน">` : ''}
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

// ปุ่มยืนยันจะกดได้ก็ต่อเมื่อ เลือกแบบที่ส่ง + แนบรูปหลักฐาน ครบทั้งสอง (ไม่บังคับอธิบายแล้ว)
function validateSubmitForm() {
  const ok = !!selectedLocation && !!submitPhotoDataUrl;
  document.getElementById('confirm-submit-btn').disabled = !ok;
}

async function confirmSubmit() {
  if (!selectedLocation) { alert('เลือกก่อนว่าส่งงานนี้แบบไหน'); return; }
  if (!submitPhotoDataUrl) { alert('แนบรูปภาพหลักฐานการส่งงานก่อนนะ'); return; }
  if (!currentStudent) { alert('ไม่พบข้อมูลผู้ใช้ กรุณาเข้าสู่ระบบใหม่'); return; }

  let loc = selectedLocation;
  if (loc === 'อื่นๆ') {
    const custom = document.getElementById('location-other-input').value.trim();
    if (custom) loc = custom;
  }

  const prevSubmissions = state.submissions;
  state.submissions = state.submissions.filter(s => !(s.assignmentId === pendingSubmitId && s.studentId === currentStudent.id));
  state.submissions.push({
    assignmentId: pendingSubmitId,
    studentId: currentStudent.id,
    studentName: currentStudent.name,
    location: loc,
    photo: submitPhotoDataUrl,
    doneAt: new Date().toISOString()
  });

  const btn = document.getElementById('confirm-submit-btn');
  if (btn) { btn.disabled = true; btn.classList.add('is-saving'); }
  const ok = await saveState();
  if (btn) { btn.disabled = false; btn.classList.remove('is-saving'); }

  if (!ok) {
    state.submissions = prevSubmissions; // บันทึกไม่สำเร็จ: คืนค่าเดิม ไม่ปิดหน้าต่าง ให้กดส่งซ้ำได้
    showToast('บันทึกไม่สำเร็จ ลองกดส่งอีกครั้ง', 'error');
    return;
  }

  closeModal('submit-modal');
  renderAssignments();
  showToast('ส่งงานเรียบร้อยแล้ว', 'success');
}

async function toggleSubmit(id) {
  if (!currentStudent) return;
  const existing = state.submissions.find(s => s.assignmentId === id && s.studentId === currentStudent.id);
  if (existing) {
    if (!confirm('ยกเลิกการส่งงานนี้ใช่ไหม? ต้องส่งใหม่อีกครั้งถ้าเปลี่ยนใจ')) return;
    const prevSubmissions = state.submissions;
    state.submissions = state.submissions.filter(s => !(s.assignmentId === id && s.studentId === currentStudent.id));
    renderAssignments(); // อัปเดตปุ่มทันทีแบบ optimistic เพื่อไม่ให้รู้สึกค้าง
    const ok = await saveState();
    if (!ok) {
      state.submissions = prevSubmissions; // บันทึกไม่สำเร็จ: คืนสถานะเดิม ปุ่มจะกลับไปเป็น "ส่งแล้ว" ให้กดใหม่ได้
      renderAssignments();
      showToast('ยกเลิกไม่สำเร็จ ลองอีกครั้ง', 'error');
      return;
    }
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
  const last = state.subjects.length - 1;
  wrap.innerHTML = state.subjects.map((s, i) => `
    <div class="subject-chip">
      <span class="subject-chip-order-btns">
        <button class="chip-move-btn" onclick="moveSubject(${i}, -1)" ${i === 0 ? 'disabled' : ''} title="ย้ายขึ้น">▲</button>
        <button class="chip-move-btn" onclick="moveSubject(${i}, 1)" ${i === last ? 'disabled' : ''} title="ย้ายลง">▼</button>
      </span>
      ${s}<button onclick="removeSubject(${i})">×</button>
    </div>`).join('');
}

// ย้ายลำดับวิชา (ก่อน/หลัง) — ลำดับใน state.subjects กำหนดลำดับแท็บวิชาบนหน้างานทั้งหมดโดยตรง
function moveSubject(idx, dir) {
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= state.subjects.length) return;
  const [moved] = state.subjects.splice(idx, 1);
  state.subjects.splice(newIdx, 0, moved);
  saveState();
  renderSubjectChips();
  renderTabs();
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
  const canDelete = isAdmin || isTeacher; // แอดมินและอาจารย์ลบนักเรียนได้เหมือนกัน
  // แอดมินและอาจารย์แก้ไข "เลขที่" ได้ทั้งคู่
  wrap.innerHTML = state.students.map((s, i) => `
    <div class="student-row">
      ${s.photo
        ? `<img class="student-avatar" src="${s.photo}" alt="${escapeHtml(s.name)}">`
        : `<div class="student-avatar-placeholder">${initials(s.name)}</div>`}
      <input type="text" class="student-row-number-input" value="${escapeHtml(s.number != null ? String(s.number) : '')}"
        placeholder="เลขที่" inputmode="numeric" maxlength="10"
        onchange="updateStudentNumber(${i}, this.value)">
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

// แก้ไข "เลขที่" (เลขที่ในห้อง) ของนักเรียนที่มีอยู่แล้ว — แอดมินและอาจารย์แก้ไขได้ทั้งคู่
function updateStudentNumber(idx, value) {
  const s = state.students[idx];
  if (!s) return;
  const trimmed = (value || '').trim();
  s.number = trimmed === '' ? null : trimmed;
  saveState();
  if (mainView === 'roster') renderPeopleGrid();
}

async function previewNewStudentPhoto(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  openCropper(file, async (dataUrl) => {
    newStudentPhotoDataUrl = dataUrl;
    document.getElementById('new-student-photo-label').textContent = 'เลือกรูปแล้ว';
  });
}

function addStudent() {
  const nameInput = document.getElementById('new-student-name');
  const idInput = document.getElementById('new-student-id');
  const numberInput = document.getElementById('new-student-number');
  const name = normalizeName(nameInput.value);
  const id = idInput.value.trim();
  const number = numberInput.value.trim();
  if (!name || !id) { alert('กรอกชื่อและเลขประจำตัวให้ครบ'); return; }
  if (state.students.some(s => s.id === id)) { alert('มีเลขประจำตัวนี้อยู่แล้ว'); return; }
  state.students.push({ id, name, number: number || null, photo: newStudentPhotoDataUrl || null });
  saveState();
  nameInput.value = '';
  idInput.value = '';
  numberInput.value = '';
  newStudentPhotoDataUrl = null;
  document.getElementById('new-student-photo').value = '';
  document.getElementById('new-student-photo-label').textContent = 'เลือกรูป';
  renderStudentChips();
}

document.getElementById('new-student-name').addEventListener('keydown', e => { if (e.key === 'Enter') addStudent(); });
document.getElementById('new-student-number').addEventListener('keydown', e => { if (e.key === 'Enter') addStudent(); });
document.getElementById('new-student-id').addEventListener('keydown', e => { if (e.key === 'Enter') addStudent(); });

// เปิดตัวเลือกไฟล์เพื่อเปลี่ยน/เพิ่มรูปของนักเรียนที่มีอยู่แล้ว (ใช้ได้ทั้งแอดมินและอาจารย์)
function openStudentPhotoPicker(idx) {
  pendingPhotoStudentIdx = idx;
  document.getElementById('student-photo-file-hidden').click();
}

async function handleStudentPhotoChosen(input) {
  const file = input.files && input.files[0];
  if (!file || pendingPhotoStudentIdx === null) { input.value = ''; return; }
  const idx = pendingPhotoStudentIdx;
  openCropper(file, async (dataUrl) => {
    if (!state.students[idx]) return;
    const prevPhoto = state.students[idx].photo;
    state.students[idx].photo = dataUrl;
    renderStudentChips();
    const ok = await saveState();
    if (!ok) {
      state.students[idx].photo = prevPhoto;
      renderStudentChips();
      showToast('บันทึกรูปไม่สำเร็จ ลองอีกครั้ง', 'error');
      return;
    }
    showToast('อัปเดตรูปนักเรียนแล้ว', 'success');
  });
  input.value = '';
  pendingPhotoStudentIdx = null;
}

function removeStudent(idx) {
  if (!isAdmin && !isTeacher) return; // แอดมินและอาจารย์ลบนักเรียนได้เหมือนกัน
  const s = state.students[idx];
  if (!confirm(`ลบนักเรียน "${s.name}" ออกจากระบบ?`)) return;
  state.submissions = state.submissions.filter(sub => sub.studentId !== s.id);
  state.students.splice(idx, 1);
  saveState();
  renderStudentChips();
  renderAssignments();
}

// IMAGE VIEWER (lightbox สำหรับรูปหลักฐาน)
// info เป็น object ไม่บังคับ: { title, location, date, time } — ใส่เฉพาะ key ที่มีข้อมูลจริง
// แต่ละ key จะกลายเป็นบรรทัดแยกกัน "หัวข้อ : ค่า" ใต้รูป ถ้าไม่ส่ง info มาเลยจะซ่อนกล่อง caption ทั้งกล่อง
function openImageViewer(src, info) {
  document.getElementById('image-viewer-img').src = src;
  const capEl = document.getElementById('image-viewer-caption');
  if (capEl) {
    const rows = [];
    if (info && info.title) rows.push(['ชื่องาน', info.title]);
    if (info && info.location) rows.push(['ส่งแบบไหน', info.location]);
    if (info && info.date) rows.push(['วันที่', info.date]);
    if (info && info.time) rows.push(['เวลา', info.time]);

    if (rows.length) {
      capEl.innerHTML = rows.map(([label, value]) =>
        `<div class="viewer-info-row"><span class="viewer-info-label">${escapeHtml(label)} :</span><span class="viewer-info-value">${escapeHtml(value)}</span></div>`
      ).join('');
      capEl.style.display = 'block';
    } else {
      capEl.innerHTML = '';
      capEl.style.display = 'none';
    }
  }
  openModal('image-viewer-modal');
}

// แยกวันที่ล้วนๆ (ไม่มีเวลา) ไว้ใช้กับ caption แบบแยกบรรทัด
function formatDateOnly(iso) {
  if (!iso) return '';
  return formatFullDate(iso);
}
function formatTimeOnly(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm} น.`;
}

// ===== MAIN VIEW SWITCHER (งานทั้งหมด / อันดับส่งงาน / ข้อมูลนักเรียน-รายชื่อนักเรียน) =====
// สำหรับแอดมิน/อาจารย์: หมวด "ข้อมูลนักเรียน" แสดงชื่อ + รหัสนักเรียน + รูปภาพ + จำนวนงานที่ส่ง
// สำหรับนักเรียนทั่วไป: หมวด "รายชื่อนักเรียน" แสดงชื่อ + รูปภาพ + จำนวนงานที่ส่ง (ไม่แสดงรหัสประจำตัว)
function rosterCategoryLabel() { return (isAdmin || isTeacher) ? 'ข้อมูลนักเรียน' : 'รายชื่อนักเรียน'; }

// เดียวกับ renderTabs(): ทุกครั้งที่สลับหมวด (งานทั้งหมด/อันดับ/รายชื่อ) ห้ามทุบสร้างปุ่มใหม่ทั้งหมด
// เพราะ .view-tab มี animation entrance เหมือนกัน แค่เปลี่ยน label กับ toggle .active บนปุ่มเดิม
function renderMainViewSwitch() {
  const wrap = document.getElementById('main-view-switch');
  const views = [
    { id: 'assignments', label: 'งานทั้งหมด' },
    { id: 'leaderboard', label: 'อันดับคนส่งงานเยอะที่สุด' },
    { id: 'roster', label: rosterCategoryLabel() }
  ];
  const existing = Array.from(wrap.children);

  if (existing.length === views.length) {
    existing.forEach((btn, i) => {
      const v = views[i];
      btn.dataset.viewId = v.id;
      if (btn.textContent !== v.label) btn.textContent = v.label;
      btn.classList.toggle('active', mainView === v.id);
    });
    return;
  }

  wrap.innerHTML = '';
  views.forEach(v => {
    const btn = document.createElement('button');
    btn.className = 'view-tab' + (mainView === v.id ? ' active' : '');
    btn.textContent = v.label;
    btn.dataset.viewId = v.id;
    btn.onclick = () => setMainView(v.id);
    wrap.appendChild(btn);
  });
}

function setMainView(view) {
  mainView = view;
  renderMainViewSwitch();
  renderMainView();
}

function renderMainView() {
  const isAssignments = mainView === 'assignments';
  const showEl = document.getElementById(isAssignments ? 'assignments-view' : 'people-view');
  const hideEl = document.getElementById(isAssignments ? 'people-view' : 'assignments-view');
  if (!isAssignments) renderPeopleGrid();
  swapView(showEl, hideEl);
}

// สลับหน้าแบบมีเอฟเฟค fade + เลื่อนขึ้นเล็กน้อย แทนการสลับ display ทันที
function swapView(showEl, hideEl) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) {
    hideEl.style.display = 'none';
    showEl.style.display = 'block';
    return;
  }
  if (hideEl.style.display !== 'none') {
    hideEl.classList.add('view-leave');
    setTimeout(() => {
      hideEl.style.display = 'none';
      hideEl.classList.remove('view-leave');
    }, 170);
  }
  showEl.style.display = 'block';
  showEl.classList.remove('view-enter');
  void showEl.offsetWidth; // บังคับ reflow ให้ animation เริ่มใหม่ทุกครั้ง
  showEl.classList.add('view-enter');
}

// สร้างการ์ดของนักเรียนแต่ละคน (ใช้ร่วมกันทั้งหมวดอันดับและหมวดรายชื่อ/ข้อมูลนักเรียน)
// เรียงตาม "เลขที่" (เลขน้อยไปมาก) ถ้าใครไม่มีเลขที่ให้ไปอยู่ท้ายสุด เรียงชื่อ ก-ฮ ต่อ
function compareBySeatNumber(a, b) {
  const na = a.number != null && a.number !== '' && !isNaN(a.number) ? Number(a.number) : Infinity;
  const nb = b.number != null && b.number !== '' && !isNaN(b.number) ? Number(b.number) : Infinity;
  if (na !== nb) return na - nb;
  return normalizeName(a.name).localeCompare(normalizeName(b.name), 'th');
}

// เหมือนกับการ์ดงาน: ตัวแปรนี้กันไม่ให้การ์ดคนทั้งหมดเล่นแอนิเมชันเด้งซ้ำทุกครั้งที่สลับ
// อันดับ/รายชื่อ หรือแก้ไขข้อมูลคนใดคนหนึ่ง (ทั้ง grid ถูกสร้างใหม่เพราะข้อมูลเปลี่ยนจริง)
let peopleGridFirstPaintDone = false;

function personRowHtml(s, showId, rankBadgeHtml) {
  const avatar = s.photo
    ? `<img class="person-avatar" src="${s.photo}" alt="${escapeHtml(s.name)}">`
    : `<div class="person-avatar-placeholder">${initials(s.name)}</div>`;
  return `
    <div class="person-card tilt-card${peopleGridFirstPaintDone ? ' no-anim' : ''}" onclick="openPersonDetail('${escapeHtml(s.id)}')">
      ${rankBadgeHtml || ''}
      ${avatar}
      <div class="person-info">
        <div class="person-name">${escapeHtml(s.name)}</div>
        ${showId ? `<div class="person-id">รหัส ${escapeHtml(s.id)}</div>` : ''}
      </div>
      <div class="person-count">ส่งแล้ว ${s.count} ชิ้น</div>
    </div>`;
}

function podiumSlotHtml(s, rankIdx, cls) {
  const medals = ['🥇', '🥈', '🥉'];
  const avatar = s.photo
    ? `<img class="person-avatar" src="${s.photo}" alt="${escapeHtml(s.name)}">`
    : `<div class="person-avatar-placeholder">${initials(s.name)}</div>`;
  return `
    <div class="podium-slot ${cls} tilt-card${peopleGridFirstPaintDone ? ' no-anim' : ''}" onclick="openPersonDetail('${escapeHtml(s.id)}')">
      <div class="podium-rank-num">${medals[rankIdx]}</div>
      <div class="podium-avatar-wrap">${avatar}</div>
      <div class="podium-name">${escapeHtml(s.name)}</div>
      <div class="podium-count">ส่งแล้ว ${s.count} ชิ้น</div>
    </div>`;
}

function renderPeopleGrid() {
  const titleEl = document.getElementById('people-view-title');
  const grid = document.getElementById('people-grid');
  const showId = isAdmin || isTeacher;

  if (!state.students.length) {
    titleEl.textContent = mainView === 'leaderboard' ? 'อันดับคนส่งงานเยอะที่สุด' : rosterCategoryLabel();
    grid.innerHTML = '<div class="empty-state"><div class="e-icon">—</div><h3>ยังไม่มีนักเรียนในระบบ</h3><p>รอแอดมินหรืออาจารย์เพิ่มรายชื่อนักเรียนก่อนนะ</p></div>';
    peopleGridFirstPaintDone = true;
    return;
  }

  const withCounts = state.students.map(s => ({
    ...s,
    count: state.submissions.filter(sub => sub.studentId === s.id).length
  }));

  if (mainView === 'leaderboard') {
    titleEl.textContent = 'อันดับคนส่งงานเยอะที่สุด';
    const list = [...withCounts].sort((a, b) => b.count - a.count || normalizeName(a.name).localeCompare(normalizeName(b.name), 'th'));

    // อันดับ 1-2-3 ขึ้นแท่นโพเดียม ที่เหลือ (4 ลงไป) เป็นรายชื่อยาวลงมา
    const top3 = list.slice(0, 3);
    const rest = list.slice(3);
    const podiumClasses = ['gold', 'silver', 'bronze'];
    const podiumHtml = top3.length
      ? `<div class="podium-row">${top3.map((s, i) => podiumSlotHtml(s, i, podiumClasses[i])).join('')}</div>`
      : '';
    const restHtml = rest.length
      ? rest.map((s, i) => personRowHtml(s, showId, `<div class="person-rank">${i + 4}</div>`)).join('')
      : '';

    grid.innerHTML = podiumHtml + restHtml;
  } else {
    titleEl.textContent = rosterCategoryLabel();
    const list = [...withCounts].sort(compareBySeatNumber);
    grid.innerHTML = list.map(s => {
      const numBadge = `<div class="person-rank roster-num">${s.number != null && s.number !== '' ? escapeHtml(String(s.number)) : '–'}</div>`;
      return personRowHtml(s, showId, numBadge);
    }).join('');
  }
  peopleGridFirstPaintDone = true;
}

// ===== CUSTOM DATA FIELDS (หมวดข้อมูลเพิ่มเติม — แอดมินสร้าง นักเรียนกรอกเอง) =====
function openCustomFieldModal() { renderCustomFieldChips(); openModal('customfield-modal'); }

function renderCustomFieldChips() {
  const wrap = document.getElementById('customfield-chips');
  if (!state.customFields.length) { wrap.innerHTML = '<span style="color:var(--muted);font-size:13px;">ยังไม่มีหมวดข้อมูลเพิ่มเติม</span>'; return; }
  wrap.innerHTML = state.customFields.map((f, i) => `
    <div class="custom-field-chip">
      <span class="cfc-label">${escapeHtml(f.label)}</span>
      <button type="button" class="field-visibility-toggle ${f.private ? 'is-private' : 'is-public'}" onclick="toggleCustomFieldPrivate(${i})">
        ${f.private ? '🔒 ส่วนตัว' : '👁 สาธารณะ'}
      </button>
      <button class="cfc-del" onclick="removeCustomField(${i})">×</button>
    </div>`).join('');
}

function addCustomField() {
  const labelInput = document.getElementById('new-customfield-label');
  const privateInput = document.getElementById('new-customfield-private');
  const label = labelInput.value.trim();
  if (!label) return;
  if (state.customFields.some(f => f.label === label)) { alert('มีหมวดข้อมูลนี้อยู่แล้ว'); return; }
  state.customFields.push({ id: 'cf_' + Date.now(), label, private: !!privateInput.checked });
  saveState();
  labelInput.value = '';
  privateInput.checked = false;
  renderCustomFieldChips();
}
document.getElementById('new-customfield-label').addEventListener('keydown', e => { if (e.key === 'Enter') addCustomField(); });

function toggleCustomFieldPrivate(idx) {
  state.customFields[idx].private = !state.customFields[idx].private;
  saveState();
  renderCustomFieldChips();
}

function removeCustomField(idx) {
  const f = state.customFields[idx];
  if (!confirm(`ลบหมวดข้อมูล "${f.label}"? ข้อมูลของนักเรียนทุกคนในหมวดนี้จะหายไปด้วย`)) return;
  state.customFields.splice(idx, 1);
  saveState();
  renderCustomFieldChips();
}

// ===== PERSON DETAIL MODAL (คลิกชื่อใครก็ได้ในหมวดรายชื่อ/อันดับ) =====
// คนอื่นเห็นแค่ข้อมูลสาธารณะ (ชื่อ นามสกุล เบอร์ วันเกิด อีเมล สังเขป + หมวดข้อมูลเพิ่มเติมที่ตั้งเป็นสาธารณะ)
// แอดมิน/อาจารย์/เจ้าของข้อมูลเองเท่านั้นที่เห็นข้อมูลส่วนตัว (เลขประจำตัว เลขบัตรประชาชน + หมวดข้อมูลที่ตั้งเป็นส่วนตัว)
function canSeePrivateDataOf(studentId) {
  return isAdmin || isTeacher || (currentStudent && currentStudent.id === studentId);
}

function fieldRowHtml(label, value, isPrivate) {
  const lock = isPrivate ? '<span class="private-lock">🔒</span>' : '';
  const displayVal = value ? escapeHtml(value) : '';
  return `
    <div class="detail-field">
      <div class="detail-field-label">${label} ${lock}</div>
      <div class="detail-field-value ${displayVal ? '' : 'empty'}">${displayVal || 'ยังไม่ได้กรอก'}</div>
    </div>`;
}

function openPersonDetail(id) {
  viewingStudentId = id;
  renderPersonDetail(id);
  openModal('person-detail-modal');
}

function renderPersonDetail(id) {
  const s = state.students.find(st => st.id === id);
  if (!s) { closeModal('person-detail-modal'); return; }
  const showPrivate = canSeePrivateDataOf(s.id);

  const avatarWrap = document.getElementById('pd-avatar-wrap');
  avatarWrap.innerHTML = s.photo
    ? `<img class="person-detail-avatar" src="${s.photo}" alt="${escapeHtml(s.name)}">`
    : `<div class="person-detail-avatar-placeholder">${initials(s.name)}</div>`;

  document.getElementById('pd-name').textContent = s.name + (s.lastName ? ' ' + s.lastName : '');
  document.getElementById('pd-sub').textContent = showPrivate
    ? `เลขประจำตัว ${s.id}${s.number != null && s.number !== '' ? ' • เลขที่ ' + s.number : ''}`
    : (s.number != null && s.number !== '' ? 'เลขที่ ' + s.number : '');

  let html = '';
  html += fieldRowHtml('เบอร์โทร', s.phone, false);
  html += fieldRowHtml('วันเกิด', s.birthday ? formatFullDate(s.birthday) : '', false);
  html += fieldRowHtml('อีเมล', s.email, false);
  html += fieldRowHtml('สังเขป', s.bio, false);

  state.customFields.forEach(f => {
    if (f.private && !showPrivate) return; // หมวดส่วนตัว: ซ่อนจากคนอื่น
    const val = s.customValues && s.customValues[f.id];
    html += fieldRowHtml(f.label, val, f.private);
  });

  if (showPrivate) {
    html += fieldRowHtml('เลขประจำตัว', s.id, true);
    html += fieldRowHtml('เลขบัตรประชาชน', s.nationalId, true);
  }

  document.getElementById('pd-fields').innerHTML = html;

  // คลังรูปภาพ: รวมรูปหลักฐานทุกงานที่นักเรียนคนนี้เคยส่งมาไว้ที่เดียว (เดิมต้องไล่เปิดทีละงาน)
  // เห็นได้เฉพาะแอดมิน/อาจารย์ (หรือดูของตัวเอง) เหมือน field ส่วนตัวอื่นๆ
  const gallerySection = document.getElementById('pd-gallery-section');
  const galleryGrid = document.getElementById('pd-gallery-grid');
  if (showPrivate) {
    const mySubs = state.submissions
      .filter(sub => sub.studentId === s.id && sub.photo)
      .map(sub => {
        const a = state.assignments.find(as => as.id === sub.assignmentId);
        return {
          photo: sub.photo,
          title: a ? a.title : 'งานที่ถูกลบแล้ว',
          due: a ? a.due : null,
          location: sub.location,
          doneAt: sub.doneAt
        };
      })
      .sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));

    if (mySubs.length) {
      gallerySection.style.display = 'block';
      galleryGrid.innerHTML = mySubs.map(m => `
        <div class="pd-gallery-item">
          <img src="${m.photo}" alt="${escapeHtml(m.title)}"
               data-title="${escapeHtml(m.title)}" data-location="${escapeHtml(m.location || '')}"
               data-date="${escapeHtml(formatDateOnly(m.doneAt))}" data-time="${escapeHtml(formatTimeOnly(m.doneAt))}"
               onclick="openImageViewer(this.src, {title:this.dataset.title, location:this.dataset.location, date:this.dataset.date, time:this.dataset.time})">
          <div class="pd-gallery-item-label">${escapeHtml(m.title)}</div>
        </div>`).join('');
    } else {
      gallerySection.style.display = 'block';
      galleryGrid.innerHTML = '<div style="color:var(--muted);font-size:13px;">ยังไม่มีรูปหลักฐานที่ส่งมา</div>';
    }
  } else {
    gallerySection.style.display = 'none';
    galleryGrid.innerHTML = '';
  }

  const editBtn = document.getElementById('pd-edit-btn');
  editBtn.style.display = showPrivate ? 'inline-flex' : 'none';
}

function openProfileEditFromDetail() {
  if (viewingStudentId == null) return;
  closeModal('person-detail-modal');
  openProfileEdit(viewingStudentId);
}

// ปุ่ม "แก้ไขข้อมูลของฉัน" บน header — เปิดแก้ไขโปรไฟล์ของตัวเองโดยตรง
function openSelfEdit() {
  if (!currentStudent) return;
  openProfileEdit(currentStudent.id);
}

// ===== PROFILE EDIT MODAL (self / admin / teacher) =====
function openProfileEdit(id) {
  const s = state.students.find(st => st.id === id);
  if (!s) return;
  editingStudentId = id;
  profileEditPhotoDataUrl = undefined;

  const isSelf = currentStudent && currentStudent.id === id && !isAdmin && !isTeacher;
  document.getElementById('pe-title').textContent = isSelf ? 'แก้ไขข้อมูลของฉัน' : `แก้ไขข้อมูล — ${s.name}`;

  // นักเรียนทั่วไปแก้ไขข้อมูลตัวเองได้ แต่ "เปลี่ยนรูปโปรไฟล์" ให้เฉพาะแอดมิน/อาจารย์เท่านั้น
  document.getElementById('pe-photo-label').style.display = isSelf ? 'none' : '';

  const avatarWrap = document.getElementById('pe-avatar-wrap');
  avatarWrap.innerHTML = s.photo
    ? `<img class="person-detail-avatar" id="pe-avatar-preview" src="${s.photo}" alt="">`
    : `<div class="person-detail-avatar-placeholder" id="pe-avatar-preview">${initials(s.name)}</div>`;

  document.getElementById('pe-lastname').value = s.lastName || '';
  document.getElementById('pe-phone').value = s.phone || '';
  document.getElementById('pe-birthday').value = s.birthday || '';
  document.getElementById('pe-email').value = s.email || '';
  document.getElementById('pe-bio').value = s.bio || '';
  document.getElementById('pe-nationalid').value = s.nationalId || '';

  const cfWrap = document.getElementById('pe-customfields');
  cfWrap.innerHTML = state.customFields.map(f => `
    <div class="form-group">
      <label>${escapeHtml(f.label)} ${f.private ? '<span class="private-lock">🔒 ส่วนตัว</span>' : ''}</label>
      <input type="text" class="pe-cf-input" data-field-id="${f.id}" value="${escapeHtml((s.customValues && s.customValues[f.id]) || '')}">
    </div>`).join('');

  openModal('profile-edit-modal');
}

function handleProfileEditPhoto(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  openCropper(file, (dataUrl) => {
    profileEditPhotoDataUrl = dataUrl;
    const wrap = document.getElementById('pe-avatar-wrap');
    wrap.innerHTML = `<img class="person-detail-avatar" id="pe-avatar-preview" src="${dataUrl}" alt="">`;
  });
  input.value = '';
}

async function saveProfileEdit() {
  const s = state.students.find(st => st.id === editingStudentId);
  if (!s) return;

  const nationalId = document.getElementById('pe-nationalid').value.trim();
  if (nationalId && !/^\d{13}$/.test(nationalId)) {
    alert('เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก');
    return;
  }

  // เก็บค่ารูปเดิมไว้ก่อน เผื่อบันทึกไม่สำเร็จแล้วต้องคืนค่า
  const prevPhoto = s.photo;
  const hadPhotoChange = profileEditPhotoDataUrl !== undefined;

  s.lastName = document.getElementById('pe-lastname').value.trim() || null;
  s.phone = document.getElementById('pe-phone').value.trim() || null;
  s.birthday = document.getElementById('pe-birthday').value || null;
  s.email = document.getElementById('pe-email').value.trim() || null;
  s.bio = document.getElementById('pe-bio').value.trim() || null;
  s.nationalId = nationalId || null;
  if (hadPhotoChange) s.photo = profileEditPhotoDataUrl;

  s.customValues = s.customValues || {};
  document.querySelectorAll('.pe-cf-input').forEach(inp => {
    const val = inp.value.trim();
    if (val) s.customValues[inp.dataset.fieldId] = val;
    else delete s.customValues[inp.dataset.fieldId];
  });

  // ถ้าเป็น session ปัจจุบันของตัวเอง (นักเรียนแก้ไขข้อมูลตัวเอง) อัปเดต currentStudent + session ให้ตรงกันด้วย
  if (currentStudent && currentStudent.id === s.id) {
    currentStudent = s;
    const saved = localStorage.getItem('session');
    if (saved) {
      try {
        const sess = JSON.parse(saved);
        if (sess.type === 'student') { sess.student = s; localStorage.setItem('session', JSON.stringify(sess)); }
      } catch (e) { /* ignore */ }
    }
  }

  // รอผลบันทึกขึ้น cloud จริงๆ ก่อนปิดหน้าต่าง — กันปัญหาหน้าต่างปิดไปแล้วแต่รูป/ข้อมูล
  // ที่แก้ไม่ได้ถูกบันทึกจริง (เช่น เน็ตหลุด หรือรูปใหญ่เกินจนบันทึกไม่สำเร็จ)
  const btn = document.querySelector('#profile-edit-modal .btn-save');
  if (btn) { btn.disabled = true; btn.classList.add('is-saving'); }

  const ok = await saveState();

  if (btn) { btn.disabled = false; btn.classList.remove('is-saving'); }

  if (!ok) {
    if (hadPhotoChange) s.photo = prevPhoto; // คืนค่ารูปเดิม ไม่ปิดหน้าต่าง ให้กดบันทึกซ้ำได้เลย
    showToast('บันทึกไม่สำเร็จ ลองกดบันทึกอีกครั้ง', 'error');
    return;
  }

  profileEditPhotoDataUrl = undefined;
  closeModal('profile-edit-modal');
  showToast('บันทึกข้อมูลแล้ว', 'success');
  if (mainView !== 'assignments') renderPeopleGrid();
  editingStudentId = null;
}


function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

document.querySelectorAll('.modal-overlay').forEach(o => {
  o.addEventListener('click', e => {
    if (e.target !== o) return;
    if (o.id === 'crop-modal') { cancelCrop(); return; }
    closeModal(o.id);
  });
  // ปุ่มปิด (×) แบบ liquid glass มุมขวาบน ให้ตรงกับดีไซน์อ้างอิง — เติมให้ทุก modal อัตโนมัติ
  const box = o.querySelector('.modal');
  if (box && !box.querySelector('.modal-close')) {
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'modal-close';
    closeBtn.setAttribute('aria-label', 'ปิด');
    closeBtn.textContent = '×';
    closeBtn.onclick = () => { o.id === 'crop-modal' ? cancelCrop() : closeModal(o.id); };
    box.prepend(closeBtn);
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('admin-modal').classList.contains('open')) doAdminLogin();
  if (e.key === 'Enter' && document.getElementById('teacher-modal').classList.contains('open')) doTeacherLogin();
  if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(m => closeModal(m.id));
});






// ===== CURSOR-FOLLOW LIQUID GLASS ORB + TAP RIPPLE =====
// กระจกลอยตามเมาส์แบบนุ่มๆ (desktop) และเอฟเฟกต์กระจกกระเพื่อมตรงจุดที่กด/แตะ (ทุกอุปกรณ์)
(function initGlassCursorFx() {
  const orb = document.getElementById('cursor-glass');
  const supportsHover = window.matchMedia('(hover: hover)').matches;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (orb && supportsHover && !reduceMotion) {
    let targetX = window.innerWidth / 2, targetY = window.innerHeight / 2;
    let curX = targetX, curY = targetY;
    let active = false;

    document.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return;
      targetX = e.clientX; targetY = e.clientY;
      if (!active) { active = true; orb.classList.add('active'); }
    });
    document.addEventListener('pointerleave', () => { active = false; orb.classList.remove('active'); });

    // Slower, heavier trailing lag reads as a droplet of liquid rather than
    // a mechanical follow. Velocity is turned into a gentle squish/stretch
    // along the direction of travel, like surface tension on water.
    let sx = 1, sy = 1;
    let rafRunning = false;
    function raf() {
      curX += (targetX - curX) * 0.11;
      curY += (targetY - curY) * 0.11;
      const vx = targetX - curX, vy = targetY - curY;
      const speed = Math.min(Math.hypot(vx, vy) / 40, 1);
      const targetSx = 1 + speed * 0.22;
      const targetSy = 1 - speed * 0.16;
      sx += (targetSx - sx) * 0.18;
      sy += (targetSy - sy) * 0.18;
      const angle = Math.atan2(vy, vx) * (180 / Math.PI);
      orb.style.transform =
        `translate(${curX}px, ${curY}px) translate(-50%, -50%) rotate(${angle}deg) scale(${sx}, ${sy}) rotate(${-angle}deg)`;
      // เมื่อหยดน้ำตามทันเมาส์แล้วและนิ่งพอ ให้หยุดวนลูปไปเลย แทนที่จะรันทุกเฟรมตลอดเวลา
      // (ก่อนหน้านี้ลูปนี้ทำงานไม่หยุดแม้เมาส์นิ่ง กินซีพียูเปล่าๆ ทำให้หน้าเว็บรู้สึกหน่วง)
      const settled = Math.hypot(vx, vy) < 0.4 && Math.abs(sx - 1) < 0.004 && Math.abs(sy - 1) < 0.004;
      if (settled) { rafRunning = false; return; }
      requestAnimationFrame(raf);
    }
    function ensureRaf() { if (!rafRunning) { rafRunning = true; requestAnimationFrame(raf); } }
    document.addEventListener('pointermove', ensureRaf);
    ensureRaf();
  }

})();

// Works via event delegation so it keeps applying to cards that get
// re-rendered dynamically (assignment list, stats, login box).
//
// เดิม handler นี้เรียก getBoundingClientRect() ทุกครั้งที่ pointermove ยิง (บาง
// เมาส์/แทร็คแพดยิงได้เป็นร้อยครั้ง/วินาที) — getBoundingClientRect บังคับให้เบราว์เซอร์
// คำนวณ layout ใหม่ทันที (forced synchronous layout) ทำให้หน้าเว็บกระตุกเวลาขยับเมาส์
// ผ่านการ์ดเร็วๆ หรือมีการ์ดเยอะบนจอ ตอนนี้แก้เป็น:
//   1) getBoundingClientRect() เฉพาะตอน "เปลี่ยนการ์ด" เท่านั้น (cache ไว้ ไม่อ่านซ้ำทุกเฟรม)
//   2) เขียนค่า --rx/--ry ผ่าน requestAnimationFrame จำกัดไว้ที่ 1 ครั้ง/เฟรม แทนที่จะ
//      เขียนตาม raw pointermove ตรงๆ
(function initTilt() {
  const TILT_MAX = 7; // degrees
  const supportsHover = window.matchMedia('(hover: hover)').matches;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!supportsHover || reduceMotion) return;

  let activeCard = null;
  let activeRect = null;
  let lastX = 0, lastY = 0;
  let rafScheduled = false;

  document.addEventListener('pointermove', (e) => {
    const card = e.target.closest && e.target.closest('.tilt-card');
    if (!card) {
      if (activeCard) resetCard(activeCard);
      activeCard = null;
      activeRect = null;
      return;
    }
    if (card !== activeCard) {
      activeCard = card;
      activeRect = card.getBoundingClientRect(); // อ่านแค่ตอนเปลี่ยนการ์ด
    }
    lastX = e.clientX; lastY = e.clientY;
    if (!rafScheduled) {
      rafScheduled = true;
      requestAnimationFrame(applyTilt);
    }
  });

  function applyTilt() {
    rafScheduled = false;
    if (!activeCard || !activeRect) return;
    const rect = activeRect;
    const px = (lastX - rect.left) / rect.width;
    const py = (lastY - rect.top) / rect.height;
    const rx = (py - 0.5) * -TILT_MAX;
    const ry = (px - 0.5) * TILT_MAX;
    activeCard.style.setProperty('--rx', rx.toFixed(2) + 'deg');
    activeCard.style.setProperty('--ry', ry.toFixed(2) + 'deg');
    activeCard.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
    activeCard.style.setProperty('--my', (py * 100).toFixed(1) + '%');
  }

  document.addEventListener('pointerleave', (e) => {
    const card = e.target.closest && e.target.closest('.tilt-card');
    if (card) resetCard(card);
    if (card === activeCard) { activeCard = null; activeRect = null; }
  }, true);

  // การ์ดอาจขยับตำแหน่งเวลา scroll/resize ระหว่างที่ยังเป็น activeCard อยู่ —
  // ต้องอ่าน rect ใหม่เฉพาะตอนนี้เท่านั้น (ไม่ใช่ทุกเฟรม)
  window.addEventListener('scroll', () => { if (activeCard) activeRect = activeCard.getBoundingClientRect(); }, { passive: true });
  window.addEventListener('resize', () => { if (activeCard) activeRect = activeCard.getBoundingClientRect(); });

  function resetCard(card) {
    card.style.setProperty('--rx', '0deg');
    card.style.setProperty('--ry', '0deg');
  }
})();

// ===== ZOOM PRESS FEEDBACK (guaranteed, even for elements that get rebuilt on click) =====
// ปุ่ม/แท็บ/การ์ดหลายจุด (แท็บวิชา, สลับหน้า, การ์ดงาน) พอกดแล้วโค้ดจะสร้าง DOM ใหม่ทั้งหมด
// ทันที ทำให้ transition ตอน "ปล่อยเมาส์" ของ CSS :active ไม่มีโอกาสได้เล่นเลยเพราะตัว element
// เดิมถูกทำลายไปก่อน จุดนี้จับตั้งแต่ "กดลง" (pointerdown) เพื่อให้เห็นเอฟเฟคซูมออกทันทีเสมอ
// ไม่ว่าปุ่มนั้นจะถูกสร้างใหม่หลังคลิกหรือไม่ก็ตาม (ส่วนซูมเข้าตอนปล่อยจัดการด้วย CSS แยกต่างหาก)
(function () {
  const PRESS_SELECTOR = '.tab, .type-btn, .view-tab, .btn-save, .btn-cancel, .btn-icon, .file-btn, ' +
    '.assignment-card, .person-card, .podium-slot, .btn-submit, .location-chip, .modal-close, ' +
    '.stat-card, .self-edit-btn, .login-btn, .btn-sm, .btn-primary';
  document.addEventListener('pointerdown', e => {
    const el = e.target.closest && e.target.closest(PRESS_SELECTOR);
    if (!el) return;
    el.style.transition = 'transform 0.09s ' + getComputedStyle(document.documentElement).getPropertyValue('--ease-snap');
    el.style.transform = (el.style.transform ? el.style.transform + ' ' : '') + 'scale(0.91)';
    const clear = () => {
      // ปล่อยกลับให้ CSS คุมต่อ (ตัด inline style ทิ้ง) เพื่อให้ transition/animation ปกติทำงานต่อได้
      requestAnimationFrame(() => { el.style.transition = ''; el.style.transform = ''; });
    };
    el.addEventListener('pointerup', clear, { once: true });
    el.addEventListener('pointerleave', clear, { once: true });
  });
})();
