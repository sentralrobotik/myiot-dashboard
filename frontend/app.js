/* ============================================================
   SR-IoT Dashboard — mock IoT dashboard (Blynk-style) with sketchy UI.
   Vanilla JS. Accounts + projects persisted in localStorage
   (client-side demo auth — see note in the login screen).
   ============================================================ */

const DISMISS_KEY = 'iotiny_install_dismissed_v1';
function dataKey(uidStr){ return 'iotiny_data_v1__' + uidStr; }

const TEMPLATE_ICONS = ['🌡️','💧','🌱','💡','🔌','🏠','🚪','🔋','📡','🎛️','🐟','❄️'];
const DS_TYPES = ['Integer','Double','String','Boolean'];
const WIDGET_TYPES = [
  { id:'gauge',  label:'Gauge',        icon:'🌡️', types:['Integer','Double'] },
  { id:'value',  label:'Label Nilai',  icon:'🔢', types:['Integer','Double','String'] },
  { id:'chart',  label:'Grafik',       icon:'📈', types:['Integer','Double'] },
  { id:'slider', label:'Slider',       icon:'🎚️', types:['Integer','Double'] },
  { id:'switch', label:'Switch',       icon:'🔀', types:['Boolean'] },
  { id:'button', label:'Tombol Push',  icon:'🔘', types:['Boolean'] },
  { id:'led',    label:'LED',          icon:'💡', types:['Boolean'] },
];
const WIFI_NAMES = ['Rumah_Kita','TelkomHome-2A91','MyRepublic-5G','Indihome@1234','Kos_Barokah','Warkop_Pak_Budi','ORBIT-9F21','Kantor_Lantai2','Tetangga_Sebelah'];

function uid(prefix){ return prefix + '_' + Math.random().toString(36).slice(2,9); }
function pinList(){ return Array.from({length:32}, (_,i)=>'V'+i); }
function genToken(){
  const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let t=''; for(let i=0;i<32;i++) t+=chars[Math.floor(Math.random()*chars.length)];
  return t;
}
function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ================================================================
   ACCOUNTS (Firebase Authentication — username dipetakan ke email sintetis
   "username@myiot.local" supaya bisa pakai signInWithEmailAndPassword)
   ================================================================ */
function usernameToEmail(username){ return username.toLowerCase() + '@myiot.local'; }
function firebaseErrorToText(err){
  const map = {
    'auth/email-already-in-use': 'Username sudah dipakai, coba login',
    'auth/wrong-password': 'Username atau password salah',
    'auth/user-not-found': 'Username atau password salah',
    'auth/weak-password': 'Password minimal 6 karakter',
    'auth/invalid-email': 'Username mengandung karakter yang tidak valid',
    'auth/requires-recent-login': 'Sesi terlalu lama, silakan login ulang lalu coba lagi',
    'auth/network-request-failed': 'Gagal terhubung ke server, cek koneksi internet',
  };
  return map[err.code] || ('Terjadi kesalahan: ' + err.message);
}

let currentUser = null; // display name (shown in UI)
let currentUid = null;  // firebase uid (dipakai untuk key penyimpanan & path Firebase)
let state = { templates:[], devices:[] };

/* ================================================================
   LIVE DATA — device yang sudah terhubung (d.firebaseId terisi)
   ambil data sensor & status online langsung dari Firebase Realtime
   Database, bukan lagi dari simulasi lokal.
   ================================================================ */
const ONLINE_THRESHOLD_MS = 15000; // heartbeat ESP tiap 5 detik, offline kalau >15 detik tidak update
let liveDeviceData = {};   // firebaseId -> { data:{pin:val,...}, lastSeen:number }
let liveListeners = {};    // firebaseId -> {dataRef, dataHandler, statusRef, statusHandler}

function attachLiveDevice(d){
  if(!d.firebaseId || liveListeners[d.firebaseId]) return;
  const dataRef = window.fbDb.ref('devices/'+d.firebaseId+'/data');
  const statusRef = window.fbDb.ref('devices/'+d.firebaseId+'/status');

  const dataHandler = dataRef.on('value', snap=>{
    const info = liveDeviceData[d.firebaseId] || (liveDeviceData[d.firebaseId] = {});
    const newData = snap.val() || {};
    // simpan histori ringan di memori (untuk grafik), bukan di localStorage
    if(info.data){
      Object.keys(newData).forEach(pin=>{
        if(newData[pin] !== info.data[pin]){
          info.history = info.history || {};
          info.history[pin] = info.history[pin] || [];
          info.history[pin].push(newData[pin]);
          if(info.history[pin].length>20) info.history[pin].shift();
        }
      });
    }
    info.data = newData;
    refreshLiveView(d.id);
  });

  const statusHandler = statusRef.on('value', snap=>{
    const info = liveDeviceData[d.firebaseId] || (liveDeviceData[d.firebaseId] = {});
    const status = snap.val() || {};
    info.lastSeen = status.lastSeen || 0;
    info.ssid = status.ssid || null;
    refreshLiveView(d.id);
  });

  liveListeners[d.firebaseId] = { dataRef, dataHandler, statusRef, statusHandler };
}
function detachAllLiveDevices(){
  Object.keys(liveListeners).forEach(fid=>{
    const l = liveListeners[fid];
    l.dataRef.off('value', l.dataHandler);
    l.statusRef.off('value', l.statusHandler);
  });
  liveListeners = {};
  liveDeviceData = {};
}
function refreshLiveView(deviceId){
  if(nav.view==='device-dashboard' && nav.params.deviceId===deviceId) renderDeviceDashboard();
  if(nav.view==='devices') renderDevices();
}
function isDeviceOnline(d){
  if(!d.firebaseId) return d.online; // device demo/mock: pakai toggle manual
  const info = liveDeviceData[d.firebaseId];
  if(!info || !info.lastSeen) return false;
  return (Date.now() - info.lastSeen) < ONLINE_THRESHOLD_MS;
}
function getDeviceValue(d, ds){
  if(d.firebaseId){
    const info = liveDeviceData[d.firebaseId];
    const v = info && info.data ? info.data[ds.pin] : undefined;
    return v===undefined ? (ds.default ?? 0) : v;
  }
  return d.values[ds.id];
}
function getDeviceHistory(d, ds){
  if(d.firebaseId){
    const info = liveDeviceData[d.firebaseId];
    const hist = info && info.history ? info.history[ds.pin] : null;
    return (hist && hist.length) ? hist : [getDeviceValue(d, ds)];
  }
  return (d.history && d.history[ds.id]) || [getDeviceValue(d, ds)];
}
// jam dinding klien re-render tiap 3 detik supaya status online/offline
// ikut "kadaluarsa" walau tidak ada data baru masuk (device benar2 mati)
setInterval(()=>{
  if(!currentUser) return;
  if(nav.view==='devices') renderDevices();
  if(nav.view==='device-dashboard'){
    const d = state.devices.find(d=>d.id===nav.params.deviceId);
    if(d && d.firebaseId) renderDeviceDashboard();
  }
}, 3000);

