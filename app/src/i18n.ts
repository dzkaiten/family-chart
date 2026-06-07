import type { LanguageCode } from './config';
import { getLanguage } from './lang';

// UI string translations. Names are handled separately (lang.ts); this is the
// app chrome: header, auth screens, form labels, buttons, tooltips, toasts.
type Dict = Record<LanguageCode, string>;

const T = {
  // Header
  appTitle:        { en: 'Family Chart',  'zh-Hans': '家族图',   'zh-Hant': '家族圖' },
  downloadJson:    { en: 'Download JSON', 'zh-Hans': '下载 JSON', 'zh-Hant': '下載 JSON' },
  downloadPng:     { en: 'Download PNG',  'zh-Hans': '下载 PNG',  'zh-Hant': '下載 PNG' },
  logout:          { en: 'Log out',       'zh-Hans': '登出',     'zh-Hant': '登出' },

  // Login screen
  signIn:          { en: 'Sign in',       'zh-Hans': '登录',     'zh-Hant': '登入' },
  signInDesc:      { en: 'Enter the family password to view and edit the family chart.', 'zh-Hans': '输入家族密码以查看和编辑家族图。', 'zh-Hant': '輸入家族密碼以檢視和編輯家族圖。' },
  email:           { en: 'Email',         'zh-Hans': '邮箱',     'zh-Hant': '電郵' },
  password:        { en: 'Password',      'zh-Hans': '密码',     'zh-Hant': '密碼' },
  enterEmailPassword: { en: 'Enter email and password', 'zh-Hans': '请输入邮箱和密码', 'zh-Hant': '請輸入電郵和密碼' },
  signInFailed:    { en: 'Sign in failed: {x}', 'zh-Hans': '登录失败：{x}', 'zh-Hant': '登入失敗：{x}' },
  notAuthorized:   { en: 'This account is not authorized for this tree.', 'zh-Hans': '此账户无权访问此家族树。', 'zh-Hant': '此帳戶無權存取此家族樹。' },

  // Person form
  firstName:       { en: 'First name',    'zh-Hans': '名字',     'zh-Hant': '名字' },
  lastName:        { en: 'Last name',     'zh-Hans': '姓氏',     'zh-Hant': '姓氏' },
  chineseName:     { en: 'Chinese name (optional)', 'zh-Hans': '中文名（可选）', 'zh-Hant': '中文名（可選）' },
  birthday:        { en: 'Birthday',      'zh-Hans': '生日',     'zh-Hant': '生日' },
  profilePhoto:    { en: 'Profile photo', 'zh-Hans': '照片',     'zh-Hant': '照片' },
  choosePhoto:     { en: 'Choose photo',  'zh-Hans': '选择照片', 'zh-Hant': '選擇照片' },
  noPhotoChosen:   { en: 'No photo chosen', 'zh-Hans': '未选择照片', 'zh-Hant': '未選擇照片' },
  edit:            { en: 'Edit',          'zh-Hans': '编辑',     'zh-Hant': '編輯' },
  stopEditing:     { en: 'Stop Editing',  'zh-Hans': '停止编辑', 'zh-Hant': '停止編輯' },
  addRelative:     { en: 'Add Relative',  'zh-Hans': '添加亲属', 'zh-Hant': '新增親屬' },
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

  // Profile fields — contact + status/dates (added 2026-06-07)
  status:          { en: 'Status',          'zh-Hans': '状态',           'zh-Hant': '狀態' },
  living:          { en: 'Living',          'zh-Hans': '在世',           'zh-Hant': '在世' },
  deceasedStatus:  { en: 'Deceased',        'zh-Hans': '已故',           'zh-Hant': '已故' },
  notes:           { en: 'Notes',           'zh-Hans': '备注',           'zh-Hant': '備註' },
  deathDate:       { en: 'Date of passing', 'zh-Hans': '过世日期',       'zh-Hant': '過世日期' },
  contactInfo:     { en: 'Contact info',    'zh-Hans': '联系方式',       'zh-Hant': '聯絡方式' },
  noContactInfo:   { en: 'No contact info', 'zh-Hans': '暂无联系方式',   'zh-Hant': '暫無聯絡方式' },
  contactPopupTitle: { en: 'Contact',       'zh-Hans': '联系方式',       'zh-Hant': '聯絡方式' },
  phone:           { en: 'Phone',           'zh-Hans': '电话',           'zh-Hant': '電話' },
  wechat:          { en: 'WeChat',          'zh-Hans': '微信',           'zh-Hant': '微信' },
  instagram:       { en: 'Instagram',       'zh-Hans': 'Instagram',      'zh-Hant': 'Instagram' },
  facebook:        { en: 'Facebook',        'zh-Hans': 'Facebook',       'zh-Hant': 'Facebook' },
  linkedin:        { en: 'LinkedIn',        'zh-Hans': 'LinkedIn',       'zh-Hant': 'LinkedIn' },

  // Kinship calculator
  kinshipSetSource: { en: 'Set as kinship source', 'zh-Hans': '设为称呼基准', 'zh-Hant': '設為稱呼基準' },
  kinshipBasis:     { en: 'Kinship from',          'zh-Hans': '称呼基准',     'zh-Hant': '稱呼基準' },
  kinshipClear:     { en: 'Clear kinship source',  'zh-Hans': '清除称呼基准', 'zh-Hant': '清除稱呼基準' },

  // Toasts
  enterEmail:      { en: 'Enter an email address', 'zh-Hans': '请输入邮箱地址', 'zh-Hant': '請輸入電郵地址' },
  enterNameEmail:  { en: 'Please enter both name and email', 'zh-Hans': '请输入姓名和邮箱', 'zh-Hant': '請輸入姓名和電郵' },
  someoneUpdated:  { en: 'Someone else updated the chart. Refreshing…', 'zh-Hans': '有人更新了家族图，正在刷新…', 'zh-Hant': '有人更新了家族圖，正在重新整理…' },
  saveFailed:      { en: 'Save failed: {x}', 'zh-Hans': '保存失败：{x}', 'zh-Hant': '儲存失敗：{x}' },
  uploadFailed:    { en: 'Upload failed: {x}', 'zh-Hans': '上传失败：{x}', 'zh-Hant': '上傳失敗：{x}' }
} satisfies Record<string, Dict>;

export type I18nKey = keyof typeof T;

export function t(key: I18nKey): string {
  const entry = T[key];
  return entry[getLanguage()] ?? entry.en;
}
