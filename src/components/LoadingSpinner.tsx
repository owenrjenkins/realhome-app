'use client';
export default function LoadingSpinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-700">
      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"></circle>
        <path className="opacity-75" d="M4 12a8 8 0 018-8v3" stroke="currentColor" strokeWidth="3" strokeLinecap="round"></path>
      </svg>
      <span>{label}</span>
    </div>
  );
}

