"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef } from "react";

export default function NavBar() {
  const pathname = usePathname();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);


  const isTodoPage = pathname === "/todo" || pathname === "/todo/upcoming";

  return (
    <nav className="sticky top-0 z-50 border-b border-[#d6c2a1] bg-[#f9f3e7] shadow-sm">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-center gap-8 px-4 py-4">
        <Link
          href="/calendar"
          className={`px-4 py-2 text-sm font-semibold transition ${
            pathname === "/calendar" || pathname === "/"
              ? "text-[#3f3227] underline decoration-2 underline-offset-4"
              : "text-[#8c7a63] hover:text-[#3f3227]"
          }`}
        >
          Calendar
        </Link>
         <div 
           className="relative" 
           ref={dropdownRef}
           onMouseEnter={() => setIsDropdownOpen(true)}
           onMouseLeave={() => setIsDropdownOpen(false)}
         >
           <Link
             href="/todo/upcoming"
             className={`px-4 py-2 text-sm font-semibold transition ${
               isTodoPage
                 ? "text-[#3f3227] underline decoration-2 underline-offset-4"
                 : "text-[#8c7a63] hover:text-[#3f3227]"
             }`}
           >
             To-Do
             <span className="ml-1 inline-block">▼</span>
           </Link>
           {isDropdownOpen && (
             <div className="absolute left-0 top-full mt-1 min-w-[140px] rounded-xl border border-[#d6c2a1] bg-[#f9f3e7] shadow-lg">
               <Link
                 href="/todo/upcoming"
                 onClick={() => setIsDropdownOpen(false)}
                 className={`block px-4 py-2 text-sm font-semibold transition first:rounded-t-xl last:rounded-b-xl ${
                   pathname === "/todo/upcoming"
                     ? "bg-[#e4f1e9] text-[#275736]"
                     : "text-[#3f3227] hover:bg-[#f5ecdd]"
                 }`}
               >
                 Upcoming
               </Link>
               <Link
                 href="/todo"
                 onClick={() => setIsDropdownOpen(false)}
                 className={`block px-4 py-2 text-sm font-semibold transition first:rounded-t-xl last:rounded-b-xl ${
                   pathname === "/todo"
                     ? "bg-[#e4f1e9] text-[#275736]"
                     : "text-[#3f3227] hover:bg-[#f5ecdd]"
                 }`}
               >
                 Inbox
               </Link>
             </div>
           )}
         </div>
      </div>
    </nav>
  );
}

