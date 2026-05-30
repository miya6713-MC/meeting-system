// ============================================================
// 設定ファイル — ここだけ編集してください
// ============================================================
const CONFIG = {

  // ① Google Cloud Console で作成した OAuth 2.0 クライアント ID
  //    https://console.cloud.google.com/ → APIとサービス → 認証情報
  googleClientId: '909499919743-4btuh6s1runnotl409ssq0evcjt2drl8.apps.googleusercontent.com',

  // ② Google Drive API キー（公開APIキー）
  googleApiKey: 'AIzaSyDsgG7e1UPCLsUhNp3gvWCdcizCeuflMlk',

  // ③ 会議資料を入れる Google Drive フォルダの ID
  //    フォルダを開いたときのURLの末尾の文字列
  //    例: https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz
  //                                               ↑ここ
  rootFolderId: '18yjwFDXIQwT9rpxSmdQv5DGnChWK4han',

  // ④ Firebase（プレゼンター同期用）— 不要なら enabled: false のまま
  //    https://console.firebase.google.com/ で Realtime Database を作成
  firebase: {
    enabled: false,
    apiKey: '',
    authDomain: '',
    databaseURL: '',   // 例: https://your-project-default-rtdb.firebaseio.com
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: '',
  },

  // ⑤ アプリ表示名
  appName: '船橋市医師会 会議システム',
};
