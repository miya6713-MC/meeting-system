/* ============================================================
   ペーパレス会議システム — メインアプリ
   ============================================================ */
'use strict';

const S = {
  allFiles: [],              // 全ファイル（検索用）: {id, name, mimeType, icon, text}
  indexing: false,           // インデックス作成中フラグ
  indexDone: 0, indexTotal: 0,
  fileId: null, fileName: '', mimeType: '',
  sidebarOpen: true, thumbsOpen: false,
  isPresenter: false, isViewer: false, sessionId: null,
  myId: 'dev-' + Math.random().toString(36).slice(2, 8),
  projWin: null, projMonitor: null,
  bc: null, fireDb: null, fireRef: null,
};

const $ = id => document.getElementById(id);
const UI = {
  loginScreen:     $('login-screen'),
  btnLogin:        $('btn-login'),
  loginId:         $('login-id'),
  loginPass:       $('login-pass'),
  loginError:      $('login-error'),
  header:          $('header'),
  layout:          $('layout'),
  sidebar:         $('sidebar'),
  sidebarTab:      $('sidebar-tab'),
  fileTree:        $('file-tree'),
  btnRefresh:      $('btn-refresh'),
  btnSidebarToggle:$('btn-sidebar-toggle'),
  btnSearchToggle: $('btn-search-toggle'),
  searchBar:       $('search-bar'),
  searchInput:     $('search-input'),
  btnSearchClear:  $('btn-search-clear'),
  searchResults:   $('search-results'),
  btnThumbs:       $('btn-thumbs'),
  pageIndicator:   $('page-indicator'),
  viewerWrap:      $('viewer-wrap'),
  iframeViewer:    $('iframe-viewer'),
  pointerLayer:    $('pointer-layer'),
  pointerDot:      $('pointer-dot'),
  thumbPanel:      $('thumb-panel'),
  sessionDialog:   $('session-dialog'),
  sessionInput:    $('session-input'),
  btnSessionPres:  $('btn-session-pres'),
  btnSessionView:  $('btn-session-view'),
  btnSessionCancel:$('btn-session-cancel'),
  btnPresenter:    $('btn-presenter'),
  btnViewer:       $('btn-viewer'),
  btnProjector:    $('btn-projector'),
  btnLogout:       $('btn-logout'),
  badgePresenter:  $('badge-presenter'),
  badgeViewer:     $('badge-viewer'),
  badgeProjector:  $('badge-projector'),
  currentFileName: $('current-file-name'),
  loading:         $('loading'),
  toast:           $('toast'),
  emptyState:      $('empty-state'),
};

/* ── ユーティリティ ── */
let toastTimer;
function showToast(msg, dur = 2500) {
  UI.toast.textContent = msg;
  UI.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => UI.toast.classList.remove('show'), dur);
}
function showLoading() { UI.loading.classList.add('show'); }
function hideLoading() { UI.loading.classList.remove('show'); }
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
const getMime = name => {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return {
    pdf:'application/pdf', mp4:'video/mp4', mov:'video/quicktime', m4v:'video/mp4',
    docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc:'application/msword',
    xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls:'application/vnd.ms-excel',
    pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ppt:'application/vnd.ms-powerpoint',
  }[ext] || '';
};
const isFolder = m => m.includes('folder');
const isVideo  = m => m.startsWith('video/');
const isPDF    = m => m === 'application/pdf';

/* ── ログイン ── */
function startApp() {
  UI.loginScreen.style.display = 'none';
  UI.header.style.display      = 'flex';
  UI.layout.style.display      = 'flex';
  document.title = CONFIG.appName;
  $('app-title-bar').textContent = CONFIG.appName;
  $('login-title').textContent   = CONFIG.appName;
  initBroadcastChannel();
  initFirebase();
  UI.btnSidebarToggle.classList.add('active'); // 初期状態はサイドバー表示
  // PDF.js 初期化（本文抽出用）
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  const folder = AUTH.getFolder();
  if (folder.id) {
    loadTree(folder.id, UI.fileTree, 0);
    // バックグラウンドで全文インデックスを構築
    buildIndex(folder.id);
  } else {
    UI.fileTree.innerHTML =
      '<div style="padding:12px 14px;font-size:12px;color:#f85149;">' +
      '⚠ フォルダ未設定<br>' +
      '<a href="admin.html" style="color:var(--accent)">管理画面</a>で設定してください</div>';
  }
}

