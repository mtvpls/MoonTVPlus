'use client';

import { MAIN_SOURCE_NAME } from '@/lib/openlist-sources';

const DEFAULT_FIELD_CLASS =
  'px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed';

interface OpenListPathInputProps {
  /** 序列化后的值：主源为纯路径，备用源为「源名@路径」 */
  value: string;
  onChange: (value: string) => void;
  /** 可选的源名（主源在前）；为空时只渲染路径输入框 */
  sourceNames: string[];
  disabled?: boolean;
  placeholder?: string;
  /** 下拉框与输入框的样式类（各表单配色不同，可覆盖） */
  fieldClass?: string;
}

/**
 * OpenList「源名@路径」输入：左边选源，右边填真实路径（主源不写前缀）。
 * 只有 @ 左侧恰好等于已知源名时才当作源前缀，否则整串视为路径本身。
 */
export default function OpenListPathInput({
  value,
  onChange,
  sourceNames,
  disabled,
  placeholder = '/',
  fieldClass = DEFAULT_FIELD_CLASS,
}: OpenListPathInputProps) {
  const raw = value || '';
  const at = raw.indexOf('@');
  let sourceName = sourceNames[0] || MAIN_SOURCE_NAME;
  let path = raw;
  if (at > 0) {
    const name = raw.slice(0, at).trim();
    if (sourceNames.includes(name)) {
      sourceName = name;
      path = raw.slice(at + 1);
    }
  }

  const emit = (nextSource: string, nextPath: string) => {
    onChange(
      nextSource === MAIN_SOURCE_NAME ? nextPath : `${nextSource}@${nextPath}`
    );
  };

  // 一个源都没有时（OpenList 未配置）只给路径框
  if (sourceNames.length === 0) {
    return (
      <input
        type='text'
        value={path}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className={`w-full min-w-0 ${fieldClass}`}
      />
    );
  }

  return (
    <div className='flex gap-2'>
      <select
        value={sourceName}
        onChange={(e) => emit(e.target.value, path)}
        disabled={disabled}
        className={`w-28 shrink-0 ${fieldClass}`}
      >
        {sourceNames.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <input
        type='text'
        value={path}
        onChange={(e) => emit(sourceName, e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className={`flex-1 min-w-0 ${fieldClass}`}
      />
    </div>
  );
}