function defaultState(){
  const tempId = uid('tpl');
  const dsTemp = uid('ds'), dsHum = uid('ds'), dsRelay = uid('ds');
  const template = {
    id: tempId, name: 'Monitor Suhu Kamar', icon: '🌡️',
    datastreams: [
      { id:dsTemp, name:'Suhu', pin:'V0', type:'Double', min:0, max:50, unit:'°C', default:26 },
      { id:dsHum,  name:'Kelembaban', pin:'V1', type:'Integer', min:0, max:100, unit:'%', default:60 },
      { id:dsRelay,name:'Kipas', pin:'V2', type:'Boolean', min:0, max:1, unit:'', default:0 },
    ],
    widgets: [
      { id:uid('w'), type:'gauge', dsId:dsTemp, label:'Suhu' },
      { id:uid('w'), type:'chart', dsId:dsTemp, label:'Riwayat Suhu' },
      { id:uid('w'), type:'gauge', dsId:dsHum, label:'Kelembaban' },
      { id:uid('w'), type:'switch', dsId:dsRelay, label:'Kipas' },
    ]
  };
  const device = {
    id: uid('dev'), name: 'Kamar Tidur', templateId: tempId, online: true, token: genToken(),
    wifi: { ssid:null, connected:false },
    values: { [dsTemp]:26, [dsHum]:60, [dsRelay]:0 },
    history: { [dsTemp]:[26], [dsHum]:[60] },
  };
  return { templates:[template], devices:[device] };
}

function loadUserState(uidStr){
  try{
    const raw = localStorage.getItem(dataKey(uidStr));
    if(raw) return JSON.parse(raw);
  }catch(e){ console.warn('gagal memuat project', e); }
  return defaultState();
}
function saveState(){
  if(!currentUid) return;
  try{ localStorage.setItem(dataKey(currentUid), JSON.stringify(state)); }
  catch(e){ console.warn('gagal menyimpan project', e); }
}

let authTab = 'login';
function switchAuthTab(tab){ authTab = tab; renderAuth(); }

function renderAuth(){
  const c = document.getElementById('view-auth');
  c.innerHTML = `
    <div class="auth-logo"><img src="icon-192.png" alt="SR-IoT"></div>
    <div class="auth-title">SR-IoT Dashboard</div>
    <div class="auth-sub">Dashboard IoT untuk mikrokontrolermu</div>
    <div class="auth-tabs">
      <div class="auth-tab ${authTab==='login'?'active':''}" onclick="switchAuthTab('login')">Masuk</div>
      <div class="auth-tab ${authTab==='register'?'active':''}" onclick="switchAuthTab('register')">Daftar</div>
    </div>
    <div class="field">
      <label>Username <span class="req">*</span></label>
      <input type="text" id="auth-username" placeholder="username" autocomplete="username">
    </div>
    <div class="field">
      <label>Password <span class="req">*</span></label>
      <input type="password" id="auth-password" placeholder="••••••••" autocomplete="current-password">
    </div>
    ${authTab==='register' ? `
    <div class="field">
      <label>Konfirmasi Password <span class="req">*</span></label>
      <input type="password" id="auth-password2" placeholder="••••••••">
    </div>` : ''}
    <button class="btn block" onclick="submitAuth()">${authTab==='login' ? 'Masuk' : 'Buat Akun'}</button>
    <div class="auth-note">Akun diverifikasi lewat Firebase Authentication. Data project saat ini masih tersimpan lokal per browser — sinkronisasi penuh ke cloud menyusul.</div>
  `;
}
function submitAuth(){
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value;
  if(!username || username.length<3){ toast('Username minimal 3 karakter'); return; }
  if(!password || password.length<4){ toast('Password minimal 4 karakter'); return; }
  const email = usernameToEmail(username);

  if(authTab==='register'){
    const confirmPw = document.getElementById('auth-password2').value;
    if(password !== confirmPw){ toast('Konfirmasi password tidak cocok'); return; }
    window.fbAuth.createUserWithEmailAndPassword(email, password)
      .then(cred => cred.user.updateProfile({ displayName: username }).then(()=>cred.user))
      .then(user => {
        currentUser = username;
        currentUid = user.uid;
        state = defaultState();
        saveState();
        showApp();
        state.devices.forEach(attachLiveDevice);
        toast('Akun dibuat, selamat datang!');
      })
      .catch(err => toast(firebaseErrorToText(err)));
  } else {
    window.fbAuth.signInWithEmailAndPassword(email, password)
      .then(cred => {
        currentUser = cred.user.displayName || username;
        currentUid = cred.user.uid;
        state = loadUserState(currentUid);
        showApp();
        state.devices.forEach(attachLiveDevice);
        toast('Selamat datang kembali!');
      })
      .catch(err => toast(firebaseErrorToText(err)));
  }
}
function logout(){
  if(!confirm('Keluar dari akun ini?')) return;
  window.fbAuth.signOut().then(()=>{
    currentUser = null;
    currentUid = null;
    detachAllLiveDevices();
    closeModal();
    showAuth();
  });
}

function showAuth(){
  document.getElementById('view-auth').classList.remove('hidden');
  document.getElementById('main-topbar').style.display = 'none';
  document.getElementById('bottomnav').style.display = 'none';
  document.getElementById('fab').style.display = 'none';
  ['devices','templates','device-dashboard','template-editor','wifi-setup'].forEach(v=>{
    document.getElementById('view-'+v).classList.add('hidden');
  });
  authTab = 'login';
  renderAuth();
}
function showApp(){
  document.getElementById('view-auth').classList.add('hidden');
  nav = { tab:'devices', view:'devices', params:{} };
  renderAll();
}

/* ================================================================
   Navigation
   ================================================================ */
let nav = { tab:'devices', view:'devices', params:{} };
let templateEditorTab = 'datastreams';
let wifiScan = { scanning:false, results:[] };

function go(view, params={}){ nav.view = view; nav.params = params; renderAll(); }
function goTab(tab){ nav.tab = tab; go(tab === 'devices' ? 'devices' : 'templates'); }

/* ---------------- Toast ---------------- */
let toastTimer=null;
function toast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> el.classList.remove('show'), 1900);
}

/* ---------------- Modal ---------------- */
function openModal(html){
  document.getElementById('modal-content').innerHTML = html;
  document.getElementById('modal-backdrop').classList.remove('hidden');
}
function closeModal(){ document.getElementById('modal-backdrop').classList.add('hidden'); }

/* ================================================================
   ACCOUNT MENU
   ================================================================ */
function renderProfile(){
  const c = document.getElementById('view-profile');
  const initial = currentUser ? currentUser[0].toUpperCase() : '?';
  const fbUser = window.fbAuth.currentUser;
  const joined = fbUser && fbUser.metadata.creationTime
    ? new Date(fbUser.metadata.creationTime).toLocaleDateString('id-ID', { year:'numeric', month:'long', day:'numeric' })
    : '-';
  const deviceCount = state.devices.length;
  const templateCount = state.templates.length;

  c.innerHTML = `
    <div class="topbar">
      <div class="back" onclick="go('devices')">‹</div>
      <div class="title">Profil</div>
      <div class="spacer"></div>
    </div>

    <div class="card">
      <div class="account-user">
        <div class="account-avatar" style="width:56px;height:56px;font-size:22px;">${initial}</div>
        <div>
          <div class="row-title" style="font-size:18px;">${escapeHtml(currentUser||'')}</div>
          <div class="row-sub">Bergabung sejak ${joined}</div>
        </div>
      </div>
      <div style="display:flex;gap:10px;margin-top:14px;">
        <div class="card" style="flex:1;margin:0;padding:12px;text-align:center;">
          <div class="widget-value">${deviceCount}</div>
          <div class="row-sub">Device</div>
        </div>
        <div class="card" style="flex:1;margin:0;padding:12px;text-align:center;">
          <div class="widget-value">${templateCount}</div>
          <div class="row-sub">Template</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="account-menu-item" onclick="openChangeUsernameModal()"><span class="ic">✏️</span> Ganti Username</div>
      <div class="account-menu-item" onclick="triggerInstall()"><span class="ic">📲</span> Pasang aplikasi ke HP</div>
      <div class="account-menu-item" onclick="logout()" style="color:var(--red);"><span class="ic">🚪</span> Keluar</div>
    </div>
  `;
}

