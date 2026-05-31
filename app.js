/* ============================================================
   ペーパレス会議システム — メインアプリ
   ============================================================ */
'use strict';

/* ── グローバル状態 ── */
const S = {
  driveToken: null,          // Google Drive OAuthトークン（バックグラウンド取得）
  fileId: null, fileName: '', mimeType: '',
  page: 1, totalPages: 1,
  pdfDoc: null, renderTask: null, scale: 1.4,
  sidebarOpen: true, thumbsOpen: false,
  isPresenter: false, isViewer: false, sessionId: null,
  myId: 'dev-' + Math.random().toString(36).slice(2, 8),
  projWin: null, bc: null, fireDb: null, fireRef: null,
};

/* ── DOM ── */
const $ = id => document.getElementById(id);
const UI = {
  loginScreen:    $('login-screen'),
  btnLogin:       $('btn-login'),
  loginId:        $('login-id'),
  loginPass:      $('login-pass'),
  loginError:     $('login-error'),
  header:         $('header'),
  layout:         $('layout'),
  sidebar:        $('sidebar'),
  sidebarTab:     $('sidebar-tab'),
  fileTree:       $('file-tree'),
  btnRefresh:     $('btn-refresh'),
  btnPrev:        $('btn-prev'),        // コントロールバー内
  btnNext:        $('btn-next'),
  pageIndicator:  $('page-indicator'),
  btnZoomIn:      $('btn-zoom-in'),
  btnZoomOut:     $('btn-zoom-out'),
  btnFit:         $('btn-fit'),
  btnThumbs:      $('btn-thumbs'),
  driveConnectBar: $('drive-connect-bar'),
  btnDriveConnect: $('btn-drive-connect'),
  viewerWrap:     $('viewer-wrap'),
  pdfScroll:      $('pdf-scroll'),
  pdfCanvas:      $('pdf-canvas'),
  iframeViewer:   $('iframe-viewer'),
  pointerLayer:   $('pointer-layer'),
  pointerDot:     $('pointer-dot'),
  thumbPanel:     $('thumb-panel'),
  sessionDialog:  $('session-dialog'),
  sessionInput:   $('session-input'),
  btnSessionPres: $('btn-session-pres'),
  btnSessionView: $('btn-session-view'),
  btnSessionCancel:$('btn-session-cancel'),
  btnPresenter:   $('btn-presenter'),
  btnViewer:      $('btn-viewer'),
  btnProjector:   $('btn-projector'),
  btnLogout:      $('btn-logout'),
  badgePresenter: $('badge-presenter'),
  badgeViewer:    $('badge-viewer'),
  badgeProjector: $('badge-projector'),
  currentFileName:$('current-file-name'),
  loading:        $('loading'),
  toast:          $('toast'),
  emptyState:     $('empty-state'),
};

/* ── ユーティリティ ── */
let toastTimer;
function showToast(msg, dur = 2500) {
  UI.toast.textContent = msg;
  UI.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => UI.toast.classList.remove('show'), dur);
}
function showLoading(msg = '読み込み中…') {
  UI.loading.querySelector('span').textContent = msg;
  UI.loading.classList.add('show');
}
function hideLoading() { UI.loading.classList.remove('show'); }
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
const getMime = name => {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return { pdf:'application/pdf', mp4:'video/mp4', mov:'video/quicktime',
    docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc:'application/msword',
    xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls:'application/vnd.ms-excel',
    pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ppt:'application/vnd.ms-powerpoint' }[ext] || '';
};
const isPDF    = m => m === 'application/pdf';
const isOffice = m => m.includes('officedocument') || m.includes('ms-') || m.includes('msword');
const isVideo  = m => m.startsWith('video/');
const isGSuite = m => m.includes('google-apps');

/* ── Google Drive OAuth（バックグラウンド・ログインとは独立） ── */
let driveTokenClient = null;

