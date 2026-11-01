/* 访问密钥验证器 —— 由 scripts/make-key.mjs 自动生成
 * 这里只有 salt 和 PBKDF2 哈希，不含明文密钥。
 * 换钥：node scripts/make-key.mjs "新密钥"
 * 关闭：node scripts/make-key.mjs --remove
 */
window.READER_AUTH = null;
