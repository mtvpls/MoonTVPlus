/**
 * 初始化站长用户到 D1 数据库
 * 运行方式: npx wrangler d1 execute mdhfuep --file=init_owner.sql --remote
 */

-- 检查站长是否已存在
SELECT username FROM users WHERE username = '${process.env.USERNAME || "admin"}';

-- 如果站长不存在，创建站长用户
-- 注意：这里使用环境变量 USERNAME 和 PASSWORD
-- 密码需要先进行 SHA256 哈希处理
