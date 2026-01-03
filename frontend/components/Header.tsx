// components/Header.tsx
import React, { memo } from 'react';
import Link from 'next/link';

const Header = () => {
  return (
    <header className="bg-red-800 text-white w-full">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 p-1 max-w-full">

        {/* Left Section - PROSPER */}
        <Link
          href="https://prosper.intrans.iastate.edu/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-col w-full sm:w-64 shrink-0 hover:opacity-90 transition p-2"
        >
          <h1 className="text-lg mb-1 underline">
            PROSPER
          </h1>
          <p className="text-sm leading-tight">
            Program for Sustainable Pavement Engineering and Research
          </p>
        </Link>

        {/* Right Section - IPAT Title */}
        <div className="text-lg font-semibold whitespace-nowrap p-2 justify-end text-right">
          <p>
            Iowa Pavement Analysis Tool (IPAT) Segmentation Tool
          </p>
          <p className=' text-sm'>
            Version 1.0.0
          </p>
        </div>
      </div>
    </header>
  );
};

// Export memoized version to prevent unnecessary re-renders
export default memo(Header);


