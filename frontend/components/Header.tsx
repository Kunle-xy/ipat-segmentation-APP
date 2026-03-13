// components/Header.tsx
import React, { memo } from 'react';
import Link from 'next/link';

const Header = () => {
  return (
    <header className="bg-red-800 text-white w-full shrink-0 overflow-hidden">
      <div className="flex justify-between items-center gap-2 p-1 min-w-0">

        {/* Left Section - PROSPER */}
        <Link
          href="https://prosper.intrans.iastate.edu/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-col shrink-0 hover:opacity-90 transition p-2"
        >
          <h1 className="text-lg mb-1 underline">
            PROSPER
          </h1>
          <p className="text-sm leading-tight hidden sm:block">
            Program for Sustainable Pavement Engineering and Research
          </p>
        </Link>

        {/* Right Section - IPAT Title */}
        <div className="text-sm sm:text-lg font-semibold p-2 text-right min-w-0 truncate">
          <p className="truncate">
            Iowa Pavement Analysis Tool (IPAT) Segmentation Tool
          </p>
          <p className="text-xs sm:text-sm">
            Version 1.1.0
          </p>
        </div>
      </div>
    </header>
  );
};

// Export memoized version to prevent unnecessary re-renders
export default memo(Header);