function initDriveOAuth() {
  if (!CONFIG.googleClientId || typeof google === 'undefined') return;
  try {
    driveTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.googleClientId,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      callback: resp => {
        if (resp.access_token) {
          S.driveToken = resp.access_token;
          UI.driveConnectBar.style.display = 'none';
          showToast('✅ Google Drive に接続しました。PDFのページ操作が有効です');
          // 接続後にファイルツリーを再読み込み
          const folder = AUTH.getFolder();
          if (folder.id) loadTree(folder.id, UI.fileTree, 0);
        }
      },
    });
    // 無言でトークン取得を試みる（ユーザー操作不要・過去に許可済みの場合）
    driveTokenClient.requestAccessToken({ prompt: '' });
  } catch(e) {
    console.warn('Drive OAuth初期化失敗:', e);
  }
}

function connectDrive() {
  if (!driveTokenClient) {
    showToast('⚠ Google Drive接続の設定が不完全です（config.jsを確認）', 4000);
    return;
  }
  // ユーザーに許可を求める（初回または期限切れ）
  driveTokenClient.requestAccessToken({ prompt: 'consent' });
}

/* ── 認証・ログイン ── */
function startApp(session) {
  UI.loginScreen.style.display = 'none';
  UI.header.style.display      = 'flex';
  UI.layout.style.display      = 'flex';
  document.title = CONFIG.appName;
  $('app-title-bar').textContent = CONFIG.appName;
  initPDFJS();
  initBroadcastChannel();
  initFirebase();

  // Drive接続ボタン
  UI.btnDriveConnect.addEventListener('click', connectDrive);

  // GISライブラリ読み込み後にOAuth初期化
  if (typeof google !== 'undefined' && google.accounts) {
    initDriveOAuth();
  } else {
    window.addEventListener('load', () => {
      setTimeout(initDriveOAuth, 500);
    });
  }

  const folder = AUTH.getFolder();
  if (folder.id) {
    loadTree(folder.id, UI.fileTree, 0);
  } else {
    UI.fileTree.innerHTML =
      '<div style="padding:12px 14px;font-size:12px;color:#f85149;">' +
      '⚠ フォルダ未設定<br><a href="admin.html" style="color:var(--accent)">管理画面</a>で設定してください</div>';
  }
}

/* ログイン処理 */
UI.btnLogin.addEventListener('click', () => {
  const id   = UI.loginId.value.trim();
  const pass = UI.loginPass.value;
  const role = AUTH.verify(id, pass);
  if (role) {
    AUTH.createSession(role, id);
    startApp({ role, id });
  } else {
    UI.loginError.textContent = 'IDまたはパスワードが違います';
    UI.loginPass.value = '';
    UI.loginPass.focus();
    setTimeout(() => UI.loginError.textContent = '', 3000);
  }
});

['login-id','login-pass'].forEach(id => {
  $(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') UI.btnLogin.click();
  });
});

/* ログアウト */
UI.btnLogout.addEventListener('click', () => {
  AUTH.clearSession();
  location.reload();
});

/* フォルダ更新 */
UI.btnRefresh.addEventListener('click', () => {
  const folder = AUTH.getFolder();
  if (folder.id) loadTree(folder.id, UI.fileTree, 0);
});

/* ── Google Drive API（OAuthトークン優先・なければAPIキー） ── */
function driveHeaders() {
  // OAuthトークンがあればそれを優先、なければAPIキーを使用
  if (S.driveToken) return { Authorization: 'Bearer ' + S.driveToken };
  return null; // APIキーはURLパラメータで渡す
}

function driveUrl(path) {
  const base = 'https://www.googleapis.com/drive/v3/' + path;
  return S.driveToken ? base : base + (base.includes('?') ? '&' : '?') + 'key=' + CONFIG.googleApiKey;
}

async function driveListFolder(folderId) {
  const q   = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const url = driveUrl(`files?q=${q}&fields=files(id,name,mimeType)&orderBy=name&pageSize=200`);
  const headers = driveHeaders();
  const res = await fetch(url, headers ? { headers } : {});
  if (!res.ok) {
    // 未接続の場合はDrive接続バナーを表示
    if (!S.driveToken) UI.driveConnectBar.style.display = 'block';
    throw new Error('フォルダ一覧の取得に失敗しました。「Google Drive に接続」ボタンを押してください');
  }
  UI.driveConnectBar.style.display = 'none';
  const data = await res.json();
  return data.files || [];
}

