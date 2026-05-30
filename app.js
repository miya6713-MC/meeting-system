/* ============================================================
   ペーパレス会議システム — メインアプリケーション
   ============================================================ */

'use strict';

/* ───────── グローバル状態 ───────────────────────── */
const S = {
  token: null,                // Google OAuth2 アクセストークン
  fileId: null,               // 表示中ファイルID
  fileName: '',               // 表示中ファイル名
  mimeType: '',               // 表示中MIMEタイプ
  page: 1,                    // 現在ページ（PDF）
  totalPages: 1,
  pdfDoc: null,
  renderTask: null,
  scale: 1.4,
  sidebarOpen: true,
  thumbsOpen: false,
  annMode: null,              // null | 'draw' | 'sticky'
  annColor: '#e83535',
  annLineWidth: 3,
  drawings: {},               // {fileId: {page: [pathData, ...]}}
  stickies: {},               // {fileId: [{page,x,y,text,id}]}
  isPresenter: false,
  isViewer: false,
  sessionId: null,
  myId: 'dev-' + Math.random().toString(36).slice(2, 8),
  projWin: null,
  bc: null,                   // BroadcastChannel（同一端末プロジェクタ用）
  fireDb: null,               // Firebase Database
  fireRef: null,              // Firebase セッション Ref
  currentPath: [],            // 現在のフォルダパン
  thumbCache: {},             // {fileId: [ImageData or canvas]}
};

/* ───────── DOM ───────────────────────────────────── */
const $ = id => document.getElementById(id);

const UI = {
  loginScreen:    $('login-screen'),
  btnSignin:      $('btn-signin'),
  layout:         $('layout'),
  sidebar:        $('sidebar'),
  sidebarTab:     $('sidebar-tab'),
  fileTree:       $('file-tree'),
  main:           $('main'),
  viewerControls: $('viewer-controls'),
  btnPrev:        $('btn-prev'),
  btnNext:        $('btn-next'),
  pageIndicator:  $('page-indicator'),
  btnZoomIn:      $('btn-zoom-in'),
  btnZoomOut:     $('btn-zoom-out'),
  btnFit:         $('btn-fit'),
  btnThumbs:      $('btn-thumbs'),
  btnAnnList:     $('btn-ann-list'),
  btnPresenter:   $('btn-presenter'),
  btnViewer:      $('btn-viewer'),
  btnProjector:   $('btn-projector'),
  viewerWrap:     $('viewer-wrap'),
  pdfScroll:      $('pdf-scroll'),
  canvasWrap:     $('canvas-wrap'),
  pdfCanvas:      $('pdf-canvas'),
  annCanvas:      $('ann-canvas'),
  iframeViewer:   $('iframe-viewer'),
  pointerLayer:   $('pointer-layer'),
  pointerDot:     $('pointer-dot'),
  thumbPanel:     $('thumb-panel'),
  annToolbar:     $('ann-toolbar'),
  btnDraw:        $('btn-draw'),
  btnEraser:      $('btn-eraser'),
  btnSticky:      $('btn-sticky'),
  btnClearPage:   $('btn-clear-page'),
  annList:        $('ann-list'),
  annListBody:    $('ann-list-body'),
  sessionDialog:  $('session-dialog'),
  sessionInput:   $('session-input'),
  btnSessionPres: $('btn-session-pres'),
  btnSessionView: $('btn-session-view'),
  btnSessionCancel: $('btn-session-cancel'),
  badgePresenter: $('badge-presenter'),
  badgeViewer:    $('badge-viewer'),
  badgeProjector: $('badge-projector'),
  currentFileName: $('current-file-name'),
  loading:        $('loading'),
  toast:          $('toast'),
  emptyState:     $('empty-state'),
};

/* ───────── ユーティリティ ──────────────────────── */
let toastTimer = null;
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

function getMime(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const map = {
    pdf: 'application/pdf',
    mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/mp4',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ppt: 'application/vnd.ms-powerpoint',
  };
  return map[ext] || '';
}

function isPDF(mime)    { return mime === 'application/pdf'; }
function isOffice(mime) { return mime.includes('officedocument') || mime.includes('ms-'); }
function isVideo(mime)  { return mime.startsWith('video/'); }
function isGSuite(mime) { return mime.includes('google-apps'); }

/* ───────── 認証（Google Identity Services） ──── */
let tokenClient;

