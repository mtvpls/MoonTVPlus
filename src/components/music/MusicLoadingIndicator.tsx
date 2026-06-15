export default function MusicLoadingIndicator({
  text,
  size = 'md',
  className = '',
}: {
  text?: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const iconSize = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm';

  return (
    <div className={`flex items-center justify-center gap-3 text-zinc-400 ${className}`}>
      <div className="flex items-end gap-1.5">
        {[0, 1, 2].map((index) => (
          <svg
            key={index}
            className={`${iconSize} text-green-400`}
            fill="currentColor"
            viewBox="0 0 24 24"
            style={{ animation: `music-note-bounce 0.9s ease-in-out ${index * 0.14}s infinite` }}
          >
            <path d="M12 3v11.55A3.98 3.98 0 0010 14c-2.21 0-4 1.34-4 3s1.79 3 4 3 4-1.34 4-3V8h4V3h-6z" />
          </svg>
        ))}
      </div>
      {text ? <span className={`${textSize} font-medium tracking-wide`}>{text}</span> : null}
    </div>
  );
}