async function fetchFileBuffer(fileId) {
  const url = driveUrl(`files/${fileId}?alt=media`);
  const headers = driveHeaders();
  const res = await fetch(url, headers ? { headers } : {});
  if (!res.ok) throw new Error('ファイル取得失敗');
  return res.arrayBuffer();
}

/* ── ファイルツリー ── */
async function loadTree(folderId, container, depth) {
  container.innerHTML = '<div style="padding:10px 14px;color:#8b949e;font-size:12px">読み込み中…</div>';
  try {
    const files   = await driveListFolder(folderId);
    container.innerHTML = '';
    const folders = files.filter(f => f.mimeType.includes('folder'));
    const docs    = files.filter(f => !f.mimeType.includes('folder'));

    for (const folder of folders) {
      const wrap = document.createElement('div');
      const item = document.createElement('div');
      item.className = 'tree-item';
      item.style.paddingLeft = (10 + depth * 14) + 'px';
      item.innerHTML = `<span class="ti-icon">📁</span><span class="ti-name">${esc(folder.name)}</span><span class="ti-chev">▶</span>`;
      const children = document.createElement('div');
      children.className = 'tree-children';
      let loaded = false;
      item.addEventListener('click', async () => {
        const open = item.classList.toggle('ti-open');
        children.classList.toggle('open', open);
        if (open && !loaded) { loaded = true; await loadTree(folder.id, children, depth + 1); }
      });
      wrap.appendChild(item);
      wrap.appendChild(children);
      container.appendChild(wrap);
    }

    for (const file of docs) {
      const mime = file.mimeType || getMime(file.name);
      if (!isPDF(mime) && !isOffice(mime) && !isVideo(mime) && !isGSuite(mime)) continue;
      const icon = isPDF(mime) ? '📄' : isVideo(mime) ? '🎬' : mime.includes('presentation') ? '📋' : mime.includes('spreadsheet') || mime.includes('excel') ? '📊' : '📝';
      const item = document.createElement('div');
      item.className = 'tree-item';
      item.style.paddingLeft = (18 + depth * 14) + 'px';
      item.innerHTML = `<span class="ti-icon">${icon}</span><span class="ti-name">${esc(file.name)}</span>`;
      item.addEventListener('click', () => {
        document.querySelectorAll('.tree-item.active').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
        openFile(file.id, file.name, mime);
      });
      container.appendChild(item);
    }

    if (!container.children.length) {
      container.innerHTML = '<div style="padding:10px 14px;color:#8b949e;font-size:12px">ファイルなし</div>';
    }
  } catch(e) {
    container.innerHTML = `<div style="padding:10px 14px;color:#f85149;font-size:12px">${esc(e.message)}</div>`;
  }
}

/* ── ファイルを開く ── */
async function openFile(fileId, name, mime) {
  if (S.fileId === fileId) return;
  S.fileId = fileId; S.fileName = name; S.mimeType = mime;
  S.page = 1; S.pdfDoc = null;

  UI.currentFileName.textContent = name;
  UI.emptyState.style.display    = 'none';
  UI.pdfScroll.style.display     = 'none';
  UI.iframeViewer.style.display  = 'none';
  UI.thumbPanel.classList.remove('open');
  S.thumbsOpen = false;
  UI.btnThumbs.classList.remove('active');

  showLoading('ファイルを開いています…');
  try {
    if (isPDF(mime)) await openPDF(fileId);
    else             openIframe(`https://drive.google.com/file/d/${fileId}/preview`);
    broadcastState();
  } catch(e) {
    showToast('エラー: ' + e.message);
  } finally {
    hideLoading();
  }
}