function initAuth() {
  // config.js が未設定の場合は案内を出して止める
  if (!CONFIG.googleClientId || CONFIG.googleClientId.startsWith('YOUR_')) {
    UI.loginScreen.querySelector('p').innerHTML =
      '<b style="color:#f85149">config.js を設定してください</b><br>' +
      'googleClientId / googleApiKey / rootFolderId を入力してから再読み込みしてください。';
    UI.btnSignin.style.display = 'none';
    return;
  }

  try {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.googleClientId,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      callback: async (resp) => {
        if (resp.error) {
          showToast('認証エラー: ' + resp.error);
          console.error('GIS error:', resp);
          return;
        }
        S.token = resp.access_token;
        UI.loginScreen.style.display = 'none';
        UI.layout.style.display = 'flex';
        loadSavedData();
        await loadTree(CONFIG.rootFolderId, UI.fileTree, 0);
      },
    });

    UI.btnSignin.addEventListener('click', () => {
      try {
        tokenClient.requestAccessToken({ prompt: 'consent' });
      } catch(e) {
        showToast('サインインエラー: ' + e.message);
        console.error(e);
      }
    });
  } catch(e) {
    UI.loginScreen.querySelector('p').innerHTML =
      '<b style="color:#f85149">初期化エラー</b><br>' + e.message;
    console.error('initAuth error:', e);
  }
}

/* ───────── ローカルデータ保存 ───────────────── */
const LS_KEYS = { drawings: 'mtg_drawings', stickies: 'mtg_stickies' };

function loadSavedData() {
  try {
    S.drawings = JSON.parse(localStorage.getItem(LS_KEYS.drawings) || '{}');
    S.stickies = JSON.parse(localStorage.getItem(LS_KEYS.stickies) || '{}');
  } catch(e) {}
}

function saveDrawings() {
  localStorage.setItem(LS_KEYS.drawings, JSON.stringify(S.drawings));
}
function saveStickies() {
  localStorage.setItem(LS_KEYS.stickies, JSON.stringify(S.stickies));
}

/* ───────── Google Drive API ─────────────────── */
async function driveGet(path) {
  const res = await fetch('https://www.googleapis.com/drive/v3/' + path, {
    headers: { Authorization: 'Bearer ' + S.token },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function listFolder(folderId) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const fields = 'files(id,name,mimeType,modifiedTime)';
  const data = await driveGet(
    `files?q=${q}&fields=${fields}&orderBy=name&pageSize=200`
  );
  return data.files || [];
}

async function fetchFileBuffer(fileId) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: 'Bearer ' + S.token } }
  );
  if (!res.ok) throw new Error('ファイル取得失敗');
  return res.arrayBuffer();
}

async function exportToPDFBuffer(fileId) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/pdf`,
    { headers: { Authorization: 'Bearer ' + S.token } }
  );
  if (!res.ok) throw new Error('PDF変換失敗');
  return res.arrayBuffer();
}

/* ───────── ファイルツリー ───────────────────── */
async function loadTree(folderId, container, depth) {
  container.innerHTML = '<div style="padding:10px 14px;color:#8b949e;font-size:12px">読み込み中…</div>';
  try {
    const files = await listFolder(folderId);
    container.innerHTML = '';
    const folders = files.filter(f => f.mimeType === 'application/vnd.google-apps.folder' || f.mimeType.includes('folder'));
    const docs    = files.filter(f => !(f.mimeType === 'application/vnd.google-apps.folder' || f.mimeType.includes('folder')));

    for (const folder of folders) {
      const wrap = document.createElement('div');
      wrap.className = 'tree-children-wrap';

      const item = document.createElement('div');
      item.className = 'tree-item';
      item.style.paddingLeft = (10 + depth * 14) + 'px';
      item.innerHTML = `<span class="ti-icon">📁</span>
        <span class="ti-name">${esc(folder.name)}</span>
        <span class="ti-chev">▶</span>`;

      const children = document.createElement('div');
      children.className = 'tree-children';
      let loaded = false;

      item.addEventListener('click', async () => {
        const open = item.classList.toggle('ti-open');
        children.classList.toggle('open', open);
        if (open && !loaded) {
          loaded = true;
          await loadTree(folder.id, children, depth + 1);
        }
      });

      wrap.appendChild(item);
      wrap.appendChild(children);
      container.appendChild(wrap);
    }

    for (const file of docs) {
      const mime = file.mimeType || getMime(file.name);
      if (!isPDF(mime) && !isOffice(mime) && !isVideo(mime) && !isGSuite(mime)) continue;

      const icon = fileIcon(mime, file.name);
      const item = document.createElement('div');
      item.className = 'tree-item';
      item.dataset.fileId = file.id;
      item.style.paddingLeft = (18 + depth * 14) + 'px';
      item.innerHTML = `<span class="ti-icon">${icon}</span>
        <span class="ti-name">${esc(file.name)}</span>`;

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
    container.innerHTML = `<div style="padding:10px 14px;color:#f85149;font-size:12px">エラー: ${e.message}</div>`;
  }
}

function fileIcon(mime, name) {
  if (isPDF(mime))  return '📄';
  if (isVideo(mime)) return '🎬';
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['doc','docx'].includes(ext) || mime.includes('word')) return '📝';
  if (['xls','xlsx'].includes(ext) || mime.includes('excel') || mime.includes('spreadsheet')) return '📊';
  if (['ppt','pptx'].includes(ext) || mime.includes('presentation')) return '📋';
  return '📎';
}

function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ───────── ファイルを開く ───────────────────── */
async function openFile(fileId, name, mime) {
  if (S.fileId === fileId) return;

  clearStickiesFromDOM();
  S.fileId = fileId;
  S.fileName = name;
  S.mimeType = mime;
  S.page = 1;
  S.pdfDoc = null;
  S.thumbCache[fileId] = null;

  UI.currentFileName.textContent = name;
  UI.emptyState.style.display = 'none';
  UI.pdfScroll.style.display = 'none';
  UI.iframeViewer.style.display = 'none';
  UI.annToolbar.style.display = 'none';
  UI.thumbPanel.classList.remove('open');
  S.thumbsOpen = false;
  UI.btnThumbs.classList.remove('active');
  clearAnnCanvas();

  showLoading('ファイルを開いています…');

  try {
    if (isPDF(mime)) {
      await openPDF(fileId);
    } else if (isOffice(mime)) {
      await openOfficeAsPDF(fileId, mime);
    } else if (isVideo(mime)) {
      openIframe(`https://drive.google.com/file/d/${fileId}/preview`);
    } else if (isGSuite(mime)) {
      openIframe(`https://drive.google.com/file/d/${fileId}/preview`);
    }
    restoreStickies();
    broadcastState();
  } catch(e) {
    showToast('エラー: ' + e.message);
  } finally {
    hideLoading();
  }
}

