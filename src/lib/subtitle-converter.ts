export const CUSTOM_SUBTITLE_ACCEPT =
  '.vtt,.srt,.ass,.ssa,.ttml,.dfxp,.xml,.sbv,.sub,.lrc';

export interface ConvertedSubtitle {
  name: string;
  url: string;
  format: string;
}

const WEBVTT_TIMESTAMP_PATTERN =
  /(\d{1,2}:)?\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*(\d{1,2}:)?\d{2}:\d{2}[,.]\d{1,3}/;

export async function convertSubtitleFileToVttObjectUrl(
  file: File
): Promise<ConvertedSubtitle> {
  const extension = getSubtitleExtension(file.name);
  if (!extension) {
    throw new Error('不支持的字幕格式');
  }

  const text = await file.text();
  const vtt = convertSubtitleTextToVtt(text, extension);
  const blob = new Blob([vtt], { type: 'text/vtt;charset=utf-8' });

  return {
    name: file.name,
    url: URL.createObjectURL(blob),
    format: extension,
  };
}

export function convertSubtitleTextToVtt(text: string, format: string): string {
  const normalizedFormat = format.toLowerCase().replace(/^\./, '');
  const normalizedText = stripBom(text).replace(/\r\n?/g, '\n');

  switch (normalizedFormat) {
    case 'vtt':
      return normalizeVtt(normalizedText);
    case 'srt':
      return convertSrtToVtt(normalizedText);
    case 'ass':
    case 'ssa':
      return convertAssToVtt(normalizedText);
    case 'ttml':
    case 'dfxp':
    case 'xml':
      return convertTtmlToVtt(normalizedText);
    case 'sbv':
      return convertSbvToVtt(normalizedText);
    case 'sub':
      return convertSubToVtt(normalizedText);
    case 'lrc':
      return convertLrcToVtt(normalizedText);
    default:
      throw new Error('不支持的字幕格式');
  }
}

function getSubtitleExtension(fileName: string): string | null {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  const extension = match?.[1] || '';

  return CUSTOM_SUBTITLE_ACCEPT.split(',')
    .map((item) => item.replace('.', ''))
    .includes(extension)
    ? extension
    : null;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function normalizeVtt(text: string): string {
  const body = text.replace(/^WEBVTT[^\n]*(\n|$)/i, '').trim();
  return `WEBVTT\n\n${body}\n`;
}

function convertSrtToVtt(text: string): string {
  return `WEBVTT\n\n${text
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{1,3})/g, (_, time, ms) => {
      return `${time}.${ms.padEnd(3, '0').slice(0, 3)}`;
    })
    .trim()}\n`;
}

function convertAssToVtt(text: string): string {
  const formatFields = getAssFormatFields(text);
  const events = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^Dialogue:/i.test(line))
    .map((line) => parseAssDialogue(line, formatFields))
    .filter((cue): cue is VttCue => Boolean(cue));

  return cuesToVtt(events);
}

function getAssFormatFields(text: string): string[] {
  const eventSection = text.split(/\n\s*\[Events\]\s*\n/i)[1] || text;
  const formatLine = eventSection
    .split('\n')
    .find((line) => /^Format:/i.test(line.trim()));

  if (!formatLine) {
    return ['Layer', 'Start', 'End', 'Style', 'Name', 'MarginL', 'MarginR', 'MarginV', 'Effect', 'Text'];
  }

  return formatLine
    .replace(/^Format:\s*/i, '')
    .split(',')
    .map((field) => field.trim());
}

interface VttCue {
  start: string;
  end: string;
  text: string;
}

function parseAssDialogue(line: string, fields: string[]): VttCue | null {
  const payload = line.replace(/^Dialogue:\s*/i, '');
  const textIndex = fields.findIndex((field) => /^text$/i.test(field));
  const startIndex = fields.findIndex((field) => /^start$/i.test(field));
  const endIndex = fields.findIndex((field) => /^end$/i.test(field));

  if (textIndex < 0 || startIndex < 0 || endIndex < 0) {
    return null;
  }

  const parts = splitAssCsv(payload, fields.length);
  const start = assTimeToVtt(parts[startIndex]);
  const end = assTimeToVtt(parts[endIndex]);
  const text = cleanAssText(parts[textIndex]);

  if (!start || !end || !text) {
    return null;
  }

  return { start, end, text };
}

function splitAssCsv(value: string, expectedParts: number): string[] {
  const parts = value.split(',');
  if (parts.length <= expectedParts) {
    return parts.map((part) => part.trim());
  }

  return [
    ...parts.slice(0, expectedParts - 1).map((part) => part.trim()),
    parts.slice(expectedParts - 1).join(',').trim(),
  ];
}

function cleanAssText(text: string): string {
  return decodeHtmlEntities(
    text
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\[Nn]/g, '\n')
      .replace(/\\h/g, ' ')
      .trim()
  );
}

function assTimeToVtt(value: string): string | null {
  const match = value.trim().match(/^(\d+):(\d{2}):(\d{2})[.](\d{1,2})$/);
  if (!match) return null;

  return `${match[1].padStart(2, '0')}:${match[2]}:${match[3]}.${match[4]
    .padEnd(3, '0')
    .slice(0, 3)}`;
}

