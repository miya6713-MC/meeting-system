// ============================================================
// 設定ファイル
// ============================================================
const CONFIG = {

  // Google Drive API キー
  googleApiKey: 'AIzaSyDsgG7e1UPCLsUhNp3gvWCdcizCeuflMlk',

  // Google OAuth クライアントID（Drive ファイルアクセス用・ログインとは別）
  googleClientId: '909499919743-4btuh6s1runnotl409ssq0evcjt2drl8.apps.googleusercontent.com',

  // アプリ表示名
  appName: '船橋市医師会 会議システム',

  // 初期管理者アカウント（管理画面から変更可能）
  defaultAdminId:   'admin',
  defaultAdminPass: 'admin1234',

  // Firebase（発表者同期用・不要なら enabled: false のまま）
  firebase: {
    enabled: false,
    apiKey: '', authDomain: '', databaseURL: '',
    projectId: '', storageBucket: '', messagingSenderId: '', appId: '',
  },
};