async function openPDF(fileId) {
  showLoading('PDFを読み込み中…');
  try {
    const buf    = await fetchFileBuffer(fileId);
    S.pdfDoc     = await pdfjsLib.getDocument({ data: buf }).promise;
    S.totalPages = S.pdfDoc.numPages;
    S.page       = 1;
    UI.pdfScroll.style.display    = 'flex';
    UI.iframeViewer.style.display = 'none';
    await renderPage(S.page);
    updatePageUI();
    generateThumbnails();
  } catch(e) {
    // Drive未接続 → iframeで代替表示しつつ接続を促す
    console.warn('PDF.js読み込み失敗、iframeで代替表示:', e.message);
    openIframe(`https://drive.google.com/file/d/${fileId}/preview`);
    if (!S.driveToken) {
      UI.driveConnectBar.style.display = 'block';
      showToast('⚠ 左の「Google Drive に接続」を押すとページ操作が有効になります', 5000);
    }
  }
}

function openIframe(url) {
  UI.iframeViewer.src           = url;
  UI.iframeViewer.style.display = 'block';
  UI.pdfScroll.style.display    = 'none';
  updatePageUI();
}

/* ── PDFレンダリング ── */
const pdfCtx = UI.pdfCanvas.getContext('2d');

async function renderPage(pageNum) {
  if (!S.pdfDoc) return;
  if (S.renderTask) { S.renderTask.cancel(); S.renderTask = null; }
  const page = await S.pdfDoc.getPage(pageNum);
  const vp   = page.getViewport({ scale: S.scale });
  UI.pdfCanvas.width  = vp.width;
  UI.pdfCanvas.height = vp.height;
  S.renderTask = page.render({ canvasContext: pdfCtx, viewport: vp });
  await S.renderTask.promise;
  S.renderTask = null;
}

function updatePageUI() {
  if (!S.pdfDoc) {
    UI.pageIndicator.textContent = '';
    UI.btnPrev.disabled = UI.btnNext.disabled = true;
    return;
  }
  UI.pageIndicator.textContent = `${S.page} / ${S.totalPages}`;
  UI.btnPrev.disabled = S.page <= 1;
  UI.btnNext.disabled = S.page >= S.totalPages;
}

async function goPage(num) {
  if (!S.pdfDoc) return;
  num = Math.max(1, Math.min(num, S.totalPages));
  if (num === S.page) return;
  S.page = num;
  await renderPage(S.page);
  updatePageUI();
  updateThumbHighlight();
  broadcastState();
}

/* ── ズーム ── */
async function setScale(sc) {
  S.scale = Math.max(0.5, Math.min(sc, 4.0));
  if (S.pdfDoc) await renderPage(S.page);
}
function fitToWidth() {
  if (!S.pdfDoc || !UI.pdfCanvas.width) return;
  setScale((UI.pdfScroll.clientWidth - 48) / (UI.pdfCanvas.width / S.scale));
}

/* ── サムネイル ── */
async function generateThumbnails() {
  if (!S.pdfDoc) return;
  UI.thumbPanel.innerHTML = '';
  for (let i = 1; i <= S.totalPages; i++) {
    const item = document.createElement('div');
    item.className = 'thumb-item' + (i === S.page ? ' current' : '');
    item.dataset.page = i;
    const tc  = document.createElement('canvas');
    const num = document.createElement('div');
    num.className = 'thumb-num'; num.textContent = i;
    item.appendChild(tc); item.appendChild(num);
    item.addEventListener('click', () => goPage(i));
    UI.thumbPanel.appendChild(item);
    renderThumb(i, tc, 108);
  }
}
async function renderThumb(pageNum, canvas, targetH) {
  if (!S.pdfDoc) return;
  try {
    const page = await S.pdfDoc.getPage(pageNum);
    const vp0  = page.getViewport({ scale: 1 });
    const vp   = page.getViewport({ scale: targetH / vp0.height });
    canvas.width = vp.width; canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  } catch(e) {}
}
function updateThumbHighlight() {
  UI.thumbPanel.querySelectorAll('.thumb-item').forEach(el =>
    el.classList.toggle('current', parseInt(el.dataset.page) === S.page));
  const cur = UI.thumbPanel.querySelector('.thumb-item.current');
  if (cur) cur.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
}