function convertTtmlToVtt(text: string): string {
  const cues: VttCue[] = [];
  const paragraphPattern = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  let match: RegExpExecArray | null;

  while ((match = paragraphPattern.exec(text))) {
    const attrs = match[1];
    const start = readXmlTime(attrs, ['begin', 'start']);
    const end = readXmlTime(attrs, ['end']);
    const duration = readXmlTime(attrs, ['dur']);
    const cueText = decodeHtmlEntities(
      match[2]
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .trim()
    );

    if (!start || !cueText) continue;

    cues.push({
      start,
      end: end || addVttTimes(start, duration || '00:00:03.000'),
      text: cueText,
    });
  }

  return cuesToVtt(cues);
}

function readXmlTime(attrs: string, names: string[]): string | null {
  for (const name of names) {
    const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
    if (match) {
      return normalizeTimestamp(match[1]);
    }
  }

  return null;
}

function convertSbvToVtt(text: string): string {
  const cues: VttCue[] = [];
  const blocks = text.split(/\n{2,}/);

  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    const timing = lines[0];

    if (!timing || !timing.includes(',')) continue;

    const [startRaw, endRaw] = timing.split(',').map((part) => part.trim());
    const start = normalizeTimestamp(startRaw);
    const end = normalizeTimestamp(endRaw);
    const cueText = lines.slice(1).join('\n').trim();

    if (start && end && cueText) {
      cues.push({ start, end, text: cueText });
    }
  }

  return cuesToVtt(cues);
}

function convertSubToVtt(text: string): string {
  if (/^\{\d+\}\{\d+\}/m.test(text)) {
    return convertMicroDvdSubToVtt(text);
  }

  if (WEBVTT_TIMESTAMP_PATTERN.test(text)) {
    return convertSrtToVtt(text);
  }

  return convertSbvToVtt(text);
}

function convertMicroDvdSubToVtt(text: string): string {
  const frameRate = 25;
  const cues = text
    .split('\n')
    .map((line) => {
      const match = line.match(/^\{(\d+)\}\{(\d+)\}(.*)$/);
      if (!match) return null;

      const start = secondsToVttTime(Number(match[1]) / frameRate);
      const end = secondsToVttTime(Number(match[2]) / frameRate);
      const cueText = decodeHtmlEntities(match[3].replace(/\|/g, '\n').replace(/\{[^}]*\}/g, '').trim());

      return cueText ? { start, end, text: cueText } : null;
    })
    .filter((cue): cue is VttCue => Boolean(cue));

  return cuesToVtt(cues);
}

function convertLrcToVtt(text: string): string {
  const entries = text
    .split('\n')
    .flatMap((line) => {
      const timeMatches = Array.from(line.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g));
      const cueText = line.replace(/\[[^\]]+\]/g, '').trim();

      return timeMatches.map((match) => ({
        seconds:
          Number(match[1]) * 60 +
          Number(match[2]) +
          Number((match[3] || '0').padEnd(3, '0').slice(0, 3)) / 1000,
        text: cueText,
      }));
    })
    .filter((entry) => entry.text)
    .sort((a, b) => a.seconds - b.seconds);

  const cues = entries.map((entry, index) => ({
    start: secondsToVttTime(entry.seconds),
    end: secondsToVttTime(entries[index + 1]?.seconds || entry.seconds + 3),
    text: entry.text,
  }));

  return cuesToVtt(cues);
}

function cuesToVtt(cues: VttCue[]): string {
  if (cues.length === 0) {
    throw new Error('未识别到有效字幕内容');
  }

  return `WEBVTT\n\n${cues
    .map((cue) => `${cue.start} --> ${cue.end}\n${cue.text}`)
    .join('\n\n')}\n`;
}

function normalizeTimestamp(value: string): string | null {
  const trimmed = value.trim().replace(',', '.');
  const offsetMatch = trimmed.match(/^(\d+(?:\.\d+)?)s$/i);
  if (offsetMatch) {
    return secondsToVttTime(Number(offsetMatch[1]));
  }

  const match = trimmed.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) return null;

  const hours = match[1] || '0';
  const minutes = match[2];
  const seconds = match[3];
  const millis = (match[4] || '0').padEnd(3, '0').slice(0, 3);

  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:${seconds}.${millis}`;
}

function addVttTimes(start: string, duration: string): string {
  return secondsToVttTime(vttTimeToSeconds(start) + vttTimeToSeconds(duration));
}

function vttTimeToSeconds(value: string): number {
  const match = value.match(/^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/);
  if (!match) return 0;

  return (
    Number(match[1]) * 3600 +
    Number(match[2]) * 60 +
    Number(match[3]) +
    Number(match[4]) / 1000
  );
}

function secondsToVttTime(totalSeconds: number): string {
  const safeSeconds = Math.max(0, totalSeconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = Math.floor(safeSeconds % 60);
  const millis = Math.round((safeSeconds - Math.floor(safeSeconds)) * 1000);

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(
    seconds
  ).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
