"use client";

import Link from "next/link";

export default function Page() {
  return (
    <div>
      <Link
        href="/?page=1&limit=25"
        onClick={() => {
          performance.mark("route_nav_start_p_to_home");
        }}
        className="underline"
      >
        Go Home
      </Link>
    </div>
  );
}