async function openPDF(fileId) {
  showLoading('PDFを読み込み中…');
  const buf = await fetchFileBuffer(fileId);
  S.pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
  S.totalPages = S.pdfDoc.numPages;
  S.page = 1;

  UI.pdfScroll.style.display = 'flex';
  UI.iframeViewer.style.display = 'none';

  await renderPage(S.page);
  updatePageUI();
  generateThumbnails();
}

async function openOfficeAsPDF(fileId, mime) {
  // Google GSuiteファイルはexport、Officeバイナリは直接iframeビューア
  if (mime.includes('openxmlformats') || mime.includes('ms-')) {
    // Google Drive viewer で表示
    const viewUrl = `https://drive.google.com/file/d/${fileId}/preview`;
    openIframe(viewUrl);
  } else {
    const viewUrl = `https://drive.google.com/file/d/${fileId}/preview`;
    openIframe(viewUrl);
  }
}

function openIframe(url) {
  UI.iframeViewer.src = url;
  UI.iframeViewer.style.display = 'block';
  UI.pdfScroll.style.display = 'none';
  updatePageUI();
}

/* ───────── PDFレンダリング ──────────────────── */
const pdfCtx = UI.pdfCanvas.getContext('2d');
const annCtx = UI.annCanvas.getContext('2d');

async function renderPage(pageNum) {
  if (!S.pdfDoc) return;
  if (S.renderTask) { S.renderTask.cancel(); S.renderTask = null; }

  const page = await S.pdfDoc.getPage(pageNum);
  const vp   = page.getViewport({ scale: S.scale });

  // PDFとアノテーションのキャンバスサイズを同期
  UI.pdfCanvas.width  = vp.width;
  UI.pdfCanvas.height = vp.height;
  UI.annCanvas.width  = vp.width;
  UI.annCanvas.height = vp.height;

  S.renderTask = page.render({ canvasContext: pdfCtx, viewport: vp });
  await S.renderTask.promise;
  S.renderTask = null;

  restoreDrawings();
}

