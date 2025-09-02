'use client';
export default function ErrorBanner({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 text-red-800 text-sm p-3">
      {message}
    </div>
  );
}