function openChangeUsernameModal(){
  openModal(`
    <h3>Ganti Username</h3>
    <div class="field">
      <label>Username Baru <span class="req">*</span></label>
      <input type="text" id="new-username" placeholder="cth: budi_iot" value="${escapeHtml(currentUser||'')}">
      <div class="hint">Minimal 3 karakter, huruf/angka/underscore saja.</div>
    </div>
    <div class="field">
      <label>Password (konfirmasi) <span class="req">*</span></label>
      <input type="password" id="confirm-password" placeholder="Masukkan password akunmu">
    </div>
    <div class="modal-actions">
      <button class="btn ghost" onclick="closeModal()">Batal</button>
      <button class="btn" onclick="saveNewUsername()">Simpan</button>
    </div>
  `);
}

function saveNewUsername(){
  const newUsername = document.getElementById('new-username').value.trim();
  const password = document.getElementById('confirm-password').value;

  if(!/^[a-zA-Z0-9_]{3,20}$/.test(newUsername)){
    toast('Username 3-20 karakter: huruf, angka, underscore'); return;
  }
  if(newUsername === currentUser){ closeModal(); return; }

  const user = window.fbAuth.currentUser;
  const cred = firebase.auth.EmailAuthProvider.credential(user.email, password);

  user.reauthenticateWithCredential(cred)
    .then(() => user.updateEmail(usernameToEmail(newUsername)))
    .then(() => user.updateProfile({ displayName: newUsername }))
    .then(() => {
      // Catatan: data project TIDAK perlu dipindah lagi, karena kuncinya
      // sekarang firebase uid (currentUid), bukan nama username.
      currentUser = newUsername;
      closeModal();
      renderProfile();
      renderAll();
      toast('Username berhasil diganti');
    })
    .catch(err => toast(firebaseErrorToText(err)));
}

/* ================================================================
   PWA INSTALL
   ================================================================ */
let deferredInstallPrompt = null;
function isIOS(){ return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream; }
function isStandalone(){ return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }

window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault();
  deferredInstallPrompt = e;
  if(nav.view==='devices' || nav.view==='templates') renderAll();
});
window.addEventListener('appinstalled', ()=>{ deferredInstallPrompt = null; toast('Aplikasi terpasang di HP!'); });

function triggerInstall(){
  if(deferredInstallPrompt){
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.finally(()=>{ deferredInstallPrompt = null; renderAll(); });
    return;
  }
  if(isIOS()){
    openModal(`
      <h3>Pasang di iPhone/iPad</h3>
      <div class="field"><div class="hint" style="font-size:14px;line-height:1.8;">
        1. Buka tombol <b>Share</b> (kotak dengan panah ke atas) di Safari.<br>
        2. Pilih <b>"Add to Home Screen"</b> / "Tambah ke Layar Utama".<br>
        3. Ketuk <b>Add</b>. Ikon SR-IoT akan muncul di HP-mu.
      </div></div>
      <div class="modal-actions"><button class="btn block" onclick="closeModal()">Mengerti</button></div>
    `);
    return;
  }
  toast('Buka menu (⋮) browser lalu pilih "Install app" / "Add to Home screen"');
}

function dismissInstallBanner(){
  try{ localStorage.setItem(DISMISS_KEY,'1'); }catch(e){}
  renderAll();
}
function installBannerHtml(){
  let dismissed = false;
  try{ dismissed = localStorage.getItem(DISMISS_KEY)==='1'; }catch(e){}
  if(dismissed || isStandalone()) return '';
  if(!deferredInstallPrompt && !isIOS()) return '';
  return `
    <div class="install-banner">
      <span style="font-size:24px;">📲</span>
      <div class="txt"><b>Pasang SR-IoT di HP</b>Akses seperti aplikasi asli, tanpa Play Store.</div>
      <button class="btn sm yellow" onclick="triggerInstall()">Pasang</button>
      <span style="cursor:pointer;font-weight:700;color:var(--muted);padding:0 4px;" onclick="dismissInstallBanner()">✕</span>
    </div>`;
}

/* ================================================================
   RENDER: Devices list
   ================================================================ */
function renderDevices(){
  const c = document.getElementById('view-devices');
  const banner = installBannerHtml();
  if(state.devices.length === 0){
    c.innerHTML = `
      <div class="page-heading">Device</div>
      ${banner}
      <div class="empty">
        <span class="big">📡</span>
        <div class="display">Belum ada device</div>
        <div>Tambah device baru dari template yang sudah kamu buat.</div>
      </div>`;
    return;
  }
  let rows = state.devices.map(d=>{
    const t = state.templates.find(t=>t.id===d.templateId);
    return `
      <div class="list-row" onclick="go('device-dashboard',{deviceId:'${d.id}'})">
        <div class="row-icon">${t ? t.icon : '📟'}</div>
        <div class="row-body">
          <div class="row-title">${escapeHtml(d.name)}</div>
          <div class="row-sub"><span class="dot ${isDeviceOnline(d)?'on':'off'}"></span>${isDeviceOnline(d)?'Online':'Offline'} · ${t ? escapeHtml(t.name) : 'Template dihapus'}</div>
        </div>
        <div class="row-arrow">›</div>
      </div>`;
  }).join('');
  c.innerHTML = `<div class="page-heading">Device</div>${banner}${rows}`;
}

function renderTemplates(){
  const c = document.getElementById('view-templates');
  const banner = installBannerHtml();
  if(state.templates.length === 0){
    c.innerHTML = `
      <div class="page-heading">Template</div>
      ${banner}
      <div class="empty">
        <span class="big">🎛️</span>
        <div class="display">Belum ada template</div>
        <div>Buat template untuk mengatur datastream & widget dashboard.</div>
      </div>`;
    return;
  }
  let rows = state.templates.map(t=>{
    const usedBy = state.devices.filter(d=>d.templateId===t.id).length;
    return `
      <div class="list-row" onclick="openTemplateEditor('${t.id}')">
        <div class="row-icon">${t.icon}</div>
        <div class="row-body">
          <div class="row-title">${escapeHtml(t.name)}</div>
          <div class="row-sub">${t.datastreams.length} datastream · dipakai ${usedBy} device</div>
        </div>
        <div class="row-trash" onclick="event.stopPropagation(); deleteTemplate('${t.id}')">🗑️</div>
        <div class="row-arrow">›</div>
      </div>`;
  }).join('');
  c.innerHTML = `<div class="page-heading">Template</div>${banner}${rows}`;
}

function deleteTemplate(id){
  const t = state.templates.find(t=>t.id===id);
  if(!t) return;
  const affected = state.devices.filter(d=>d.templateId===id).length;
  const msg = affected>0
    ? `Hapus template "${t.name}"? ${affected} device masih memakainya dan akan kehilangan widget dashboard-nya.`
    : `Hapus template "${t.name}"?`;
  if(!confirm(msg)) return;
  state.templates = state.templates.filter(x=>x.id!==id);
  saveState();
  if(nav.view==='template-editor' && nav.params.templateId===id){ go('templates'); }
  else renderAll();
  toast('Template dihapus');
}

