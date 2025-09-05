// SERVER component (no "use client" here)
export const dynamic = "force-dynamic";
export const revalidate = 0;

import HomeClient from "@/components/HomeClient";

export default function Page() {
  // Render the client app shell
  return <HomeClient />;
}