UI.btnLogin.addEventListener('click', () => {
  const id   = UI.loginId.value.trim();
  const pass = UI.loginPass.value;
  const role = AUTH.verify(id, pass);
  if (role) {
    AUTH.createSession(role, id);
    startApp();
  } else {
    UI.loginError.textContent = 'IDまたはパスワードが違います';
    UI.loginPass.value = '';
    UI.loginPass.focus();
    setTimeout(() => UI.loginError.textContent = '', 3000);
  }
});
['login-id','login-pass'].forEach(id => {
  $(id).addEventListener('keydown', e => { if (e.key === 'Enter') UI.btnLogin.click(); });
});

UI.btnLogout.addEventListener('click', () => { AUTH.clearSession(); location.reload(); });
UI.btnRefresh.addEventListener('click', () => {
  const f = AUTH.getFolder();
  if (f.id) {
    loadTree(f.id, UI.fileTree, 0);
    buildIndex(f.id);
  }
});

/* ── 全文検索 ── */
let searchTimer = null;
let searchOpen  = false;

function openSearch() {
  searchOpen = true;
  UI.searchBar.style.setProperty('display', 'flex', 'important');
  UI.searchResults.style.setProperty('display', 'block', 'important');
  UI.fileTree.style.setProperty('display', 'none', 'important');
  UI.btnSearchToggle.classList.add('active');
  setTimeout(() => UI.searchInput.focus(), 80);
}

function closeSearch() {
  searchOpen = false;
  UI.searchBar.style.setProperty('display', 'none', 'important');
  UI.searchResults.style.setProperty('display', 'none', 'important');
  UI.fileTree.style.setProperty('display', 'block', 'important');
  UI.searchInput.value    = '';
  UI.searchResults.innerHTML = '';
  UI.btnSearchToggle.classList.remove('active');
  clearTimeout(searchTimer);
}

UI.btnSearchToggle.addEventListener('click', () => {
  searchOpen ? closeSearch() : openSearch();
});
UI.btnSearchClear.addEventListener('click', closeSearch);

UI.searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = UI.searchInput.value.trim();
  if (!q) { UI.searchResults.innerHTML = ''; return; }
  searchTimer = setTimeout(() => doSearch(q), 200);
});

UI.searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    clearTimeout(searchTimer);
    const q = UI.searchInput.value.trim();
    if (q) doSearch(q);
  }
  if (e.key === 'Escape') closeSearch();
});

function doSearch(query) {
  const q = query.toLowerCase();

  if (!S.allFiles.length) {
    UI.searchResults.innerHTML =
      '<div class="search-empty"><div class="spinner" style="margin:0 auto 8px;"></div>準備中…少し待ってから再度検索してください</div>';
    return;
  }

  // ファイル名 OR 本文テキストにマッチ
  const results = S.allFiles.filter(f =>
    f.name.toLowerCase().includes(q) ||
    (f.text && f.text.toLowerCase().includes(q))
  );
  renderSearchResults(results, query);
}

function renderSearchResults(files, query) {
  UI.searchResults.innerHTML = '';
  if (!files.length) {
    UI.searchResults.innerHTML =
      `<div class="search-empty">「${esc(query)}」に一致するファイルはありません</div>`;
    return;
  }

  // 件数表示
  const info = document.createElement('div');
  info.style.cssText = 'padding:6px 12px;font-size:11px;color:var(--text-muted);border-bottom:1px solid var(--border);';
  info.textContent = `${files.length} 件見つかりました`;
  UI.searchResults.appendChild(info);

  files.forEach(file => {
    const item = document.createElement('div');
    item.className = 'search-result-item' + (file.id === S.fileId ? ' active' : '');
    item.innerHTML =
      `<span class="sr-icon">${file.icon || '📄'}</span>` +
      `<span class="sr-name" title="${esc(file.name)}">${highlight(esc(file.name), query)}</span>`;

    item.addEventListener('click', () => {
      UI.searchResults.querySelectorAll('.search-result-item')
        .forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      openFile(file.id, file.name, file.mimeType);
    });
    UI.searchResults.appendChild(item);
  });
}

