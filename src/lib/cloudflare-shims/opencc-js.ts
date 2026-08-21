/* Cloudflare build shim: opencc-js 字典体积巨大（~1.9MB），仅客户端用于繁简转换。
 * 服务端 bundle 不需要它，这里用空实现替换，避免字典内联进 Worker。
 * 客户端（浏览器）构建仍使用真实的 opencc-js。
 */

export const Converter = () => (text: string) => text;

export const ConverterFactory = () => (text: string) => text;
export const CustomConverter = () => (text: string) => text;
export const HTMLConverter = () => (text: string) => text;

export const Locale = { from: {}, to: {} };

export default { Converter };