function updatePageUI() {
  if (!S.pdfDoc) {
    UI.pageIndicator.textContent = '';
    UI.btnPrev.disabled = true;
    UI.btnNext.disabled = true;
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

/* ───────── ズーム ───────────────────────────── */
async function setScale(sc) {
  S.scale = Math.max(0.5, Math.min(sc, 4.0));
  if (S.pdfDoc) await renderPage(S.page);
}

function fitToWidth() {
  if (!S.pdfDoc) return;
  const availW = UI.pdfScroll.clientWidth - 48;
  if (UI.pdfCanvas.width > 0) {
    const naturalW = UI.pdfCanvas.width / S.scale;
    setScale(availW / naturalW);
  }
}

/* ───────── サムネイル ──────────────────────── */
async function generateThumbnails() {
  if (!S.pdfDoc) return;
  UI.thumbPanel.innerHTML = '';
  const thumbH = 108;

  for (let i = 1; i <= S.totalPages; i++) {
    const item = document.createElement('div');
    item.className = 'thumb-item' + (i === S.page ? ' current' : '');
    item.dataset.page = i;

    const tc = document.createElement('canvas');
    item.appendChild(tc);

    const numEl = document.createElement('div');
    numEl.className = 'thumb-num';
    numEl.textContent = i;
    item.appendChild(numEl);

    item.addEventListener('click', () => goPage(i));
    UI.thumbPanel.appendChild(item);

    // 非同期でサムネイルをレンダリング
    renderThumb(i, tc, thumbH);
  }
}

async function renderThumb(pageNum, canvas, targetH) {
  if (!S.pdfDoc) return;
  try {
    const page = await S.pdfDoc.getPage(pageNum);
    const vp0  = page.getViewport({ scale: 1 });
    const sc   = targetH / vp0.height;
    const vp   = page.getViewport({ scale: sc });
    canvas.width  = vp.width;
    canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  } catch(e) {}
}

function updateThumbHighlight() {
  UI.thumbPanel.querySelectorAll('.thumb-item').forEach(el => {
    el.classList.toggle('current', parseInt(el.dataset.page) === S.page);
  });
  // 現在ページのサムネイルを可視範囲にスクロール
  const cur = UI.thumbPanel.querySelector('.thumb-item.current');
  if (cur) cur.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
}

/* ───────── アノテーション：描画 ──────────────── */
let drawing    = false;
let drawPts    = [];
let drawColor  = '#e53935';   // 現在の色
let drawWidth  = 5;           // 現在の太さ
let drawMarker = false;       // マーカーモード（半透明）
let eraserMode = false;

// ツールボタン一覧（stopAnnMode で全解除）
const toolBtns = () => [
  document.getElementById('btn-draw'),
  document.getElementById('btn-marker'),
  document.getElementById('btn-eraser'),
  document.getElementById('btn-sticky'),
];

function setActiveTool(activeBtn) {
  toolBtns().forEach(b => b && b.classList.remove('active'));
  if (activeBtn) activeBtn.classList.add('active');
}

function startDrawMode() {
  S.annMode  = 'draw';
  eraserMode = false;
  drawMarker = false;
  UI.annCanvas.classList.add('draw-mode');
  UI.annCanvas.style.cursor = 'crosshair';
  setActiveTool(document.getElementById('btn-draw'));
}
function startMarkerMode() {
  S.annMode  = 'draw';
  eraserMode = false;
  drawMarker = true;
  UI.annCanvas.classList.add('draw-mode');
  UI.annCanvas.style.cursor = 'crosshair';
  setActiveTool(document.getElementById('btn-marker'));
}
function startEraserMode() {
  S.annMode  = 'eraser';
  eraserMode = true;
  drawMarker = false;
  UI.annCanvas.classList.add('draw-mode');
  UI.annCanvas.style.cursor = 'cell';
  setActiveTool(document.getElementById('btn-eraser'));
}
function stopAnnMode() {
  S.annMode  = null;
  eraserMode = false;
  drawMarker = false;
  UI.annCanvas.classList.remove('draw-mode');
  UI.annCanvas.style.cursor = '';
  setActiveTool(null);
}

/* カラー選択 */
function setColor(color) {
  drawColor = color;
  document.querySelectorAll('.color-dot').forEach(el => {
    el.classList.toggle('active', el.dataset.color === color);
  });
}

/* 太さ選択 */
function setSize(size) {
  drawWidth = size;
  document.querySelectorAll('.size-fab').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.size) === size);
  });
}

function canvasXY(e) {
  const rect   = UI.annCanvas.getBoundingClientRect();
  const touch  = e.touches && e.touches[0] || e.changedTouches && e.changedTouches[0];
  const clientX = touch ? touch.clientX : e.clientX;
  const clientY = touch ? touch.clientY : e.clientY;
  // Retina/高解像度ディスプレイ対応
  const scaleX = UI.annCanvas.width  / rect.width;
  const scaleY = UI.annCanvas.height / rect.height;
  return [
    (clientX - rect.left) * scaleX,
    (clientY - rect.top)  * scaleY,
  ];
}

UI.annCanvas.addEventListener('mousedown',  startDraw);
UI.annCanvas.addEventListener('touchstart', startDraw, { passive: false });
UI.annCanvas.addEventListener('mousemove',  moveDraw);
UI.annCanvas.addEventListener('touchmove',  moveDraw, { passive: false });
UI.annCanvas.addEventListener('mouseup',    endDraw);
UI.annCanvas.addEventListener('touchend',   endDraw);

function startDraw(e) {
  if (S.annMode !== 'draw' && S.annMode !== 'eraser') return;
  e.preventDefault();
  drawing = true;
  drawPts = [];
  const [x, y] = canvasXY(e);
  drawPts.push([x, y]);
}

