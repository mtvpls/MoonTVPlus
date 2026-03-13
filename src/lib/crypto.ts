import CryptoJS from 'crypto-js';

/**
 * 生成 SHA256 哈希值
 * @param data 要哈希的数据
 * @returns SHA256 哈希值（十六进制字符串）
 */
export function sha256(data: string): string {
  return CryptoJS.SHA256(data).toString(CryptoJS.enc.Hex);
}

/**
 * 生成文件夹的唯一 key
 * @param folderName 文件夹名称
 * @param existingKeys 已存在的 key 集合，用于检测冲突
 * @returns 唯一的 key（SHA256 的前10位）
 */
export function generateFolderKey(
  folderName: string,
  existingKeys: Set<string> = new Set(),
): string {
  let hash = sha256(folderName);
  let key = hash.substring(0, 10);

  // 如果遇到冲突，继续 sha256 直到不冲突
  while (existingKeys.has(key)) {
    hash = sha256(hash);
    key = hash.substring(0, 10);
  }

  return key;
}

/**
 * 简单的对称加密工具
 * 使用 AES 加密算法
 */
export class SimpleCrypto {
  /**
   * 加密数据
   * @param data 要加密的数据
   * @param password 加密密码
   * @returns 加密后的字符串
   */
  static encrypt(data: string, password: string): string {
    try {
      const encrypted = CryptoJS.AES.encrypt(data, password).toString();
      return encrypted;
    } catch (error) {
      throw new Error('加密失败');
    }
  }

  /**
   * 解密数据
   * @param encryptedData 加密的数据
   * @param password 解密密码
   * @returns 解密后的字符串
   */
  static decrypt(encryptedData: string, password: string): string {
    try {
      const bytes = CryptoJS.AES.decrypt(encryptedData, password);
      const decrypted = bytes.toString(CryptoJS.enc.Utf8);

      if (!decrypted) {
        throw new Error('解密失败，请检查密码是否正确');
      }

      return decrypted;
    } catch (error) {
      throw new Error('解密失败，请检查密码是否正确');
    }
  }

  /**
   * 验证密码是否能正确解密数据
   * @param encryptedData 加密的数据
   * @param password 密码
   * @returns 是否能正确解密
   */
  static canDecrypt(encryptedData: string, password: string): boolean {
    try {
      const decrypted = this.decrypt(encryptedData, password);
      return decrypted.length > 0;
    } catch {
      return false;
    }
  }
}