/* ================================================================
   TEMPLATE EDITOR
   ================================================================ */
function openTemplateEditor(id){ go('template-editor', {templateId:id}); }

function renderTemplateEditor(){
  const c = document.getElementById('view-template-editor');
  const t = state.templates.find(t=>t.id===nav.params.templateId);
  if(!t){ c.innerHTML = '<div class="empty">Template tidak ditemukan.</div>'; return; }

  const tabsHtml = `
    <div class="tabs">
      <div class="tab ${templateEditorTab==='datastreams'?'active':''}" onclick="templateEditorTab='datastreams';renderAll()">Datastream</div>
      <div class="tab ${templateEditorTab==='widgets'?'active':''}" onclick="templateEditorTab='widgets';renderAll()">Web Dashboard</div>
    </div>`;

  let body = '';
  if(templateEditorTab === 'datastreams'){
    body = t.datastreams.map(ds=>`
      <div class="ds-row">
        <div class="ds-pin">${ds.pin}</div>
        <div class="ds-info">
          <div class="ds-name">${escapeHtml(ds.name)}</div>
          <div class="ds-meta">${ds.type}${ds.type!=='String'&&ds.type!=='Boolean' ? ` · ${ds.min}–${ds.max} ${escapeHtml(ds.unit||'')}` : ''}</div>
        </div>
        <div class="ds-del" onclick="deleteDatastream('${t.id}','${ds.id}')">✕</div>
      </div>`).join('') || `<div class="empty"><span class="big">🔌</span><div class="display">Belum ada datastream</div><div>Datastream adalah "kabel virtual" untuk data device kamu.</div></div>`;
    body += `<div style="margin:0 16px;"><button class="btn block yellow" onclick="openAddDatastreamModal('${t.id}')">+ Tambah Datastream</button></div>`;
  } else {
    if(t.datastreams.length === 0){
      body = `<div class="empty"><span class="big">🧩</span><div class="display">Buat datastream dulu</div><div>Widget perlu terhubung ke datastream.</div></div>`;
    } else {
      body = `<div class="widget-grid">${t.widgets.map(w=>renderWidgetCard(w, t, null, true)).join('')}</div>`;
      body += `<div style="margin:0 16px;"><button class="btn block" onclick="openAddWidgetModal('${t.id}')">+ Tambah Widget</button></div>`;
    }
  }

  c.innerHTML = `
    <div class="topbar">
      <div class="back" onclick="go('templates')">‹</div>
      <div class="title">${escapeHtml(t.name)}</div>
      <div class="row-trash" style="background:#fff;border-radius:8px;width:34px;height:34px;display:flex;align-items:center;justify-content:center;border:2px solid var(--ink);" onclick="deleteTemplate('${t.id}')">🗑️</div>
    </div>
    ${tabsHtml}
    ${body}
  `;
}

function deleteDatastream(templateId, dsId){
  const t = state.templates.find(t=>t.id===templateId);
  t.datastreams = t.datastreams.filter(d=>d.id!==dsId);
  t.widgets = t.widgets.filter(w=>w.dsId!==dsId);
  saveState(); renderAll();
  toast('Datastream dihapus');
}

function openAddDatastreamModal(templateId){
  const pins = pinList();
  openModal(`
    <h3>Datastream Baru</h3>
    <div class="field">
      <label>Nama <span class="req">*</span></label>
      <input type="text" id="ds-name" placeholder="cth: Suhu">
    </div>
    <div class="field-row">
      <div class="field">
        <label>Virtual Pin</label>
        <select id="ds-pin">${pins.map(p=>`<option value="${p}">${p}</option>`).join('')}</select>
      </div>
      <div class="field">
        <label>Tipe Data</label>
        <select id="ds-type" onchange="toggleDsRangeFields()">
          ${DS_TYPES.map(dt=>`<option value="${dt}">${dt}</option>`).join('')}
        </select>
      </div>
    </div>
    <div id="ds-range-fields" class="field-row">
      <div class="field"><label>Min</label><input type="number" id="ds-min" value="0"></div>
      <div class="field"><label>Max</label><input type="number" id="ds-max" value="100"></div>
      <div class="field"><label>Satuan</label><input type="text" id="ds-unit" placeholder="°C"></div>
    </div>
    <div class="modal-actions">
      <button class="btn ghost" onclick="closeModal()">Batal</button>
      <button class="btn yellow" onclick="saveDatastream('${templateId}')">Simpan</button>
    </div>
  `);
}
function toggleDsRangeFields(){
  const type = document.getElementById('ds-type').value;
  document.getElementById('ds-range-fields').style.display = (type==='Integer'||type==='Double') ? 'flex' : 'none';
}
function saveDatastream(templateId){
  const t = state.templates.find(t=>t.id===templateId);
  const name = document.getElementById('ds-name').value.trim();
  if(!name){ toast('Nama datastream wajib diisi'); return; }
  const pin = document.getElementById('ds-pin').value;
  const type = document.getElementById('ds-type').value;
  const isNum = (type==='Integer'||type==='Double');
  const ds = {
    id: uid('ds'), name, pin, type,
    min: isNum ? Number(document.getElementById('ds-min').value||0) : 0,
    max: isNum ? Number(document.getElementById('ds-max').value||100) : (type==='Boolean'?1:0),
    unit: isNum ? document.getElementById('ds-unit').value.trim() : '',
    default: isNum ? Number(document.getElementById('ds-min').value||0) : (type==='Boolean'?0:'')
  };
  t.datastreams.push(ds);
  state.devices.filter(d=>d.templateId===templateId).forEach(d=>{
    d.values[ds.id] = ds.default;
    if(isNum) d.history[ds.id] = [ds.default];
  });
  saveState(); closeModal(); renderAll();
  toast('Datastream ditambahkan');
}