function moveDraw(e) {
  if (!drawing) return;
  e.preventDefault();
  const [x, y] = canvasXY(e);
  drawPts.push([x, y]);

  if (eraserMode) {
    eraseAtPoint(x, y);
  } else {
    if (drawPts.length >= 2) {
      const prev = drawPts[drawPts.length - 2];
      applyStrokeStyle(annCtx, drawColor, drawWidth, drawMarker);
      annCtx.beginPath();
      annCtx.moveTo(prev[0], prev[1]);
      annCtx.lineTo(x, y);
      annCtx.stroke();
    }
  }
}

function endDraw(e) {
  if (!drawing) return;
  drawing = false;
  if (!eraserMode && drawPts.length >= 2) {
    saveDrawingPath(drawPts, drawColor, drawWidth, drawMarker);
    // マーカーはストローク完了後に再描画（半透明を正確に重ねるため）
    if (drawMarker) restoreDrawings();
  }
}

function applyStrokeStyle(ctx, color, width, isMarker) {
  if (isMarker) {
    ctx.globalAlpha    = 0.35;
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle    = color;
    ctx.lineWidth      = width * 4;   // マーカーは太め
    ctx.lineCap        = 'square';
    ctx.lineJoin       = 'square';
  } else {
    ctx.globalAlpha    = 1.0;
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle    = color;
    ctx.lineWidth      = width;
    ctx.lineCap        = 'round';
    ctx.lineJoin       = 'round';
  }
}

function eraseAtPoint(x, y) {
  const r = 18;
  annCtx.clearRect(x - r, y - r, r * 2, r * 2);
  // ストロークも削除（再描画で対応）
  removeNearbyStrokes(x, y, r);
  restoreDrawings();
}

function removeNearbyStrokes(ex, ey, r) {
  const key = S.fileId;
  const page = S.page;
  if (!S.drawings[key] || !S.drawings[key][page]) return;
  S.drawings[key][page] = S.drawings[key][page].filter(stroke => {
    return !stroke.pts.some(([px, py]) => Math.hypot(px - ex, py - ey) < r);
  });
  saveDrawings();
}

function saveDrawingPath(pts, color, width, isMarker) {
  if (!S.fileId) return;
  if (!S.drawings[S.fileId]) S.drawings[S.fileId] = {};
  if (!S.drawings[S.fileId][S.page]) S.drawings[S.fileId][S.page] = [];
  S.drawings[S.fileId][S.page].push({ pts, color, width, marker: !!isMarker });
  saveDrawings();
}

function restoreDrawings() {
  annCtx.clearRect(0, 0, UI.annCanvas.width, UI.annCanvas.height);
  const strokes = (S.drawings[S.fileId] || {})[S.page] || [];
  for (const stroke of strokes) {
    if (stroke.pts.length < 2) continue;
    applyStrokeStyle(annCtx, stroke.color || '#e53935', stroke.width || 5, stroke.marker);
    annCtx.beginPath();
    annCtx.moveTo(stroke.pts[0][0], stroke.pts[0][1]);
    for (let i = 1; i < stroke.pts.length; i++) {
      annCtx.lineTo(stroke.pts[i][0], stroke.pts[i][1]);
    }
    annCtx.stroke();
  }
  // globalAlpha をリセット
  annCtx.globalAlpha = 1.0;
  annCtx.globalCompositeOperation = 'source-over';
}

function clearAnnCanvas() {
  annCtx.clearRect(0, 0, UI.annCanvas.width, UI.annCanvas.height);
}

function clearCurrentPageDrawings() {
  if (!S.fileId) return;
  if (S.drawings[S.fileId]) delete S.drawings[S.fileId][S.page];
  saveDrawings();
  restoreDrawings();
  removeStickiesOnPage(S.page);
  showToast('このページのアノテーションを消しました');
}

/* ───────── アノテーション：付箋 ──────────────── */
let stickyDragEl = null, stickyDragOX = 0, stickyDragOY = 0;

function addSticky(x, y) {
  const id = 'sticky-' + Date.now();
  const data = { id, page: S.page, x, y, text: '' };
  if (!S.stickies[S.fileId]) S.stickies[S.fileId] = [];
  S.stickies[S.fileId].push(data);
  saveStickies();
  createStickyEl(data);
  showToast('付箋を追加しました');
}

function createStickyEl(data) {
  const el = document.createElement('div');
  el.className = 'sticky';
  el.dataset.stickyId = data.id;
  el.style.left = data.x + 'px';
  el.style.top  = data.y + 'px';
  el.innerHTML = `
    <div class="sticky-page-badge">P.${data.page}</div>
    <span class="sticky-close">✕</span>
    <textarea placeholder="メモを入力…">${esc(data.text)}</textarea>
  `;

  el.querySelector('textarea').addEventListener('input', ev => {
    data.text = ev.target.value;
    saveStickies();
  });
  el.querySelector('.sticky-close').addEventListener('click', () => {
    removeStickyById(data.id);
    el.remove();
  });

  // ドラッグ（タッチ対応）
  el.addEventListener('mousedown',  stickyDragStart);
  el.addEventListener('touchstart', stickyDragStart, { passive: false });

  UI.viewerWrap.appendChild(el);
}

