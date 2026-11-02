/* 访问密钥验证器 —— 由 scripts/make-key.mjs 自动生成
 * 这里只有 salt 和 PBKDF2 哈希，不含明文密钥。
 * 换钥：node scripts/make-key.mjs "新密钥"
 * 关闭：node scripts/make-key.mjs --remove
 */
window.READER_AUTH = {
  "salt": "61ccf966bc7b7ef1517e792141eb4ea1",
  "hash": "f1953b7ab84909199caab372f2eef0e0d1693cbd710890e1def4529da3bfdd38",
  "iterations": 210000
};