/* ── ビューアタップでサイドバー切替 ── */
let lastTap = 0;
UI.viewerWrap.addEventListener('click', e => {
  if (S.isPresenter) { sendPointer(e); return; }
  const now = Date.now();
  if (now - lastTap < 300) { toggleSidebar(false); }
  else { lastTap = now; setTimeout(() => { if (Date.now() - lastTap >= 290) toggleSidebar(); }, 310); }
});

/* ── サイドバー開閉 ── */
function toggleSidebar(force) {
  S.sidebarOpen = force !== undefined ? force : !S.sidebarOpen;
  UI.sidebar.classList.toggle('hidden', !S.sidebarOpen);
  UI.sidebarTab.textContent = S.sidebarOpen ? '◀' : '▶';
}
UI.sidebarTab.addEventListener('click', e => { e.stopPropagation(); toggleSidebar(); });

/* ── ページ操作 ── */
UI.btnPrev.addEventListener('click', () => goPage(S.page - 1));
UI.btnNext.addEventListener('click', () => goPage(S.page + 1));
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') goPage(S.page + 1);
  if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   goPage(S.page - 1);
});
UI.btnZoomIn.addEventListener('click',  () => setScale(S.scale + 0.2));
UI.btnZoomOut.addEventListener('click', () => setScale(S.scale - 0.2));
UI.btnFit.addEventListener('click', fitToWidth);
UI.btnThumbs.addEventListener('click', () => {
  S.thumbsOpen = !S.thumbsOpen;
  UI.thumbPanel.classList.toggle('open', S.thumbsOpen);
  UI.btnThumbs.classList.toggle('active', S.thumbsOpen);
});

/* ── プレゼンター同期 ── */
function initBroadcastChannel() {
  if (typeof BroadcastChannel === 'undefined') return;
  S.bc = new BroadcastChannel('meeting-system');
  S.bc.onmessage = e => handleRemoteState(e.data);
}
function broadcastState() {
  const st = { from: S.myId, fileId: S.fileId, fileName: S.fileName, mimeType: S.mimeType, page: S.page };
  if (S.bc) S.bc.postMessage(st);
  if (S.isPresenter && S.fireRef) S.fireRef.child('state').set(st);
}
async function handleRemoteState(data) {
  if (!data || data.from === S.myId || S.isPresenter) return;
  if (data.fileId && data.fileId !== S.fileId)
    await openFile(data.fileId, data.fileName || '', data.mimeType || '');
  else if (data.page && data.page !== S.page && S.pdfDoc)
    await goPage(data.page);
}
function sendPointer(e) {
  const r  = UI.viewerWrap.getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width;
  const py = (e.clientY - r.top)  / r.height;
  const msg = { from: S.myId, pointer: { x: px, y: py, active: true } };
  if (S.bc) S.bc.postMessage(msg);
  if (S.fireRef) S.fireRef.child('pointer').set({ ...msg.pointer, ts: Date.now() });
  showPointerAt(px, py);
}
function showPointerAt(rx, ry) {
  const r = UI.viewerWrap.getBoundingClientRect();
  UI.pointerDot.style.display = 'block';
  UI.pointerDot.style.left    = (rx * r.width)  + 'px';
  UI.pointerDot.style.top     = (ry * r.height) + 'px';
  clearTimeout(UI.pointerDot._t);
  UI.pointerDot._t = setTimeout(() => UI.pointerDot.style.display = 'none', 3000);
}

/* ── セッション管理 ── */
UI.btnPresenter.addEventListener('click', () => {
  if (S.isPresenter) leaveSession();
  else { UI.sessionDialog.classList.add('open'); UI.sessionInput.value = S.sessionId || 'ROOM-A'; }
});
UI.btnViewer.addEventListener('click', () => {
  if (S.isViewer) leaveSession();
  else { UI.sessionDialog.classList.add('open'); UI.sessionInput.value = S.sessionId || 'ROOM-A'; }
});
UI.btnSessionPres.addEventListener('click',   () => joinSession(true));
UI.btnSessionView.addEventListener('click',   () => joinSession(false));
UI.btnSessionCancel.addEventListener('click', () => UI.sessionDialog.classList.remove('open'));