// 検索キーワードをハイライト
function highlight(text, query) {
  const re = new RegExp('(' + query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')', 'gi');
  return text.replace(re, '<mark style="background:#ffd700;color:#000;border-radius:2px;">$1</mark>');
}

/* ── 検索インデックスをバックグラウンドで全再帰構築 ── */

// ① まず全ファイルを再帰列挙（ファイル名のみ・高速）
async function collectAllFiles(folderId) {
  try {
    const files = await driveListFolder(folderId);
    for (const f of files) {
      if (isFolder(f.mimeType)) {
        await collectAllFiles(f.id);
      } else {
        const mime = f.mimeType || getMime(f.name);
        if (!S.allFiles.find(x => x.id === f.id)) {
          const icon = isVideo(mime) ? '🎬'
            : mime.includes('presentation') ? '📋'
            : mime.includes('spreadsheet') || mime.includes('excel') ? '📊'
            : mime.includes('word') || mime.includes('doc') ? '📝'
            : '📄';
          S.allFiles.push({ id: f.id, name: f.name, mimeType: mime, icon, text: '' });
        }
      }
    }
  } catch(e) { /* サイレント失敗 */ }
}

// ② 各PDFの本文テキストを抽出（重い処理・逐次実行）
async function extractAllText() {
  const pdfs = S.allFiles.filter(f => isPDF(f.mimeType) && !f.text);
  S.indexTotal = pdfs.length;
  S.indexDone  = 0;
  S.indexing   = true;
  let ok = 0, ng = 0, lastErr = '';
  updateIndexStatus();

  for (const f of pdfs) {
    try {
      const buf = await fetchFileBuffer(f.id);
      const doc = await pdfjsLib.getDocument({ data: buf }).promise;
      let text = '';
      const maxPages = Math.min(doc.numPages, 30);
      for (let p = 1; p <= maxPages; p++) {
        const page = await doc.getPage(p);
        const tc   = await page.getTextContent();
        text += tc.items.map(i => i.str).join(' ') + ' ';
      }
      f.text = text || ' ';
      ok++;
    } catch(e) {
      f.text = '';
      ng++;
      lastErr = e.message;
    }
    S.indexDone++;
    updateIndexStatus();
  }
  S.indexing = false;
  updateIndexStatus();

  // 結果を通知
  if (ng > 0 && ok === 0) {
    showToast(`⚠ 本文の読み込みに全て失敗（${ng}件）: ${lastErr}`, 6000);
  } else if (ng > 0) {
    showToast(`本文索引: 成功${ok}件 / 失敗${ng}件`, 4000);
  } else if (ok > 0) {
    showToast(`✅ ${ok}件の本文を索引しました。全文検索が可能です`, 3500);
  }
}

function updateIndexStatus() {
  const el = document.getElementById('index-status');
  if (!el) return;
  if (S.indexing) {
    el.style.display = 'block';
    el.textContent = `🔍 本文を読み込み中… ${S.indexDone}/${S.indexTotal}`;
  } else {
    el.style.display = 'none';
  }
}

// ③ 統合インデックス構築
async function buildIndex(folderId) {
  S.allFiles = [];
  await collectAllFiles(folderId);  // ファイル名を即座に揃える
  const pdfCount = S.allFiles.filter(f => isPDF(f.mimeType)).length;
  // デバッグ: 最初の3件の実際のmimeTypeを表示
  const sample = S.allFiles.slice(0, 3).map(f => `${f.name}=[${f.mimeType}]`).join(' / ');
  showToast(`全${S.allFiles.length}件/PDF${pdfCount}件 例: ${sample}`, 9000);
  extractAllText();                 // 本文抽出はバックグラウンド（awaitしない）
}

// Drive ファイルをダウンロード（APIキー・公開ファイル）
async function fetchFileBuffer(fileId) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${CONFIG.googleApiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('DL失敗');
  return res.arrayBuffer();
}

