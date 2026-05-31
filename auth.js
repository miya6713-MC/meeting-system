/* ============================================================
   認証モジュール — ID/パスワード管理
   ============================================================ */
'use strict';

const AUTH = (() => {
  const LS = {
    users:   'mtg_users',    // [{id, pass}]
    adminId: 'mtg_admin_id',
    adminPw: 'mtg_admin_pw',
    session: 'mtg_session',  // {role:'admin'|'user', id, exp}
    folder:  'mtg_folder',   // {id, name, url}
  };

  /* ── ストレージ操作 ── */
  const load  = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const save  = (k,v) => localStorage.setItem(k, JSON.stringify(v));

  /* ── 管理者情報（初期値は config.js） ── */
  function getAdminId() { return localStorage.getItem(LS.adminId) || CONFIG.defaultAdminId; }
  function getAdminPw() { return localStorage.getItem(LS.adminPw) || CONFIG.defaultAdminPass; }

  /* ── ユーザー一覧 ── */
  function getUsers() { return load(LS.users) || []; }
  function saveUsers(users) { save(LS.users, users); }

  /* ── ログイン検証 ── */
  function verify(id, pass) {
    if (id === getAdminId() && pass === getAdminPw()) return 'admin';
    const users = getUsers();
    if (users.some(u => u.id === id && u.pass === pass)) return 'user';
    return null;
  }

  /* ── セッション管理（8時間） ── */
  function createSession(role, id) {
    save(LS.session, { role, id, exp: Date.now() + 8 * 60 * 60 * 1000 });
  }
  function getSession() {
    const s = load(LS.session);
    if (!s || s.exp < Date.now()) { clearSession(); return null; }
    return s;
  }
  function clearSession() { localStorage.removeItem(LS.session); }

  /* ── フォルダ設定 ── */
  function getFolder() { return load(LS.folder) || { id: '', name: '', url: '' }; }
  function setFolder(url) {
    // Google Drive フォルダURLからIDを抽出
    // https://drive.google.com/drive/folders/FOLDER_ID
    // https://drive.google.com/drive/u/0/folders/FOLDER_ID
    const m = url.match(/folders\/([a-zA-Z0-9_-]+)/);
    const id = m ? m[1] : url.trim();
    save(LS.folder, { id, url });
    return id;
  }

  /* ── 管理者操作 ── */
  function changeAdminId(newId) { localStorage.setItem(LS.adminId, newId); }
  function changeAdminPw(newPw) { localStorage.setItem(LS.adminPw, newPw); }

  function addUser(id, pass) {
    const users = getUsers();
    if (users.some(u => u.id === id)) return false;
    users.push({ id, pass });
    saveUsers(users);
    return true;
  }
  function removeUser(id) {
    saveUsers(getUsers().filter(u => u.id !== id));
  }
  function changeUserPass(id, pass) {
    const users = getUsers();
    const u = users.find(u => u.id === id);
    if (u) { u.pass = pass; saveUsers(users); return true; }
    return false;
  }

  return {
    verify, createSession, getSession, clearSession,
    getFolder, setFolder, getAdminId, getAdminPw,
    changeAdminId, changeAdminPw,
    getUsers, addUser, removeUser, changeUserPass,
  };
})();