async function joinSession(asPresenter) {
  const room = UI.sessionInput.value.trim().toUpperCase();
  if (!room) return;
  S.sessionId = room;
  UI.sessionDialog.classList.remove('open');
  leaveSession(true);
  if (CONFIG.firebase.enabled && S.fireDb) {
    S.fireRef = S.fireDb.ref('sessions/' + room);
    if (asPresenter) {
      S.fireRef.child('presenter').set(S.myId);
    } else {
      S.fireRef.child('state').on('value',   snap => { const v = snap.val(); if (v) handleRemoteState(v); });
      S.fireRef.child('pointer').on('value', snap => { const v = snap.val(); if (v?.active) showPointerAt(v.x, v.y); });
    }
  }
  S.isPresenter = asPresenter; S.isViewer = !asPresenter;
  UI.badgePresenter.style.display = asPresenter ? 'block' : 'none';
  UI.badgeViewer.style.display    = !asPresenter ? 'block' : 'none';
  UI.btnPresenter.classList.toggle('active', asPresenter);
  UI.btnViewer.classList.toggle('active', !asPresenter);
  showToast(asPresenter ? `発表者（${room}）` : `視聴者（${room}）に接続`);
}
function leaveSession(silent = false) {
  if (S.fireRef) { S.fireRef.off(); S.fireRef = null; }
  S.isPresenter = S.isViewer = false;
  UI.badgePresenter.style.display = UI.badgeViewer.style.display = 'none';
  UI.btnPresenter.classList.remove('active');
  UI.btnViewer.classList.remove('active');
  UI.pointerDot.style.display = 'none';
  if (!silent) showToast('セッションを終了しました');
}

/* ── プロジェクタ出力 ── */
let projMonitor = null;  // ウィンドウ監視タイマー

function stopProjector() {
  clearInterval(projMonitor);
  projMonitor = null;
  S.projWin = null;
  UI.badgeProjector.style.display = 'none';
  UI.btnProjector.classList.remove('active');
}

UI.btnProjector.addEventListener('click', () => {
  // ボタンがアクティブ（緑）= 出力中 → 終了
  if (UI.btnProjector.classList.contains('active')) {
    if (S.projWin && !S.projWin.closed) S.projWin.close();
    stopProjector();
    showToast('プロジェクタ出力を終了しました');
    return;
  }

  // 非アクティブ → 新しいウィンドウを開く
  S.projWin = window.open('projector.html', '', 'width=1280,height=720,menubar=no,toolbar=no,location=no');
  if (!S.projWin) {
    showToast('⚠ ポップアップがブロックされました。ブラウザの設定を確認してください', 4000);
    return;
  }

  UI.badgeProjector.style.display = 'block';
  UI.btnProjector.classList.add('active');
  showToast('プロジェクタウィンドウを開きました');
  setTimeout(() => broadcastState(), 800);

  // ウィンドウが手動で閉じられても自動検知してリセット
  clearInterval(projMonitor);
  projMonitor = setInterval(() => {
    if (S.projWin && S.projWin.closed) {
      stopProjector();
      showToast('プロジェクタウィンドウが閉じられました');
    }
  }, 1000);
});

/* ── Firebase ── */
function initFirebase() {
  if (!CONFIG.firebase.enabled) return;
  try { firebase.initializeApp(CONFIG.firebase); S.fireDb = firebase.database(); }
  catch(e) { console.warn('Firebase初期化失敗:', e); }
}

/* ── PDF.js ── */
function initPDFJS() {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

/* ── 起動（セッションチェック） ── */
window.addEventListener('load', () => {
  const session = AUTH.getSession();
  if (session) {
    startApp(session);
  }
  // ログイン画面にアプリ名を表示
  const t = document.querySelector('#login-screen h1');
  if (t) t.textContent = CONFIG.appName;
});