/* ── Google Drive API（APIキー使用・公開フォルダのみ） ── */
async function driveListFolder(folderId) {
  const q   = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}` +
              `&fields=files(id,name,mimeType)&orderBy=name&pageSize=200` +
              `&key=${CONFIG.googleApiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('フォルダ一覧の取得に失敗 — Driveフォルダを「リンクを知っている全員が閲覧可」に設定してください');
  return (await res.json()).files || [];
}

/* ── ファイルツリー ── */
async function loadTree(folderId, container, depth) {
  container.innerHTML = '<div style="padding:10px 14px;color:#8b949e;font-size:12px">読み込み中…</div>';
  try {
    const files   = await driveListFolder(folderId);
    container.innerHTML = '';
    const folders = files.filter(f => isFolder(f.mimeType));
    const docs    = files.filter(f => !isFolder(f.mimeType));

    for (const folder of folders) {
      const wrap = document.createElement('div');
      const item = document.createElement('div');
      item.className = 'tree-item';
      item.style.paddingLeft = (10 + depth * 14) + 'px';
      item.innerHTML =
        `<span class="ti-icon">📁</span>` +
        `<span class="ti-name">${esc(folder.name)}</span>` +
        `<span class="ti-chev">▶</span>`;
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
      const icon = isVideo(mime) ? '🎬'
        : mime.includes('presentation') ? '📋'
        : mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('xls') ? '📊'
        : mime.includes('word') || mime.includes('doc') ? '📝'
        : '📄';

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

/* ── ファイルを開く（全てiframe） ── */
function openFile(fileId, name, mime) {
  if (S.fileId === fileId) return;
  S.fileId = fileId; S.fileName = name; S.mimeType = mime;

  UI.currentFileName.textContent = name;
  UI.emptyState.style.display    = 'none';
  UI.pageIndicator.textContent   = '';
  showLoading();

  const url = `https://drive.google.com/file/d/${fileId}/preview`;
  UI.iframeViewer.src           = url;
  UI.iframeViewer.style.display = 'block';

  UI.iframeViewer.onload = () => hideLoading();
  // タイムアウト保険
  setTimeout(hideLoading, 8000);

  broadcastState();
}

/* ── ビューアタップでサイドバー切替 ── */
let lastTap = 0;
UI.viewerWrap.addEventListener('click', e => {
  if (S.isPresenter) { sendPointer(e); return; }
  const now = Date.now();
  if (now - lastTap < 300) {
    toggleSidebar(false);
  } else {
    lastTap = now;
    setTimeout(() => { if (Date.now() - lastTap >= 290) toggleSidebar(); }, 310);
  }
});

/* ── サイドバー開閉 ── */
function toggleSidebar(force) {
  S.sidebarOpen = force !== undefined ? force : !S.sidebarOpen;
  UI.sidebar.classList.toggle('hidden', !S.sidebarOpen);
  UI.sidebarTab.textContent = S.sidebarOpen ? '◀' : '▶';
  UI.btnSidebarToggle.classList.toggle('active', S.sidebarOpen);
}
UI.sidebarTab.addEventListener('click', e => { e.stopPropagation(); toggleSidebar(); });
UI.btnSidebarToggle.addEventListener('click', () => toggleSidebar());

/* ── サムネイル（ファイル一覧パネル） ── */
UI.btnThumbs.addEventListener('click', () => {
  S.thumbsOpen = !S.thumbsOpen;
  UI.thumbPanel.classList.toggle('open', S.thumbsOpen);
  UI.btnThumbs.classList.toggle('active', S.thumbsOpen);
  if (S.thumbsOpen) buildThumbPanel();
});

function buildThumbPanel() {
  // サムネイルパネルには現在開いているフォルダのファイル一覧を表示
  // （シンプルな実装：現在選択中のファイルをハイライト）
  UI.thumbPanel.innerHTML = '';
  const items = UI.fileTree.querySelectorAll('.tree-item.ti-name, .tree-item');
  const fileItems = Array.from(UI.fileTree.querySelectorAll('.tree-item[data-file-id]'));
  if (!fileItems.length) {
    UI.thumbPanel.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:0 8px;">ファイルなし</div>';
    return;
  }
  // 直接ファイルツリーのアイテムを参照してサムネイル風に表示
  fileItems.forEach(el => {
    const id   = el.dataset.fileId;
    const name = el.querySelector('.ti-name')?.textContent || '';
    const icon = el.querySelector('.ti-icon')?.textContent || '📄';
    const btn  = document.createElement('div');
    btn.className = 'thumb-item' + (id === S.fileId ? ' current' : '');
    btn.dataset.fileId = id;
    btn.innerHTML = `<div style="font-size:28px;line-height:1;">${icon}</div><div class="thumb-num">${esc(name)}</div>`;
    btn.addEventListener('click', () => {
      el.click();
      UI.thumbPanel.querySelectorAll('.thumb-item').forEach(t => t.classList.remove('current'));
      btn.classList.add('current');
    });
    UI.thumbPanel.appendChild(btn);
  });
}

/* ── プレゼンター同期 ── */
function initBroadcastChannel() {
  if (typeof BroadcastChannel === 'undefined') return;
  S.bc = new BroadcastChannel('meeting-system');
  S.bc.onmessage = e => handleRemoteState(e.data);
}
function broadcastState() {
  const st = { from: S.myId, fileId: S.fileId, fileName: S.fileName, mimeType: S.mimeType };
  if (S.bc) S.bc.postMessage(st);
  if (S.isPresenter && S.fireRef) S.fireRef.child('state').set(st);
}
async function handleRemoteState(data) {
  if (!data || data.from === S.myId || S.isPresenter) return;
  if (data.fileId && data.fileId !== S.fileId)
    openFile(data.fileId, data.fileName || '', data.mimeType || '');
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

/* ── セッション ── */
UI.btnPresenter.addEventListener('click', () => {
  if (S.isPresenter) leaveSession();
  else { UI.sessionDialog.classList.add('open'); UI.sessionInput.value = S.sessionId || 'ROOM-A'; }
});
UI.btnViewer.addEventListener('click', () => {
  if (S.isViewer) leaveSession();
  else { UI.sessionDialog.classList.add('open'); UI.sessionInput.value = S.sessionId || 'ROOM-A'; }
});
UI.btnSessionPres.addEventListener('click',    () => joinSession(true));
UI.btnSessionView.addEventListener('click',    () => joinSession(false));
UI.btnSessionCancel.addEventListener('click',  () => UI.sessionDialog.classList.remove('open'));

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
function stopProjector() {
  clearInterval(S.projMonitor); S.projMonitor = null;
  S.projWin = null;
  UI.badgeProjector.style.display = 'none';
  UI.btnProjector.classList.remove('active');
}
UI.btnProjector.addEventListener('click', () => {
  if (UI.btnProjector.classList.contains('active')) {
    if (S.projWin && !S.projWin.closed) S.projWin.close();
    stopProjector();
    showToast('プロジェクタ出力を終了しました');
    return;
  }
  S.projWin = window.open('projector.html', '', 'width=1280,height=720,menubar=no,toolbar=no,location=no');
  if (!S.projWin) { showToast('⚠ ポップアップがブロックされています', 4000); return; }
  UI.badgeProjector.style.display = 'block';
  UI.btnProjector.classList.add('active');
  showToast('プロジェクタウィンドウを開きました');
  setTimeout(() => broadcastState(), 800);
  S.projMonitor = setInterval(() => {
    if (S.projWin && S.projWin.closed) { stopProjector(); showToast('プロジェクタウィンドウが閉じられました'); }
  }, 1000);
});

/* ── Firebase ── */
function initFirebase() {
  if (!CONFIG.firebase.enabled) return;
  try { firebase.initializeApp(CONFIG.firebase); S.fireDb = firebase.database(); }
  catch(e) { console.warn('Firebase初期化失敗:', e); }
}

/* ── 起動 ── */
window.addEventListener('load', () => {
  $('login-title').textContent = CONFIG.appName;
  const session = AUTH.getSession();
  if (session) startApp();
});