function stickyDragStart(e) {
  if (e.target.tagName === 'TEXTAREA' || e.target.classList.contains('sticky-close')) return;
  e.preventDefault();
  stickyDragEl = e.currentTarget;
  const rect = stickyDragEl.getBoundingClientRect();
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const cy = e.touches ? e.touches[0].clientY : e.clientY;
  stickyDragOX = cx - rect.left;
  stickyDragOY = cy - rect.top;
}
document.addEventListener('mousemove', stickyDragMove);
document.addEventListener('touchmove', stickyDragMove, { passive: false });
document.addEventListener('mouseup',   stickyDragEnd);
document.addEventListener('touchend',  stickyDragEnd);

function stickyDragMove(e) {
  if (!stickyDragEl) return;
  e.preventDefault();
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const cy = e.touches ? e.touches[0].clientY : e.clientY;
  const wrap = UI.viewerWrap.getBoundingClientRect();
  const x = cx - wrap.left - stickyDragOX;
  const y = cy - wrap.top  - stickyDragOY;
  stickyDragEl.style.left = x + 'px';
  stickyDragEl.style.top  = y + 'px';
  // データ更新
  const id  = stickyDragEl.dataset.stickyId;
  const dat = (S.stickies[S.fileId] || []).find(s => s.id === id);
  if (dat) { dat.x = x; dat.y = y; saveStickies(); }
}
function stickyDragEnd() { stickyDragEl = null; }

function restoreStickies() {
  clearStickiesFromDOM();
  const list = (S.stickies[S.fileId] || []).filter(s => s.page === S.page);
  list.forEach(createStickyEl);
}

function clearStickiesFromDOM() {
  UI.viewerWrap.querySelectorAll('.sticky').forEach(el => el.remove());
}

function removeStickyById(id) {
  if (!S.stickies[S.fileId]) return;
  S.stickies[S.fileId] = S.stickies[S.fileId].filter(s => s.id !== id);
  saveStickies();
}

function removeStickiesOnPage(page) {
  if (!S.stickies[S.fileId]) return;
  S.stickies[S.fileId] = S.stickies[S.fileId].filter(s => s.page !== page);
  saveStickies();
  restoreStickies();
}

/* ───────── ビューアタップで全画面切替 ─────────── */
let lastTap = 0;
UI.viewerWrap.addEventListener('click', e => {
  // 付箋・アノテーションモード中は無視
  if (S.annMode) {
    if (S.annMode === 'sticky') {
      const rect = UI.viewerWrap.getBoundingClientRect();
      addSticky(e.clientX - rect.left, e.clientY - rect.top);
      stopAnnMode();
    }
    return;
  }
  // プレゼンターポインター送信
  if (S.isPresenter) {
    sendPointer(e);
    return;
  }
  // シングルタップ → サイドバー切替
  const now = Date.now();
  if (now - lastTap < 300) {
    // ダブルタップ → 全画面
    toggleSidebar(false);
  } else {
    lastTap = now;
    setTimeout(() => {
      if (Date.now() - lastTap >= 290) toggleSidebar();
    }, 310);
  }
});

/* ───────── サイドバー開閉 ──────────────────── */
function toggleSidebar(force) {
  S.sidebarOpen = force !== undefined ? force : !S.sidebarOpen;
  UI.sidebar.classList.toggle('hidden', !S.sidebarOpen);
  UI.sidebarTab.textContent = S.sidebarOpen ? '◀' : '▶';
}

UI.sidebarTab.addEventListener('click', e => {
  e.stopPropagation();
  toggleSidebar();
});

/* ───────── ページ操作 ──────────────────────── */
UI.btnPrev.addEventListener('click', () => goPage(S.page - 1));
UI.btnNext.addEventListener('click', () => goPage(S.page + 1));

// キーボード
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') goPage(S.page + 1);
  if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   goPage(S.page - 1);
});

/* ───────── ズームボタン ───────────────────── */
UI.btnZoomIn.addEventListener('click',  () => setScale(S.scale + 0.2));
UI.btnZoomOut.addEventListener('click', () => setScale(S.scale - 0.2));
UI.btnFit.addEventListener('click', fitToWidth);

/* ───────── サムネイル ─────────────────────── */
UI.btnThumbs.addEventListener('click', () => {
  S.thumbsOpen = !S.thumbsOpen;
  UI.thumbPanel.classList.toggle('open', S.thumbsOpen);
  UI.btnThumbs.classList.toggle('active', S.thumbsOpen);
});

/* ───────── アノテーションツールバー ──────────── */
// null チェック付きでイベント登録するヘルパー
function on(id, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', fn);
}

