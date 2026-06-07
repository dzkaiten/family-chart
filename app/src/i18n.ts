import type { LanguageCode } from './config';
import { getLanguage } from './lang';

// UI string translations. Names are handled separately (lang.ts); this is the
// app chrome: header, auth screens, form labels, buttons, tooltips, toasts.
type Dict = Record<LanguageCode, string>;

const T = {
  // Header
  appTitle:        { en: 'Family Tree',   'zh-Hans': '家族树',   'zh-Hant': '家族樹' },
  pending:         { en: 'Pending',       'zh-Hans': '待处理',   'zh-Hant': '待處理' },
  downloadJson:    { en: 'Download JSON', 'zh-Hans': '下载 JSON', 'zh-Hant': '下載 JSON' },
  downloadPng:     { en: 'Download PNG',  'zh-Hans': '下载 PNG',  'zh-Hant': '下載 PNG' },
  logout:          { en: 'Log out',       'zh-Hans': '登出',     'zh-Hant': '登出' },

  // Login screen
  signIn:          { en: 'Sign in',       'zh-Hans': '登录',     'zh-Hant': '登入' },
  signInDesc:      { en: 'Enter your email to receive a magic sign-in link. You must be on the allowlist to view or edit the family tree.', 'zh-Hans': '输入邮箱以接收登录链接。您必须在白名单中才能查看或编辑家族树。', 'zh-Hant': '輸入電郵以接收登入連結。您必須在白名單中才能檢視或編輯家族樹。' },
  email:           { en: 'Email',         'zh-Hans': '邮箱',     'zh-Hant': '電郵' },
  sendMagicLink:   { en: 'Send magic link', 'zh-Hans': '发送登录链接', 'zh-Hant': '發送登入連結' },
  sentCheckInbox:  { en: 'Sent — check your inbox', 'zh-Hans': '已发送 — 请查收邮箱', 'zh-Hant': '已發送 — 請查收信箱' },
  requestAccess:   { en: 'Request access', 'zh-Hans': '申请访问', 'zh-Hant': '申請存取' },

  // Request-access screen
  requestDesc:     { en: 'The tree owner will see your request and can approve it from inside the app. Once approved, sign in with the email below.', 'zh-Hans': '家族树的所有者会看到您的申请并可在应用内批准。批准后，使用以下邮箱登录。', 'zh-Hant': '家族樹的擁有者會看到您的申請並可在應用內批准。批准後，使用以下電郵登入。' },
  yourName:        { en: 'Your name',     'zh-Hans': '您的姓名', 'zh-Hant': '您的姓名' },
  submitRequest:   { en: 'Submit request', 'zh-Hans': '提交申请', 'zh-Hant': '提交申請' },
  back:            { en: 'Back',          'zh-Hans': '返回',     'zh-Hant': '返回' },
  requestSubmitted:{ en: 'Request submitted', 'zh-Hans': '申请已提交', 'zh-Hant': '申請已提交' },
  requestThanks:   { en: 'Thanks! Once approved, sign in with {x}.', 'zh-Hans': '谢谢！批准后，请使用 {x} 登录。', 'zh-Hant': '謝謝！批准後，請使用 {x} 登入。' },

  // Pending (signed in, not allowlisted)
  awaitingApproval:{ en: 'Awaiting approval', 'zh-Hans': '等待批准', 'zh-Hant': '等待批准' },
  awaitingDesc:    { en: "You're signed in as {x}, but you're not on the allowlist yet. Submit a request below.", 'zh-Hans': '您已以 {x} 登录，但尚未加入白名单。请在下方提交申请。', 'zh-Hant': '您已以 {x} 登入，但尚未加入白名單。請在下方提交申請。' },
  submitAccessRequest: { en: 'Submit access request', 'zh-Hans': '提交访问申请', 'zh-Hant': '提交存取申請' },

  // Person form
  firstName:       { en: 'First name',    'zh-Hans': '名字',     'zh-Hant': '名字' },
  lastName:        { en: 'Last name',     'zh-Hans': '姓氏',     'zh-Hant': '姓氏' },
  chineseName:     { en: 'Chinese name (optional)', 'zh-Hans': '中文名（可选）', 'zh-Hant': '中文名（可選）' },
  birthday:        { en: 'Birthday',      'zh-Hans': '生日',     'zh-Hant': '生日' },
  profilePhoto:    { en: 'Profile photo', 'zh-Hans': '照片',     'zh-Hant': '照片' },
  addRelative:     { en: 'Add relative',  'zh-Hans': '添加亲属', 'zh-Hant': '新增親屬' },
  cancel:          { en: 'Cancel',        'zh-Hans': '取消',     'zh-Hant': '取消' },
  submit:          { en: 'Submit',        'zh-Hans': '提交',     'zh-Hant': '提交' },
  del:             { en: 'Delete',        'zh-Hans': '删除',     'zh-Hant': '刪除' },
  removeRelation:  { en: 'Remove Relation', 'zh-Hans': '移除关系', 'zh-Hant': '移除關係' },
  male:            { en: 'Male',          'zh-Hans': '男',       'zh-Hant': '男' },
  female:          { en: 'Female',        'zh-Hans': '女',       'zh-Hant': '女' },

  // Tooltips
  removeRelationship: { en: 'Remove this relationship', 'zh-Hans': '移除此关系', 'zh-Hant': '移除此關係' },
  deletePerson:    { en: 'Delete person', 'zh-Hans': '删除此人', 'zh-Hant': '刪除此人' },
  close:           { en: 'Close',         'zh-Hans': '关闭',     'zh-Hant': '關閉' },

  // Photo
  clickFullSize:   { en: 'Click to view full size', 'zh-Hans': '点击查看原图', 'zh-Hant': '點擊查看原圖' },
  photoUploaded:   { en: 'Photo uploaded. Save to apply.', 'zh-Hans': '照片已上传，保存后生效。', 'zh-Hant': '照片已上傳，儲存後生效。' },

  // Toasts
  enterEmail:      { en: 'Enter an email address', 'zh-Hans': '请输入邮箱地址', 'zh-Hant': '請輸入電郵地址' },
  enterNameEmail:  { en: 'Please enter both name and email', 'zh-Hans': '请输入姓名和邮箱', 'zh-Hant': '請輸入姓名和電郵' },
  someoneUpdated:  { en: 'Someone else updated the tree. Refreshing…', 'zh-Hans': '有人更新了家族树，正在刷新…', 'zh-Hant': '有人更新了家族樹，正在重新整理…' },
  saveFailed:      { en: 'Save failed: {x}', 'zh-Hans': '保存失败：{x}', 'zh-Hant': '儲存失敗：{x}' },
  uploadFailed:    { en: 'Upload failed: {x}', 'zh-Hans': '上传失败：{x}', 'zh-Hant': '上傳失敗：{x}' }
} satisfies Record<string, Dict>;

export type I18nKey = keyof typeof T;

export function t(key: I18nKey): string {
  const entry = T[key];
  return entry[getLanguage()] ?? entry.en;
}