function openAddWidgetModal(templateId){
  const t = state.templates.find(t=>t.id===templateId);
  openModal(`
    <h3>Widget Baru</h3>
    <div class="field">
      <label>Jenis Widget</label>
      <div class="chip-row" id="widget-type-chips">
        ${WIDGET_TYPES.map(wt=>`<div class="chip" data-wt="${wt.id}" onclick="selectWidgetType('${wt.id}')">${wt.icon} ${wt.label}</div>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>Datastream</label>
      <select id="widget-ds">
        ${t.datastreams.map(ds=>`<option value="${ds.id}" data-type="${ds.type}">${ds.name} (${ds.pin})</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label>Label Widget</label>
      <input type="text" id="widget-label" placeholder="cth: Suhu Kamar">
    </div>
    <div class="modal-actions">
      <button class="btn ghost" onclick="closeModal()">Batal</button>
      <button class="btn" onclick="saveWidget('${templateId}')">Simpan</button>
    </div>
  `);
  selectWidgetType(WIDGET_TYPES[0].id);
}
let pendingWidgetType = null;
function selectWidgetType(id){
  pendingWidgetType = id;
  document.querySelectorAll('#widget-type-chips .chip').forEach(el=>{
    el.classList.toggle('selected', el.dataset.wt===id);
  });
  const wt = WIDGET_TYPES.find(w=>w.id===id);
  const select = document.getElementById('widget-ds');
  [...select.options].forEach(opt=>{ opt.hidden = !wt.types.includes(opt.dataset.type); });
  const firstValid = [...select.options].find(o=>!o.hidden);
  if(firstValid) select.value = firstValid.value;
}
function saveWidget(templateId){
  const t = state.templates.find(t=>t.id===templateId);
  const dsId = document.getElementById('widget-ds').value;
  const label = document.getElementById('widget-label').value.trim() || (t.datastreams.find(d=>d.id===dsId)||{}).name || 'Widget';
  if(!dsId){ toast('Pilih datastream dulu'); return; }
  t.widgets.push({ id: uid('w'), type: pendingWidgetType, dsId, label });
  saveState(); closeModal(); renderAll();
  toast('Widget ditambahkan');
}
function deleteWidget(templateId, widgetId){
  const t = state.templates.find(t=>t.id===templateId);
  t.widgets = t.widgets.filter(w=>w.id!==widgetId);
  saveState(); renderAll();
}

/* ================================================================
   DEVICE DASHBOARD
   ================================================================ */
function renderDeviceDashboard(){
  const c = document.getElementById('view-device-dashboard');
  const d = state.devices.find(d=>d.id===nav.params.deviceId);
  if(!d){ c.innerHTML = '<div class="empty">Device tidak ditemukan.</div>'; return; }
  const t = state.templates.find(t=>t.id===d.templateId);

  let widgetsHtml;
  if(!t){
    widgetsHtml = `<div class="empty">Template untuk device ini sudah dihapus.</div>`;
  } else if(t.widgets.length===0){
    widgetsHtml = `<div class="empty"><span class="big">🧩</span><div class="display">Belum ada widget</div><div>Tambahkan widget dari halaman Template.</div></div>`;
  } else {
    widgetsHtml = `<div class="widget-grid">${t.widgets.map(w=>renderWidgetCard(w, t, d, false)).join('')}</div>`;
  }

  const liveInfo = d.firebaseId ? (liveDeviceData[d.firebaseId] || {}) : null;
  const wifiLabel = d.firebaseId
    ? (liveInfo.ssid ? `Wi-Fi: ${escapeHtml(liveInfo.ssid)}` : 'Wi-Fi belum dilaporkan device')
    : (d.wifi && d.wifi.connected ? `Wi-Fi: ${escapeHtml(d.wifi.ssid)}` : 'Wi-Fi belum diatur');
  const online = isDeviceOnline(d);
  const linked = !!d.firebaseId;
  const onlineToggleBtn = linked
    ? `<div class="history-tag" style="align-self:center;">status otomatis dari device</div>`
    : `<button class="btn sm ${d.online?'ghost':''}" onclick="toggleDeviceOnline('${d.id}')">${d.online?'Offline-kan':'Online-kan'}</button>`;

  c.innerHTML = `
    <div class="topbar">
      <div class="back" onclick="go('devices')">‹</div>
      <div class="title">${escapeHtml(d.name)}</div>
      <div class="spacer"></div>
    </div>
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <div>
          <div class="row-sub"><span class="dot ${online?'on':'off'}"></span>${online?'Online':'Offline'}</div>
          <div class="history-tag">${wifiLabel}</div>
        </div>
        ${onlineToggleBtn}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn sm yellow" onclick="openTokenModal('${d.id}')">🔑 Lihat Token</button>
        <button class="btn sm deep" onclick="go('wifi-setup',{deviceId:'${d.id}'})">🛜 Atur Wi-Fi</button>
        <button class="btn sm danger" onclick="deleteDevice('${d.id}')">🗑️ Hapus</button>
      </div>
    </div>
    ${widgetsHtml}
  `;
}

function toggleDeviceOnline(id){
  const d = state.devices.find(d=>d.id===id);
  d.online = !d.online;
  saveState(); renderAll();
}
function deleteDevice(id){
  if(!confirm('Hapus device ini? Semua data & histori akan hilang.')) return;
  state.devices = state.devices.filter(d=>d.id!==id);
  saveState(); go('devices');
  toast('Device dihapus');
}

/* ---------- Device ID modal ---------- */
function openTokenModal(deviceId){
  const d = state.devices.find(d=>d.id===deviceId);
  if(!d) return;
  const linked = !!d.firebaseId;
  openModal(`
    <h3>🔑 Device ID (Firebase)</h3>
    <div class="field"><div class="hint">${linked ? 'Device ID ini didapat dari Serial Monitor ESP32 saat pertama kali nyala, dan sudah dipakai untuk menghubungkan device ini ke akunmu di Firebase.' : 'Device ini belum terhubung ke device asli manapun. Tempel Device ID dari Serial Monitor ESP32 di sini untuk menghubungkannya.'}</div></div>
    <div class="token-field-label">Nama Device</div>
    <div class="token-box">${escapeHtml(d.name)}</div>
    <div class="token-field-label">Device ID</div>
    <div class="token-box" id="token-text">${linked ? escapeHtml(d.firebaseId) : '<i>belum terhubung</i>'}</div>
    ${linked ? `
    <div class="copy-row">
      <button class="btn sm yellow" onclick="copyToken('${d.firebaseId}')">📋 Salin Device ID</button>
    </div>` : `
    <div class="field" style="margin-top:12px;">
      <input type="text" id="link-firebase-id" placeholder="Tempel Device ID di sini">
    </div>
    <div class="modal-actions">
      <button class="btn ghost" onclick="closeModal()">Batal</button>
      <button class="btn" onclick="linkExistingDevice('${d.id}')">Hubungkan</button>
    </div>`}
    ${linked ? `
    <div class="modal-actions" style="margin-top:16px;">
      <button class="btn block ghost" onclick="closeModal()">Tutup</button>
    </div>` : ``}
  `);
}
function linkExistingDevice(deviceId){
  const firebaseId = document.getElementById('link-firebase-id').value.trim();
  if(!firebaseId){ toast('Device ID wajib diisi'); return; }
  window.fbDb.ref('devices/'+firebaseId+'/ownerUid').set(currentUid)
    .then(()=>{
      const d = state.devices.find(d=>d.id===deviceId);
      d.firebaseId = firebaseId;
      saveState();
      attachLiveDevice(d);
      closeModal();
      toast('Device berhasil terhubung ke Firebase');
    })
    .catch(()=> toast('Device ID salah atau sudah dipakai akun lain'));
}
function copyToken(token){
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(token).then(()=>toast('Device ID disalin!')).catch(()=>fallbackCopy(token));
  } else fallbackCopy(token);
}
function fallbackCopy(token){
  const ta = document.createElement('textarea');
  ta.value = token; ta.style.position='fixed'; ta.style.opacity='0';
  document.body.appendChild(ta); ta.select();
  try{ document.execCommand('copy'); toast('Device ID disalin!'); }catch(e){ toast('Gagal menyalin, salin manual ya'); }
  document.body.removeChild(ta);
}

/* ---------- widget rendering ---------- */
function renderWidgetCard(widget, template, device, previewMode){
  const ds = template.datastreams.find(d=>d.id===widget.dsId);
  if(!ds) return `<div class="widget"><div class="widget-label">${escapeHtml(widget.label)}</div><div class="history-tag">datastream dihapus</div></div>`;
  const val = device ? getDeviceValue(device, ds) : (ds.default ?? (ds.type==='Boolean'?0: ds.min ?? 0));
  const editBadge = previewMode ? `<div class="ds-del" style="align-self:flex-end;margin-top:-8px;" onclick="deleteWidget('${template.id}','${widget.id}')">✕</div>` : '';
  // kontrol aktuator (switch/slider/tombol) ke device asli menyusul di tahap berikutnya —
  // untuk device yang sudah terhubung ke Firebase, widget ini masih tampil read-only dulu.
  const actuatorLocked = false; // Langkah 2: kontrol aktuator sudah aktif lewat perintah Firebase

  let inner = '';
  switch(widget.type){
    case 'gauge': {
      const pct = ds.max>ds.min ? Math.round(((val-ds.min)/(ds.max-ds.min))*100) : 0;
      inner = `
        <div class="gauge-wrap">
          <div class="gauge-ring" style="--pct:${Math.max(0,Math.min(100,pct))}">
            <div class="gauge-inner"><span>${formatVal(val,ds)}</span><span class="widget-unit">${escapeHtml(ds.unit||'')}</span></div>
          </div>
        </div>`;
      break;
    }
    case 'value': {
      inner = `<div class="widget-value">${formatVal(val,ds)}</div><div class="widget-unit">${escapeHtml(ds.unit||'')}</div>`;
      break;
    }
    case 'chart': {
      const hist = device ? getDeviceHistory(device, ds) : [val];
      inner = `<div class="chart-wrap">${sparkline(hist, ds)}</div><div class="widget-value" style="font-size:16px;">${formatVal(val,ds)} <span class="widget-unit">${escapeHtml(ds.unit||'')}</span></div>`;
      break;
    }
    case 'slider': {
      inner = `
        <div class="widget-value">${formatVal(val,ds)}</div>
        <input type="range" min="${ds.min}" max="${ds.max}" value="${val}"
          ${previewMode||actuatorLocked?'disabled':''}
          oninput="this.parentElement.querySelector('.widget-value').textContent=this.value"
          onchange="setDeviceValue('${device?device.id:''}','${ds.id}',Number(this.value))">
        <div class="widget-unit">${escapeHtml(ds.unit||'')}</div>`;
      break;
    }
    case 'switch': {
      const on = !!Number(val);
      inner = `
        <div class="switch ${on?'on':''}" ${(previewMode||actuatorLocked)?'':`onclick="toggleSwitch('${device?device.id:''}','${ds.id}')"`}>
          <div class="knob"></div>
        </div>
        <div class="widget-unit">${on?'ON':'OFF'}</div>`;
      break;
    }
    case 'button': {
      inner = `
        <button class="btn ${Number(val)?'yellow':'ghost'} sm" style="margin-top:20px;"
          ${(previewMode||actuatorLocked)?'disabled':`onmousedown="setDeviceValue('${device?device.id:''}','${ds.id}',1)" onmouseup="setDeviceValue('${device?device.id:''}','${ds.id}',0)" ontouchstart="setDeviceValue('${device?device.id:''}','${ds.id}',1)" ontouchend="setDeviceValue('${device?device.id:''}','${ds.id}',0)"`}>
          Tekan
        </button>`;
      break;
    }
    case 'led': {
      const on = !!Number(val);
      inner = `<div class="led ${on?'on':''}" ${(previewMode||actuatorLocked)?'':`onclick="toggleSwitch('${device?device.id:''}','${ds.id}')"`}></div><div class="widget-unit">${on?'MENYALA':'MATI'}</div>`;
      break;
    }
    default:
      inner = `<div class="widget-value">${formatVal(val,ds)}</div>`;
  }

  const wide = widget.type==='chart' ? 'wide' : '';
  return `<div class="widget ${wide}">
      <div class="widget-label" style="width:100%;display:flex;justify-content:space-between;">
        <span>${escapeHtml(widget.label)} · ${ds.pin}</span>${editBadge}
      </div>
      ${inner}
    </div>`;
}

function formatVal(val, ds){
  if(ds.type==='Double') return Number(val).toFixed(1);
  if(ds.type==='Boolean') return Number(val)?'1':'0';
  return val;
}

function sparkline(values, ds){
  const w=260, h=60, pad=6;
  const min = ds.min, max = ds.max>min?ds.max:min+1;
  const pts = values.map((v,i)=>{
    const x = pad + (i/(Math.max(values.length-1,1)))*(w-pad*2);
    const y = h - pad - ((v-min)/(max-min))*(h-pad*2);
    return `${x.toFixed(1)},${Math.max(pad,Math.min(h-pad,y)).toFixed(1)}`;
  }).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline points="${pts}" fill="none" stroke="var(--brand)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function setDeviceValue(deviceId, dsId, value){
  const d = state.devices.find(d=>d.id===deviceId);
  if(!d) return;

  if(d.firebaseId){
    const t = state.templates.find(t=>t.id===d.templateId);
    const ds = t && t.datastreams.find(x=>x.id===dsId);
    if(!ds) return;
    sendActuatorCommand(d.firebaseId, ds.pin, value);
    return; // tampilan ikut update otomatis begitu device membalas ke /data
  }

  d.values[dsId] = value;
  if(d.history[dsId]){
    d.history[dsId].push(value);
    if(d.history[dsId].length>20) d.history[dsId].shift();
  }
  saveState();
  if(nav.view==='device-dashboard' && nav.params.deviceId===deviceId) renderDeviceDashboard();
}
function toggleSwitch(deviceId, dsId){
  const d = state.devices.find(d=>d.id===deviceId);
  if(!d) return;
  const t = state.templates.find(t=>t.id===d.templateId);
  const ds = t && t.datastreams.find(x=>x.id===dsId);
  const cur = Number(ds ? getDeviceValue(d, ds) : d.values[dsId]) || 0;
  setDeviceValue(deviceId, dsId, cur?0:1);
}
// Kirim perintah ke device lewat node /commands (owner boleh tulis, device yang baca & eksekusi
// — lihat checkPendingCommand() di MyIoT.cpp). Device akan menjalankan callback onVirtualWrite()
// di sketch-nya lalu menulis balik nilai terbaru ke /data supaya dashboard ikut ter-update.
function sendActuatorCommand(firebaseId, pin, value){
  window.fbDb.ref('devices/'+firebaseId+'/commands').set({
    type: 'virtual_write', pin: pin, value: value
  }).catch(()=> toast('Gagal mengirim perintah ke device'));
}

/* ================================================================
   WI-FI SETUP
   ================================================================ */
function renderWifiSetup(){
  const c = document.getElementById('view-wifi-setup');
  const d = state.devices.find(d=>d.id===nav.params.deviceId);
  if(!d){ c.innerHTML = '<div class="empty">Device tidak ditemukan.</div>'; return; }

  if(d.firebaseId){ renderWifiSetupReal(c, d); return; }
  renderWifiSetupDemo(c, d);
}

/* ---- Device asli: ganti Wi-Fi dikirim sebagai command ke device (device harus online) ---- */
function renderWifiSetupReal(c, d){
  const info = liveDeviceData[d.firebaseId] || {};
  const online = isDeviceOnline(d);
  const currentHtml = info.ssid
    ? `
      <div class="wifi-row connected">
        <div class="signal-bars"><i style="opacity:1"></i><i style="opacity:1"></i><i style="opacity:1"></i><i style="opacity:1"></i></div>
        <div style="flex:1;">
          <div class="wifi-name">${escapeHtml(info.ssid)}</div>
          <div class="wifi-meta">Wi-Fi saat ini (dilaporkan device)</div>
        </div>
      </div>`
    : `<div class="empty" style="padding:24px 20px;"><span class="big">🛜</span><div class="display">Belum ada info Wi-Fi</div><div>Device belum pernah melaporkan status Wi-Fi-nya.</div></div>`;

  c.innerHTML = `
    <div class="topbar">
      <div class="back" onclick="go('device-dashboard',{deviceId:'${d.id}'})">‹</div>
      <div class="title">Wi-Fi Device</div>
      <div class="spacer"></div>
    </div>
    <div class="page-heading" style="font-size:18px;">${escapeHtml(d.name)}</div>
    <div class="card">
      <div class="field"><div class="hint" style="font-size:12px;">
        Browser tidak bisa memindai Wi-Fi di sekitar mikrokontroler — pemindaian harus dilakukan oleh device itu sendiri.
        Isi manual nama & password Wi-Fi baru di bawah, perintah akan dikirim ke device dan diterapkan dalam beberapa detik
        <b>selama device masih online</b>.
      </div></div>
      ${currentHtml}
    </div>
    ${!online ? `<div class="empty" style="padding:0 20px 16px;"><div>⚠️ Device sedang offline. Perintah ganti Wi-Fi tidak akan sampai sampai device online kembali.</div></div>` : ''}
    <div class="card">
      <div class="field">
        <label>Nama Wi-Fi baru (SSID)</label>
        <input type="text" id="wifi-new-ssid" placeholder="cth: Rumah_Kita">
      </div>
      <div class="field">
        <label>Password</label>
        <input type="password" id="wifi-new-pass" placeholder="Kosongkan jika jaringan terbuka">
      </div>
      <button class="btn block" onclick="submitWifiCommand('${d.id}')">📡 Kirim & Sambungkan</button>
    </div>
    <div class="card" style="border-color:var(--ink);">
      <div class="history-tag">Belum pernah konek internet sama sekali?</div>
      <div class="hint" style="font-size:12px;margin-top:4px;">
        Kalau device benar-benar baru / belum pernah tersambung Wi-Fi apapun, cara di atas tidak akan berfungsi
        (device belum online sehingga tidak bisa menerima perintah). Untuk setup pertama: nyalakan device, cari
        Wi-Fi bernama <b>MyIoT-Setup-xxxx</b> dari HP, sambungkan ke situ, lalu ikuti halaman yang otomatis terbuka
        di HP-mu untuk memasukkan Wi-Fi rumah.
      </div>
    </div>
  `;
}
function submitWifiCommand(deviceId){
  const d = state.devices.find(d=>d.id===deviceId);
  if(!d) return;
  const ssid = document.getElementById('wifi-new-ssid').value.trim();
  const pass = document.getElementById('wifi-new-pass').value;
  if(!ssid){ toast('Nama Wi-Fi wajib diisi'); return; }
  window.fbDb.ref('devices/'+d.firebaseId+'/commands').set({
    type: 'set_wifi', ssid: ssid, password: pass
  }).then(()=>{
    toast('Perintah ganti Wi-Fi terkirim ke device');
  }).catch(()=> toast('Gagal mengirim perintah ke device'));
}

/* ---- Device demo (belum ada Device ID): simulasi tampilan seperti sebelumnya ---- */
function renderWifiSetupDemo(c, d){
  let currentHtml = '';
  if(d.wifi && d.wifi.connected){
    currentHtml = `
      <div class="wifi-row connected">
        <div class="signal-bars"><i style="opacity:1"></i><i style="opacity:1"></i><i style="opacity:1"></i><i style="opacity:1"></i></div>
        <div style="flex:1;">
          <div class="wifi-name">${escapeHtml(d.wifi.ssid)}</div>
          <div class="wifi-meta">Tersambung</div>
        </div>
        <button class="btn sm danger" onclick="disconnectWifi('${d.id}')">Putuskan</button>
      </div>`;
  } else {
    currentHtml = `<div class="empty" style="padding:24px 20px;"><span class="big">🛜</span><div class="display">Belum ada Wi-Fi terhubung</div><div>Pindai jaringan di sekitar mikrokontroler untuk menyambungkannya.</div></div>`;
  }

  let scanHtml = '';
  if(wifiScan.scanning){
    scanHtml = `<div class="wifi-scan-spin"></div><div class="empty" style="padding:0 20px 20px;">Memindai Wi-Fi di sekitar…</div>`;
  } else if(wifiScan.results.length){
    scanHtml = wifiScan.results.map(nwk=>`
      <div class="wifi-row" onclick="connectToNetwork('${d.id}','${escapeHtml(nwk.ssid)}',${nwk.locked})">
        <div class="signal-bars">
          <i style="opacity:${nwk.signal>=1?1:.25}"></i>
          <i style="opacity:${nwk.signal>=2?1:.25}"></i>
          <i style="opacity:${nwk.signal>=3?1:.25}"></i>
          <i style="opacity:${nwk.signal>=4?1:.25}"></i>
        </div>
        <div style="flex:1;">
          <div class="wifi-name">${escapeHtml(nwk.ssid)}</div>
          <div class="wifi-meta">${nwk.locked?'Terkunci':'Terbuka'}</div>
        </div>
        <span class="wifi-lock">${nwk.locked?'🔒':'🔓'}</span>
      </div>`).join('');
  }

  c.innerHTML = `
    <div class="topbar">
      <div class="back" onclick="go('device-dashboard',{deviceId:'${d.id}'})">‹</div>
      <div class="title">Wi-Fi Device</div>
      <div class="spacer"></div>
    </div>
    <div class="page-heading" style="font-size:18px;">${escapeHtml(d.name)}</div>
    <div class="card">
      <div class="field"><div class="hint" style="font-size:12px;">Device ini masih mode demo (belum terhubung Device ID asli), jadi daftar Wi-Fi di bawah cuma simulasi tampilan.</div></div>
      ${currentHtml}
    </div>
    <div style="margin:0 16px 12px;">
      <button class="btn block" ${wifiScan.scanning?'disabled':''} onclick="startWifiScan('${d.id}')">🔍 Pindai Wi-Fi Sekitar</button>
    </div>
    ${scanHtml}
  `;
}
function startWifiScan(deviceId){
  wifiScan = { scanning:true, results:[] };
  renderAll();
  setTimeout(()=>{
    const shuffled = [...WIFI_NAMES].sort(()=>Math.random()-0.5).slice(0, 4+Math.floor(Math.random()*3));
    wifiScan = {
      scanning:false,
      results: shuffled.map(ssid=>({ ssid, signal: 1+Math.floor(Math.random()*4), locked: Math.random()>0.25 }))
    };
    renderAll();
  }, 1300);
}
function connectToNetwork(deviceId, ssid, locked){
  if(locked){
    openModal(`
      <h3>🔒 ${escapeHtml(ssid)}</h3>
      <div class="field">
        <label>Password Wi-Fi</label>
        <input type="password" id="wifi-pass" placeholder="Masukkan password">
      </div>
      <div class="modal-actions">
        <button class="btn ghost" onclick="closeModal()">Batal</button>
        <button class="btn" onclick="finalizeWifiConnect('${deviceId}','${escapeHtml(ssid)}')">Sambungkan</button>
      </div>
    `);
  } else {
    finalizeWifiConnect(deviceId, ssid);
  }
}
function finalizeWifiConnect(deviceId, ssid){
  const d = state.devices.find(d=>d.id===deviceId);
  if(!d) return;
  d.wifi = { ssid, connected:true };
  saveState();
  closeModal();
  wifiScan = { scanning:false, results:[] };
  toast(`Tersambung ke ${ssid}`);
  if(nav.view==='wifi-setup') renderWifiSetup();
}
function disconnectWifi(deviceId){
  if(!confirm('Putuskan koneksi Wi-Fi ini?')) return;
  const d = state.devices.find(d=>d.id===deviceId);
  d.wifi = { ssid:null, connected:false };
  saveState(); renderWifiSetup();
}

/* ================================================================
   NEW DEVICE / NEW TEMPLATE modals
   ================================================================ */
function openNewDeviceModal(){
  if(state.templates.length===0){ toast('Buat template dulu sebelum menambah device'); return; }
  openModal(`
    <h3>Device Baru</h3>
    <div class="field">
      <label>Nama Device <span class="req">*</span></label>
      <input type="text" id="dev-name" placeholder="cth: Kamar Tidur">
    </div>
    <div class="field">
      <label>Pilih Template</label>
      <select id="dev-template">
        ${state.templates.map(t=>`<option value="${t.id}">${t.icon} ${escapeHtml(t.name)}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label>Device ID (opsional)</label>
      <input type="text" id="dev-firebase-id" placeholder="cth: aB3xQz9... (dari Serial Monitor ESP32)">
      <div class="hint" style="font-size:12px;">Isi kalau device asli sudah nyala dan tercetak Device ID-nya. Kosongkan kalau masih coba-coba tampilan dulu.</div>
    </div>
    <div class="modal-actions">
      <button class="btn ghost" onclick="closeModal()">Batal</button>
      <button class="btn" onclick="saveNewDevice()">Buat Device</button>
    </div>
  `);
}
function saveNewDevice(){
  const name = document.getElementById('dev-name').value.trim();
  if(!name){ toast('Nama device wajib diisi'); return; }
  const templateId = document.getElementById('dev-template').value;
  const firebaseId = document.getElementById('dev-firebase-id').value.trim();
  const t = state.templates.find(t=>t.id===templateId);
  const values = {}, history = {};
  t.datastreams.forEach(ds=>{
    values[ds.id] = ds.default;
    if(ds.type==='Integer'||ds.type==='Double') history[ds.id] = [ds.default];
  });
  const newDevice = { id:uid('dev'), name, templateId, online:true, firebaseId: firebaseId || null, wifi:{ssid:null,connected:false}, values, history };

  function finish(){
    state.devices.push(newDevice);
    saveState(); closeModal(); goTab('devices');
    if(firebaseId) attachLiveDevice(newDevice);
    toast(firebaseId ? 'Device dibuat & terhubung ke Firebase' : 'Device dibuat');
  }

  if(firebaseId){
    // Klaim kepemilikan device ini di Firebase. Rules akan menolak
    // kalau device sudah diklaim akun lain (ownerUid sudah terisi).
    window.fbDb.ref('devices/'+firebaseId+'/ownerUid').set(currentUid)
      .then(finish)
      .catch(()=> toast('Device ID salah atau sudah dipakai akun lain'));
  } else {
    finish();
  }
}

function openNewTemplateModal(){
  openModal(`
    <h3>Template Baru</h3>
    <div class="field">
      <label>Nama Template <span class="req">*</span></label>
      <input type="text" id="tpl-name" placeholder="cth: Monitor Suhu">
    </div>
    <div class="field">
      <label>Ikon</label>
      <div class="icon-picker" id="tpl-icon-picker">
        ${TEMPLATE_ICONS.map((ic,i)=>`<div class="icon-choice ${i===0?'selected':''}" data-ic="${ic}" onclick="selectTplIcon('${ic}')">${ic}</div>`).join('')}
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn ghost" onclick="closeModal()">Batal</button>
      <button class="btn" onclick="saveNewTemplate()">Buat Template</button>
    </div>
  `);
  pendingTplIcon = TEMPLATE_ICONS[0];
}
let pendingTplIcon = TEMPLATE_ICONS[0];
function selectTplIcon(ic){
  pendingTplIcon = ic;
  document.querySelectorAll('#tpl-icon-picker .icon-choice').forEach(el=>{
    el.classList.toggle('selected', el.dataset.ic===ic);
  });
}
function saveNewTemplate(){
  const name = document.getElementById('tpl-name').value.trim();
  if(!name){ toast('Nama template wajib diisi'); return; }
  const t = { id:uid('tpl'), name, icon:pendingTplIcon, datastreams:[], widgets:[] };
  state.templates.push(t);
  saveState(); closeModal();
  templateEditorTab='datastreams';
  openTemplateEditor(t.id);
  toast('Template dibuat');
}

/* ================================================================
   Simulation loop — random-walks numeric datastreams to mimic
   live sensor data arriving from real hardware.
   ================================================================ */
setInterval(()=>{
  if(!currentUser) return;
  let touchedOpenDashboard = false;
  state.devices.forEach(d=>{
    if(d.firebaseId) return; // device asli: data datang live dari Firebase, bukan simulasi
    if(!d.online) return;
    const t = state.templates.find(t=>t.id===d.templateId);
    if(!t) return;
    t.datastreams.forEach(ds=>{
      if(ds.type!=='Integer' && ds.type!=='Double') return;
      const cur = Number(d.values[ds.id]) || ds.min;
      const range = (ds.max-ds.min) || 1;
      const step = range * 0.04 * (Math.random()-0.5) * 2;
      let next = cur + step;
      next = Math.max(ds.min, Math.min(ds.max, next));
      next = ds.type==='Integer' ? Math.round(next) : Math.round(next*10)/10;
      d.values[ds.id] = next;
      if(!d.history[ds.id]) d.history[ds.id] = [];
      d.history[ds.id].push(next);
      if(d.history[ds.id].length>20) d.history[ds.id].shift();
    });
    if(nav.view==='device-dashboard' && nav.params.deviceId===d.id) touchedOpenDashboard = true;
  });
  saveState();
  if(touchedOpenDashboard) renderDeviceDashboard();
}, 2500);

/* ================================================================
   Master render + boot
   ================================================================ */
function renderAll(){
  if(!currentUser) return;
  const views = ['devices','templates','device-dashboard','template-editor','wifi-setup','profile'];
  views.forEach(v=>{
    document.getElementById('view-'+v).classList.toggle('hidden', v!==nav.view);
  });
  document.getElementById('nav-devices').classList.toggle('active', nav.tab==='devices' && (nav.view==='devices'||nav.view==='device-dashboard'||nav.view==='wifi-setup'));
  document.getElementById('nav-templates').classList.toggle('active', nav.tab==='templates' && (nav.view==='templates'||nav.view==='template-editor'));

  const showChrome = (nav.view==='devices' || nav.view==='templates');
  document.getElementById('bottomnav').style.display = 'flex';
  document.getElementById('fab').style.display = showChrome ? 'flex' : 'none';
  document.getElementById('fab').textContent = '+';
  document.getElementById('fab').onclick = nav.view==='devices' ? openNewDeviceModal : openNewTemplateModal;

  document.getElementById('main-topbar').style.display = showChrome ? 'flex' : 'none';
  const acctBtn = document.getElementById('account-btn');
  if(acctBtn) acctBtn.textContent = currentUser ? currentUser[0].toUpperCase() : '☺';

  if(nav.view==='devices') renderDevices();
  if(nav.view==='templates') renderTemplates();
  if(nav.view==='device-dashboard') renderDeviceDashboard();
  if(nav.view==='template-editor') renderTemplateEditor();
  if(nav.view==='wifi-setup') renderWifiSetup();
  if(nav.view==='profile') renderProfile();
}

function boot(){
  window.fbAuth.onAuthStateChanged(function(user){
    if(user){
      currentUser = user.displayName || (user.email || '').split('@')[0];
      currentUid = user.uid;
      state = loadUserState(currentUid);
      showApp();
      state.devices.forEach(attachLiveDevice);
    } else {
      currentUser = null;
      currentUid = null;
      showAuth();
    }
  });
}
boot();