on('btn-draw', () => {
  if (S.annMode === 'draw' && !drawMarker) stopAnnMode(); else startDrawMode();
});
on('btn-marker', () => {
  if (S.annMode === 'draw' && drawMarker) stopAnnMode(); else startMarkerMode();
});
on('btn-eraser', () => {
  if (S.annMode === 'eraser') stopAnnMode(); else startEraserMode();
});
on('btn-sticky', () => {
  if (S.annMode === 'sticky') {
    stopAnnMode();
  } else {
    stopAnnMode();
    S.annMode = 'sticky';
    setActiveTool(document.getElementById('btn-sticky'));
    showToast('付箋を貼る位置をタップしてください');
  }
});
on('btn-clear-page', () => {
  if (confirm('このページのアノテーションをすべて削除しますか？')) {
    clearCurrentPageDrawings();
  }
});

/* カラー選択ボタン */
document.querySelectorAll('.color-dot').forEach(el => {
  el.addEventListener('click', () => {
    setColor(el.dataset.color);
    if (el.dataset.color === '#fdd835') {
      startMarkerMode();
    } else if (S.annMode !== 'draw' || drawMarker) {
      startDrawMode();
    }
  });
});

/* 太さ選択ボタン */
document.querySelectorAll('.size-fab').forEach(el => {
  el.addEventListener('click', () => setSize(parseInt(el.dataset.size)));
});

// 初期選択状態
setColor('#e53935');
setSize(5);

/* ───────── アノテーション一覧 ─────────────── */
UI.btnAnnList.addEventListener('click', showAnnList);
$('ann-list-close').addEventListener('click', () => UI.annList.classList.remove('open'));

function showAnnList() {
  UI.annListBody.innerHTML = '';
  const stickies  = S.stickies[S.fileId] || [];
  const drawPages = Object.keys((S.drawings[S.fileId] || {}))
    .filter(p => (S.drawings[S.fileId][p] || []).length > 0)
    .map(p => parseInt(p)).sort((a,b) => a - b);

  if (!stickies.length && !drawPages.length) {
    UI.annListBody.innerHTML = '<div style="color:#8b949e;font-size:13px;padding:12px">アノテーションなし</div>';
  } else {
    // 付箋
    stickies.sort((a,b) => a.page - b.page).forEach(s => {
      const el = document.createElement('div');
      el.className = 'ann-item';
      el.innerHTML = `<div class="ann-item-page">P.${s.page} 付箋</div>
        <div class="ann-item-text">${esc(s.text || '（空の付箋）')}</div>`;
      el.addEventListener('click', async () => {
        UI.annList.classList.remove('open');
        if (s.page !== S.page) await goPage(s.page);
      });
      UI.annListBody.appendChild(el);
    });
    // 描画ページ
    drawPages.forEach(p => {
      const el = document.createElement('div');
      el.className = 'ann-item';
      el.innerHTML = `<div class="ann-item-page">P.${p}</div>
        <div class="ann-item-text">✏️ 描画あり</div>`;
      el.addEventListener('click', async () => {
        UI.annList.classList.remove('open');
        if (p !== S.page) await goPage(p);
      });
      UI.annListBody.appendChild(el);
    });
  }
  UI.annList.classList.add('open');
}

/* ───────── プレゼンター同期 ─────────────────── */
function initBroadcastChannel() {
  if (typeof BroadcastChannel === 'undefined') return;
  S.bc = new BroadcastChannel('meeting-system');
  S.bc.onmessage = e => handleRemoteState(e.data);
}

function broadcastState() {
  const state = buildState();
  if (S.bc) S.bc.postMessage(state);
  if (S.isPresenter && S.fireRef) {
    S.fireRef.child('state').set(state);
  }
}

function buildState() {
  return {
    from: S.myId,
    fileId:   S.fileId,
    fileName: S.fileName,
    mimeType: S.mimeType,
    page:     S.page,
    ts:       Date.now(),
  };
}

async function handleRemoteState(data) {
  if (!data || data.from === S.myId) return;
  if (S.isPresenter) return; // プレゼンターは受信しない

  if (data.fileId && data.fileId !== S.fileId) {
    // ツリーのactive表示は省略（fileIdで合わせる）
    await openFile(data.fileId, data.fileName || '', data.mimeType || '');
  } else if (data.page && data.page !== S.page && S.pdfDoc) {
    await goPage(data.page);
  }
}

function sendPointer(e) {
  const rect = UI.viewerWrap.getBoundingClientRect();
  const px = (e.clientX - rect.left) / rect.width;
  const py = (e.clientY - rect.top)  / rect.height;
  const msg = { from: S.myId, pointer: { x: px, y: py, active: true } };
  if (S.bc) S.bc.postMessage(msg);
  if (S.fireRef) S.fireRef.child('pointer').set({ x: px, y: py, active: true, ts: Date.now() });
  // 自分の画面にも表示
  showPointerAt(px, py);
}

function showPointerAt(rx, ry) {
  const rect = UI.viewerWrap.getBoundingClientRect();
  UI.pointerDot.style.display = 'block';
  UI.pointerDot.style.left = (rx * rect.width)  + 'px';
  UI.pointerDot.style.top  = (ry * rect.height) + 'px';
  clearTimeout(UI.pointerDot._timer);
  UI.pointerDot._timer = setTimeout(() => {
    UI.pointerDot.style.display = 'none';
  }, 3000);
}

/* ───────── セッション管理（Firebase） ──────── */
UI.btnPresenter.addEventListener('click', () => {
  if (S.isPresenter) {
    leaveSession();
  } else {
    UI.sessionDialog.classList.add('open');
    UI.sessionInput.value = S.sessionId || 'ROOM-A';
  }
});

UI.btnViewer.addEventListener('click', () => {
  if (S.isViewer) {
    leaveSession();
  } else {
    UI.sessionDialog.classList.add('open');
    UI.sessionInput.value = S.sessionId || 'ROOM-A';
  }
});

UI.btnSessionPres.addEventListener('click', () => joinSession(true));
UI.btnSessionView.addEventListener('click', () => joinSession(false));
UI.btnSessionCancel.addEventListener('click', () => UI.sessionDialog.classList.remove('open'));

async function joinSession(asPresenter) {
  const room = UI.sessionInput.value.trim().toUpperCase();
  if (!room) return;
  S.sessionId = room;
  UI.sessionDialog.classList.remove('open');
  leaveSession(true); // 現在のセッションを抜ける

  if (CONFIG.firebase.enabled && S.fireDb) {
    S.fireRef = S.fireDb.ref('sessions/' + room);
    if (asPresenter) {
      S.fireRef.child('presenter').set(S.myId);
    } else {
      // 状態を監視
      S.fireRef.child('state').on('value', snap => {
        const val = snap.val();
        if (val) handleRemoteState(val);
      });
      S.fireRef.child('pointer').on('value', snap => {
        const val = snap.val();
        if (val && val.active) showPointerAt(val.x, val.y);
      });
    }
  }

  S.isPresenter = asPresenter;
  S.isViewer    = !asPresenter;

  UI.badgePresenter.style.display = asPresenter ? 'block' : 'none';
  UI.badgeViewer.style.display    = !asPresenter ? 'block' : 'none';
  UI.btnPresenter.classList.toggle('active', asPresenter);
  UI.btnViewer.classList.toggle('active', !asPresenter);

  showToast(asPresenter ? `プレゼンター（${room}）` : `ビューワー（${room}）に接続`);
}

function leaveSession(silent = false) {
  if (S.fireRef) {
    S.fireRef.off();
    S.fireRef = null;
  }
  S.isPresenter = false;
  S.isViewer    = false;
  UI.badgePresenter.style.display = 'none';
  UI.badgeViewer.style.display    = 'none';
  UI.btnPresenter.classList.remove('active');
  UI.btnViewer.classList.remove('active');
  UI.pointerDot.style.display = 'none';
  if (!silent) showToast('セッションを終了しました');
}

/* ───────── プロジェクタ出力 ──────────────────── */
UI.btnProjector.addEventListener('click', () => {
  if (S.projWin && !S.projWin.closed) {
    S.projWin.close();
    S.projWin = null;
    UI.badgeProjector.style.display = 'none';
    UI.btnProjector.classList.remove('active');
    showToast('プロジェクタを閉じました');
  } else {
    S.projWin = window.open('projector.html', 'projector',
      'width=1280,height=720,menubar=no,toolbar=no');
    UI.badgeProjector.style.display = 'block';
    UI.btnProjector.classList.add('active');
    showToast('プロジェクタウィンドウを開きました');
    // 少し待ってから現在の状態を送信
    setTimeout(() => broadcastState(), 1000);
  }
});

/* ───────── Firebase 初期化 ─────────────────── */
function initFirebase() {
  if (!CONFIG.firebase.enabled) return;
  try {
    firebase.initializeApp(CONFIG.firebase);
    S.fireDb = firebase.database();
  } catch(e) {
    console.warn('Firebase初期化失敗:', e);
  }
}

/* ───────── PDF.js 初期化 ────────────────────── */
function initPDFJS() {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

/* ───────── アプリ起動 ───────────────────────── */
// appReady フラグ: GIS が app.js より先に onload した場合に備える
let appReady = false;

window.addEventListener('load', () => {
  document.title = CONFIG.appName;
  $('app-title').textContent = CONFIG.appName;

  initPDFJS();
  initBroadcastChannel();
  initFirebase();

  appReady = true;

  // GIS がすでに onload 済みなら即 initAuth、まだなら onGISReady() が呼ぶ
  if (window._gisReady) {
    initAuth();
  }
});
